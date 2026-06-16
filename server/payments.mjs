/**
 * 支付服务层：企业支付宝（当面付/扫码） + 企业微信支付（Native 扫码）
 * - 纯 node:crypto 实现签名，无第三方 SDK 依赖
 * - 支付结果支持「异步回调 + 轮询查单」双通道确认
 * - mock 模式：未配置真实商户参数时可完整走通流程（模拟支付按钮）
 */
import crypto from "node:crypto";

import { query, withTransaction } from "./db.mjs";
import { paymentSchemaStatements } from "./schema.mjs";

const CHANNELS = ["alipay", "wechat"];
const CHANNEL_NAMES = { alipay: "支付宝", wechat: "微信支付" };

/* ---------- 建表（懒执行 + 记忆化） ---------- */
let schemaReady = null;
export function ensurePaymentSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of paymentSchemaStatements) {
        await query(statement);
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/* ---------- 渠道配置 ---------- */
const SECRET_FIELDS = ["privateKey", "alipayPublicKey", "apiV3Key"];

export async function listPaymentConfigs({ includeSecrets = false } = {}) {
  await ensurePaymentSchema();
  const rows = await query("SELECT channel, enabled, mode, config_json AS configJson FROM payment_configs");
  return CHANNELS.map((channel) => {
    const row = rows.find((item) => item.channel === channel);
    const config = row?.configJson ? JSON.parse(row.configJson) : {};
    const publicConfig = {};
    const secretsSet = {};
    for (const [key, value] of Object.entries(config)) {
      if (SECRET_FIELDS.includes(key)) {
        secretsSet[key] = Boolean(value);
        if (includeSecrets) publicConfig[key] = value;
      } else {
        publicConfig[key] = value;
      }
    }
    return {
      channel,
      channelName: CHANNEL_NAMES[channel],
      enabled: Boolean(row?.enabled),
      mode: row?.mode || "mock",
      config: publicConfig,
      secretsSet,
    };
  });
}

export async function savePaymentConfig({ channel, enabled, mode, config = {} }) {
  if (!CHANNELS.includes(channel)) throw new Error("不支持的支付渠道");
  if (!["mock", "production"].includes(mode)) throw new Error("模式只能是 mock 或 production");
  await ensurePaymentSchema();

  // 留空的敏感字段沿用已存值
  const existingRows = await query("SELECT config_json AS configJson FROM payment_configs WHERE channel = :channel", { channel });
  const existing = existingRows[0]?.configJson ? JSON.parse(existingRows[0].configJson) : {};
  const merged = { ...existing };
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_FIELDS.includes(key) && (value === "" || value == null)) continue;
    merged[key] = typeof value === "string" ? value.trim() : value;
  }

  if (mode === "production") assertProductionConfig(channel, merged);

  await query(
    `INSERT INTO payment_configs (channel, enabled, mode, config_json) VALUES (:channel, :enabled, :mode, :configJson)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), mode = VALUES(mode), config_json = VALUES(config_json)`,
    { channel, enabled: enabled ? 1 : 0, mode, configJson: JSON.stringify(merged) },
  );
  return { ok: true };
}

function assertProductionConfig(channel, config) {
  const required = channel === "alipay"
    ? ["appId", "privateKey", "alipayPublicKey", "notifyUrl"]
    : ["mchId", "appId", "serialNo", "privateKey", "apiV3Key", "notifyUrl"];
  for (const key of required) {
    if (!config[key]) throw new Error(`生产模式缺少必填参数：${key}`);
  }
}

async function getChannelForPay(channel) {
  const configs = await listPaymentConfigs({ includeSecrets: true });
  const found = configs.find((item) => item.channel === channel);
  if (!found || !found.enabled) throw new Error(`${CHANNEL_NAMES[channel] || channel} 未启用，请联系管理员配置`);
  return found;
}

export async function listEnabledChannels() {
  const configs = await listPaymentConfigs();
  return configs
    .filter((item) => item.enabled)
    .map(({ channel, channelName, mode }) => ({ channel, channelName, mode }));
}

/* ---------- 工具 ---------- */
function centsToYuanString(cents) {
  return (Number(cents) / 100).toFixed(2);
}

export function paymentCallbackUrls(baseUrl) {
  const origin = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!origin) throw new Error("缺少站点域名，无法生成支付回调地址");
  return {
    alipay: `${origin}/api/payments/notify/alipay`,
    wechat: `${origin}/api/payments/notify/wechat`,
  };
}

