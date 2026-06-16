/**
 * 短信验证码服务（阿里云 Dysmsapi，纯 node:crypto 签名，无 SDK 依赖）
 * 安全设计：
 *  - AccessKey 仅存服务端 .env（已 gitignore），永不下发前端
 *  - 验证码以 SHA-256 哈希落库，明文不留存；5 分钟过期、一次性使用、5 次错误即作废
 *  - 防刷三重限流：同号 60 秒冷却 / 同号每日 ≤5 条 / 同 IP 每小时 ≤10 条
 *  - 未配置密钥时进入「本地联调模式」：验证码打印在服务端终端，不对外泄露
 */
import crypto from "node:crypto";

import { query } from "./db.mjs";

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const CODE_TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MAX_PER_PHONE_PER_DAY = 5;
const MAX_PER_IP_PER_HOUR = 10;
const MAX_VERIFY_ATTEMPTS = 5;

function smsConfig() {
  return {
    accessKeyId: process.env.SMS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.SMS_ACCESS_KEY_SECRET || "",
    signName: process.env.SMS_SIGN_NAME || "",
    templateCode: process.env.SMS_TEMPLATE_CODE || "",
  };
}

export function smsConfigured() {
  const config = smsConfig();
  return Boolean(config.accessKeyId && config.accessKeySecret && config.signName && config.templateCode);
}

/* ---------- 表结构（启动时确保存在；users 表补 phone 列） ---------- */
let schemaReady = null;
export function ensureSmsSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS sms_codes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        code_hash CHAR(64) NOT NULL,
        ip VARCHAR(45) NULL,
        used TINYINT(1) NOT NULL DEFAULT 0,
        attempts INT NOT NULL DEFAULT 0,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sms_phone (phone, created_at),
        INDEX idx_sms_ip (ip, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      const columns = await query(
        `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone'`,
      );
      if (!Number(columns[0].total)) {
        await query("ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL UNIQUE");
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

const hashCode = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");

/* ---------- 发送验证码 ---------- */
export async function requestSmsCode({ phone, ip }) {
  if (!PHONE_PATTERN.test(String(phone || ""))) throw new Error("手机号格式不正确");
  await ensureSmsSchema();

  // 该手机号是否已注册
  const existing = await query("SELECT id FROM users WHERE phone = :phone", { phone });
  if (existing.length) throw new Error("该手机号已注册，请直接登录");

  // 限流：同号冷却 / 同号每日上限 / 同 IP 每小时上限
  const [recent] = await query(
    "SELECT COUNT(*) AS total FROM sms_codes WHERE phone = :phone AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)",
    { phone },
  );
  if (Number(recent.total)) throw new Error("发送过于频繁，请 60 秒后再试");
  const [daily] = await query(
    "SELECT COUNT(*) AS total FROM sms_codes WHERE phone = :phone AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)",
    { phone },
  );
  if (Number(daily.total) >= MAX_PER_PHONE_PER_DAY) throw new Error("该手机号今日发送次数已达上限");
  if (ip) {
    const [hourly] = await query(
      "SELECT COUNT(*) AS total FROM sms_codes WHERE ip = :ip AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)",
      { ip },
    );
    if (Number(hourly.total) >= MAX_PER_IP_PER_HOUR) throw new Error("请求过于频繁，请稍后再试");
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await query(
    `INSERT INTO sms_codes (phone, code_hash, ip, expires_at) VALUES (:phone, :codeHash, :ip, DATE_ADD(NOW(), INTERVAL ${Math.floor(CODE_TTL_MS / 1000)} SECOND))`,
    { phone, codeHash: hashCode(code), ip: ip || null },
  );

  if (!smsConfigured()) {
    console.warn(`[sms] 未配置阿里云密钥，本地联调模式 — 手机号 ${phone} 的验证码：${code}（仅打印在服务端终端）`);
    return { ok: true, mock: true };
  }

  await aliyunSendSms(phone, code);
  return { ok: true };
}

/* ---------- 校验验证码（一次性、限错误次数） ---------- */
export async function verifySmsCode({ phone, code }) {
  await ensureSmsSchema();
  const rows = await query(
    `SELECT id, code_hash AS codeHash, attempts, used, expires_at AS expiresAt
     FROM sms_codes WHERE phone = :phone ORDER BY id DESC LIMIT 1`,
    { phone },
  );
  const record = rows[0];
  if (!record || record.used) throw new Error("请先获取验证码");
  if (new Date(record.expiresAt).getTime() < Date.now()) throw new Error("验证码已过期，请重新获取");
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) throw new Error("错误次数过多，请重新获取验证码");

  if (hashCode(code) !== record.codeHash) {
    await query("UPDATE sms_codes SET attempts = attempts + 1 WHERE id = :id", { id: record.id });
    throw new Error("验证码不正确");
  }
  await query("UPDATE sms_codes SET used = 1 WHERE id = :id", { id: record.id });
  return true;
}

/* ---------- 阿里云 POP RPC 签名与调用 ---------- */
function popEncode(value) {
  return encodeURIComponent(value)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

export function buildAliyunQuery(params, accessKeySecret) {
  const sortedKeys = Object.keys(params).sort();
  const canonical = sortedKeys.map((key) => `${popEncode(key)}=${popEncode(params[key])}`).join("&");
  const stringToSign = `GET&%2F&${popEncode(canonical)}`;
  const signature = crypto.createHmac("sha1", `${accessKeySecret}&`).update(stringToSign).digest("base64");
  return `${canonical}&Signature=${popEncode(signature)}`;
}

async function aliyunSendSms(phone, code) {
  const config = smsConfig();
  const params = {
    AccessKeyId: config.accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: "cn-hangzhou",
    SignName: config.signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    TemplateCode: config.templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25",
  };
  const queryString = buildAliyunQuery(params, config.accessKeySecret);

  const response = await fetch(`https://dysmsapi.aliyuncs.com/?${queryString}`, {
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.Code !== "OK") {
    console.error("[sms] 阿里云返回:", payload.Code, payload.Message);
    const friendly = {
      "isv.BUSINESS_LIMIT_CONTROL": "发送过于频繁，已被运营商限流，请稍后再试",
      "isv.AMOUNT_NOT_ENOUGH": "短信账户余额不足，请联系管理员",
      "isv.SMS_SIGNATURE_ILLEGAL": "短信签名不合法，请检查签名配置",
      "isv.SMS_TEMPLATE_ILLEGAL": "短信模板不合法，请检查模板编号",
      "isp.RAM_PERMISSION_DENY": "AccessKey 无短信权限，请在阿里云 RAM 中授权",
    }[payload.Code];
    throw new Error(friendly || `短信发送失败：${payload.Message || payload.Code || "未知错误"}`);
  }
}