function formatPem(key, type = "PRIVATE KEY") {
  const value = String(key || "").trim();
  if (value.includes("-----BEGIN")) return value;
  const body = value.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----`;
}

export function rsaSign(content, privateKey) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(content, "utf8");
  try {
    return signer.sign(formatPem(privateKey, "PRIVATE KEY"), "base64");
  } catch {
    // 兼容 PKCS#1 格式私钥
    return crypto.createSign("RSA-SHA256").update(content, "utf8").sign(formatPem(privateKey, "RSA PRIVATE KEY"), "base64");
  }
}

function gmt8Timestamp() {
  const date = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/* ---------- 支付宝（当面付） ---------- */
export function buildAlipaySignContent(params) {
  return Object.keys(params)
    .filter((key) => key !== "sign" && params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

export function buildAlipayNotifySignContent(params) {
  return Object.keys(params)
    .filter((key) => !["sign", "sign_type"].includes(key) && params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function verifyRsa2(content, sign, publicKey) {
  for (const type of ["PUBLIC KEY", "RSA PUBLIC KEY"]) {
    try {
      const verifier = crypto.createVerify("RSA-SHA256");
      verifier.update(content, "utf8");
      if (verifier.verify(formatPem(publicKey, type), sign, "base64")) return true;
    } catch {
      /* 尝试下一种 PEM 包装 */
    }
  }
  return false;
}

function verifyAlipayNotify(params, config) {
  if (!params?.sign) return false;
  return verifyRsa2(buildAlipayNotifySignContent(params), params.sign, config.alipayPublicKey);
}

async function alipayCall(config, method, bizContent, extraParams = {}) {
  const gateway = config.gateway || "https://openapi.alipay.com/gateway.do";
  const params = {
    app_id: config.appId,
    method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: gmt8Timestamp(),
    version: "1.0",
    biz_content: JSON.stringify(bizContent),
    ...extraParams,
  };
  params.sign = rsaSign(buildAlipaySignContent(params), config.privateKey);

  const body = new URLSearchParams(params).toString();
  const response = await fetch(gateway, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  });
  const text = await response.text();
  const payload = JSON.parse(text);
  const key = `${method.replaceAll(".", "_")}_response`;
  const result = payload[key] || {};
  if (result.code !== "10000") {
    const detail = result.sub_msg || result.msg || "支付宝接口调用失败";
    const haystack = `${result.code} ${result.msg} ${result.sub_code} ${result.sub_msg}`;
    let hint = "";
    if (/40006|ACCESS_FORBIDDEN|permission|insufficient/i.test(haystack)) {
      hint = "。原因：该支付宝应用未签约「当面付」产品（或签约未生效/应用未上线）——请登录支付宝开放平台 open.alipay.com → 控制台 → 你的应用 → 产品绑定，签约“当面付”并等待审核通过；期间可在「财务」页把支付宝渠道切回模拟模式继续联调";
    } else if (/invalid-signature|sign/i.test(String(result.sub_code || ""))) {
      hint = "。原因：签名校验失败——请确认使用「公钥模式」加签，应用私钥与平台上传的应用公钥配对";
    } else if (/app-not-exist|invalid-app-id/i.test(haystack)) {
      hint = "。原因：AppID 不存在或不正确";
    }
    const error = new Error(`支付宝：${detail}${result.sub_code ? `（${result.sub_code}）` : ""}${hint}`);
    error.alipayCode = result.code;
    error.subCode = result.sub_code;
    throw error;
  }
  return result;
}

async function alipayPrecreate(config, { orderNo, amountCents, subject }) {
  const result = await alipayCall(config, "alipay.trade.precreate", {
    out_trade_no: orderNo,
    total_amount: centsToYuanString(amountCents),
    subject: subject || "AI照相馆",
  }, config.notifyUrl ? { notify_url: config.notifyUrl } : {});
  return result.qr_code;
}

async function alipayQuery(config, orderNo) {
  try {
    const result = await alipayCall(config, "alipay.trade.query", { out_trade_no: orderNo });
    if (result.trade_status === "TRADE_SUCCESS" || result.trade_status === "TRADE_FINISHED") return "paid";
    if (result.trade_status === "TRADE_CLOSED") return "expired";
    return "pending";
  } catch (error) {
    if (error.subCode === "ACQ.TRADE_NOT_EXIST") return "pending"; // 用户尚未扫码
    throw error;
  }
}

/* ---------- 微信支付（Native v3） ---------- */
export function buildWechatAuthHeader(config, method, urlPath, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = rsaSign(message, config.privateKey);
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonce}",` +
    `signature="${signature}",timestamp="${timestamp}",serial_no="${config.serialNo}"`
  );
}

async function wechatCall(config, method, urlPath, bodyObject) {
  const host = config.apiHost || "https://api.mch.weixin.qq.com";
  const body = bodyObject ? JSON.stringify(bodyObject) : "";
  const response = await fetch(host + urlPath, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "ai-photo-studio/1.0",
      Authorization: buildWechatAuthHeader(config, method, urlPath, body),
    },
    body: body || undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`微信支付：${payload.message || payload.code || response.status}`);
  }
  return payload;
}

async function wechatNativeCreate(config, { orderNo, amountCents, subject }) {
  const result = await wechatCall(config, "POST", "/v3/pay/transactions/native", {
    appid: config.appId,
    mchid: config.mchId,
    description: subject || "AI照相馆",
    out_trade_no: orderNo,
    notify_url: config.notifyUrl,
    amount: { total: Number(amountCents), currency: "CNY" },
  });
  return result.code_url;
}

async function wechatQuery(config, orderNo) {
  const result = await wechatCall(config, "GET", `/v3/pay/transactions/out-trade-no/${orderNo}?mchid=${config.mchId}`, null);
  if (result.trade_state === "SUCCESS") return "paid";
  if (["CLOSED", "REVOKED", "PAYERROR"].includes(result.trade_state)) return "failed";
  return "pending";
}

export function decryptWechatResource({ resource, apiV3Key }) {
  if (!resource || resource.algorithm !== "AEAD_AES_256_GCM") throw new Error("微信支付通知加密算法不支持");
  const key = Buffer.from(String(apiV3Key || ""), "utf8");
  if (key.length !== 32) throw new Error("微信支付 APIv3 密钥必须为 32 位");
  const encrypted = Buffer.from(resource.ciphertext || "", "base64");
  if (encrypted.length <= 16) throw new Error("微信支付通知密文无效");
  const ciphertext = encrypted.subarray(0, -16);
  const authTag = encrypted.subarray(-16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(resource.nonce || "", "utf8"));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(resource.associated_data || "", "utf8"));
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}

/* ---------- 二维码（可选依赖 qrcode，缺失时优雅降级） ---------- */
async function makeQrDataUrl(text) {
  try {
    const { default: QRCode } = await import("qrcode");
    return await QRCode.toDataURL(text, { margin: 1, width: 280, color: { dark: "#1a1b2e", light: "#ffffff" } });
  } catch {
    return null; // 前端将显示链接文本兜底
  }
}

/* ---------- 订单 ---------- */
function newOrderNo(type) {
  const prefix = type === "recharge" ? "RC" : "PG";
  return `${prefix}${Date.now()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function createPaymentOrder({ type, channel, amountCents, userId, subject }) {
  if (!["recharge", "paygen"].includes(type)) throw new Error("订单类型不合法");
  const amount = Math.round(Number(amountCents));
  if (!Number.isFinite(amount) || amount < 1) throw new Error("支付金额必须大于 0");
  await ensurePaymentSchema();

  const channelConfig = await getChannelForPay(channel);
  const orderNo = newOrderNo(type);
  const orderSubject = subject || (type === "recharge" ? "AI照相馆-账户充值" : "AI照相馆-单次生成");

  let qrText;
  if (channelConfig.mode === "mock") {
    qrText = `mockpay://${channel}/${orderNo}?amount=${centsToYuanString(amount)}`;
  } else if (channel === "alipay") {
    qrText = await alipayPrecreate(channelConfig.config, { orderNo, amountCents: amount, subject: orderSubject });
  } else {
    qrText = await wechatNativeCreate(channelConfig.config, { orderNo, amountCents: amount, subject: orderSubject });
  }

  await query(
    `INSERT INTO payment_orders (order_no, user_id, type, channel, amount_cents, status, qr_text, subject)
     VALUES (:orderNo, :userId, :type, :channel, :amount, 'pending', :qrText, :subject)`,
    { orderNo, userId: userId || null, type, channel, amount, qrText, subject: orderSubject },
  );

  return {
    orderNo,
    type,
    channel,
    mode: channelConfig.mode,
    amountCents: amount,
    qrText,
    qrDataUrl: await makeQrDataUrl(qrText),
  };
}

async function getOrder(orderNo) {
  await ensurePaymentSchema();
  const rows = await query(
    `SELECT id, order_no AS orderNo, user_id AS userId, type, channel, amount_cents AS amountCents,
       status, credited, used, qr_text AS qrText, created_at AS createdAt, paid_at AS paidAt
     FROM payment_orders WHERE order_no = :orderNo`,
    { orderNo },
  );
  if (!rows[0]) throw new Error("订单不存在");
  return rows[0];
}

function parseYuanToCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("支付通知金额无效");
  return Math.round(number * 100);
}

function assertNotifyMatchesOrder({ order, channel, amountCents }) {
  if (order.channel !== channel) throw new Error("支付通知渠道与订单不一致");
  if (Number(order.amountCents) !== Number(amountCents)) throw new Error("支付通知金额与订单不一致");
}

async function updateOrderStatus(order, status) {
  await query("UPDATE payment_orders SET status = :status WHERE id = :id AND status <> 'paid'", { status, id: order.id });
}

/** 标记已支付并完成入账（充值订单给用户加余额），幂等 */
async function markOrderPaid(order) {
  await withTransaction(async (connection) => {
    const [updated] = await connection.execute(
      "UPDATE payment_orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW()) WHERE id = ? AND status <> 'paid'",
      [order.id],
    );
    const justPaid = updated.affectedRows > 0;
    if (order.type !== "recharge" || !order.userId) return;

    // 充值入账（credited 防重复）
    const [credit] = await connection.execute(
      "UPDATE payment_orders SET credited = 1 WHERE id = ? AND credited = 0",
      [order.id],
    );
    if (!credit.affectedRows) return;
    const [[user]] = await connection.execute(
      "SELECT balance_cents AS balanceCents FROM users WHERE id = ? FOR UPDATE",
      [order.userId],
    );
    if (!user) return;
    const nextBalance = Number(user.balanceCents) + Number(order.amountCents);
    await connection.execute("UPDATE users SET balance_cents = ? WHERE id = ?", [nextBalance, order.userId]);
    await connection.execute(
      "INSERT INTO wallet_transactions (user_id, type, amount_cents, balance_after_cents, note) VALUES (?, 'recharge', ?, ?, ?)",
      [order.userId, order.amountCents, nextBalance, `在线充值 · ${CHANNEL_NAMES[order.channel] || order.channel}`],
    );
    void justPaid;
  });
}

export async function handleAlipayNotify(params = {}) {
  await ensurePaymentSchema();
  const channelConfig = (await listPaymentConfigs({ includeSecrets: true })).find((item) => item.channel === "alipay");
  if (!channelConfig?.config?.alipayPublicKey) throw new Error("支付宝公钥未配置，无法验签回调");
  if (!verifyAlipayNotify(params, channelConfig.config)) throw new Error("支付宝回调验签失败");
  if (params.app_id && channelConfig.config.appId && params.app_id !== channelConfig.config.appId) {
    throw new Error("支付宝回调 AppID 不匹配");
  }

  const orderNo = String(params.out_trade_no || "").trim();
  if (!orderNo) throw new Error("支付宝回调缺少商户订单号");
  const order = await getOrder(orderNo);
  assertNotifyMatchesOrder({ order, channel: "alipay", amountCents: parseYuanToCents(params.total_amount) });

  const tradeStatus = String(params.trade_status || "");
  if (tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED") {
    await markOrderPaid(order);
    return { orderNo, status: "paid" };
  }
  if (tradeStatus === "TRADE_CLOSED") {
    await updateOrderStatus(order, "expired");
    return { orderNo, status: "expired" };
  }
  return { orderNo, status: "pending" };
}

export async function handleWechatNotify(payload = {}) {
  await ensurePaymentSchema();
  const channelConfig = (await listPaymentConfigs({ includeSecrets: true })).find((item) => item.channel === "wechat");
  if (!channelConfig?.config?.apiV3Key) throw new Error("微信支付 APIv3 密钥未配置，无法解密回调");
  const data = decryptWechatResource({ resource: payload.resource, apiV3Key: channelConfig.config.apiV3Key });
  if (data.mchid && channelConfig.config.mchId && data.mchid !== channelConfig.config.mchId) {
    throw new Error("微信支付回调商户号不匹配");
  }

  const orderNo = String(data.out_trade_no || "").trim();
  if (!orderNo) throw new Error("微信支付回调缺少商户订单号");
  const order = await getOrder(orderNo);
  assertNotifyMatchesOrder({ order, channel: "wechat", amountCents: data.amount?.total });

  if (data.trade_state === "SUCCESS") {
    await markOrderPaid(order);
    return { orderNo, status: "paid" };
  }
  if (["CLOSED", "REVOKED", "PAYERROR"].includes(data.trade_state)) {
    await updateOrderStatus(order, "failed");
    return { orderNo, status: "failed" };
  }
  return { orderNo, status: "pending" };
}

export async function getPaymentOrderStatus(orderNo) {
  const order = await getOrder(orderNo);

  if (order.status === "pending") {
    const channelConfig = await getChannelForPay(order.channel).catch(() => null);
    if (channelConfig && channelConfig.mode === "production") {
      const remote = order.channel === "alipay"
        ? await alipayQuery(channelConfig.config, orderNo)
        : await wechatQuery(channelConfig.config, orderNo);
      if (remote === "paid") {
        await markOrderPaid(order);
        order.status = "paid";
      } else if (remote !== "pending") {
        await query("UPDATE payment_orders SET status = :status WHERE id = :id", { status: remote, id: order.id });
        order.status = remote;
      }
    }
  }

  const result = { orderNo, status: order.status, type: order.type, amountCents: order.amountCents };
  if (order.status === "paid" && order.type === "recharge" && order.userId) {
    const users = await query("SELECT balance_cents AS balanceCents FROM users WHERE id = :id", { id: order.userId });
    result.balanceCents = users[0]?.balanceCents;
  }
  return result;
}

/** 模拟支付：仅 mock 模式可用（本地联调） */
export async function simulatePayOrder(orderNo) {
  const order = await getOrder(orderNo);
  const channelConfig = await getChannelForPay(order.channel);
  if (channelConfig.mode !== "mock") throw new Error("当前渠道为生产模式，不能模拟支付");
  if (order.status !== "pending") throw new Error("订单状态不允许模拟支付");
  await markOrderPaid(order);
  return getPaymentOrderStatus(orderNo);
}

/** 单次付费订单核销：校验已支付未使用且金额足够 */
export async function consumePayOrder({ orderNo, requiredCents }) {
  const order = await getOrder(orderNo);
  if (order.type !== "paygen") throw new Error("订单类型不支持本次生成");
  if (order.status !== "paid") throw new Error("订单尚未支付成功");
  if (order.used) throw new Error("该支付订单已被使用");
  if (Number(order.amountCents) < Number(requiredCents)) throw new Error("订单金额与模型价格不符，请重新支付");
  return order;
}

export async function markPayOrderUsed(orderNo) {
  await query("UPDATE payment_orders SET used = 1 WHERE order_no = :orderNo", { orderNo });
}

/* ---------- 站点财务 ---------- */
export async function getFinanceSummary() {
  await ensurePaymentSchema();
  const [incomeRows, withdrawRows, orders, withdrawals] = await Promise.all([
    query("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payment_orders WHERE status = 'paid'"),
    query("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM withdrawals WHERE status IN ('pending', 'done')"),
    query(
      `SELECT po.order_no AS orderNo, po.type, po.channel, po.amount_cents AS amountCents, po.status,
         po.created_at AS createdAt, po.paid_at AS paidAt, u.name AS userName
       FROM payment_orders po LEFT JOIN users u ON u.id = po.user_id
       ORDER BY po.id DESC LIMIT 100`,
    ),
    query(
      `SELECT id, amount_cents AS amountCents, note, status, created_at AS createdAt, done_at AS doneAt
       FROM withdrawals ORDER BY id DESC LIMIT 100`,
    ),
  ]);
  const totalIncomeCents = Number(incomeRows[0].total);
  const totalWithdrawCents = Number(withdrawRows[0].total);
  return {
    totalIncomeCents,
    totalWithdrawCents,
    balanceCents: totalIncomeCents - totalWithdrawCents,
    orders,
    withdrawals,
  };
}

export async function createWithdrawal({ amountCents, note }) {
  const amount = Math.round(Number(amountCents));
  if (!Number.isFinite(amount) || amount < 1) throw new Error("提现金额必须大于 0");
  const summary = await getFinanceSummary();
  if (amount > summary.balanceCents) throw new Error(`提现金额超出站点余额（当前 ¥${centsToYuanString(summary.balanceCents)}）`);
  await query("INSERT INTO withdrawals (amount_cents, note) VALUES (:amount, :note)", { amount, note: note || null });
  return { ok: true };
}

export async function markWithdrawalDone(id) {
  await query("UPDATE withdrawals SET status = 'done', done_at = NOW() WHERE id = :id AND status = 'pending'", { id });
  return { ok: true };
}
