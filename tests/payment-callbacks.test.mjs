import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAlipayNotifySignContent,
  decryptWechatResource,
  paymentCallbackUrls,
} from "../server/payments.mjs";

const indexSource = readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("payment callback urls include the public domain and fixed notify paths", () => {
  assert.deepEqual(paymentCallbackUrls("https://pp.juxin.pro/"), {
    alipay: "https://pp.juxin.pro/api/payments/notify/alipay",
    wechat: "https://pp.juxin.pro/api/payments/notify/wechat",
  });
});

test("alipay notify sign content excludes sign and sign_type before verification", () => {
  assert.equal(
    buildAlipayNotifySignContent({
      sign: "ignored",
      sign_type: "RSA2",
      total_amount: "10.00",
      trade_status: "TRADE_SUCCESS",
      out_trade_no: "RC202606120001",
    }),
    "out_trade_no=RC202606120001&total_amount=10.00&trade_status=TRADE_SUCCESS",
  );
});

test("wechat v3 notify resource decrypts with the APIv3 key", () => {
  const apiV3Key = "12345678901234567890123456789012";
  const nonce = "nonce-20260612";
  const associatedData = "transaction";
  const plaintext = JSON.stringify({
    out_trade_no: "RC202606120002",
    trade_state: "SUCCESS",
    amount: { total: 9900 },
  });

  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);

  assert.deepEqual(
    decryptWechatResource({
      resource: {
        algorithm: "AEAD_AES_256_GCM",
        associated_data: associatedData,
        nonce,
        ciphertext: encrypted.toString("base64"),
      },
      apiV3Key,
    }),
    {
      out_trade_no: "RC202606120002",
      trade_state: "SUCCESS",
      amount: { total: 9900 },
    },
  );
});

test("server exposes alipay and wechat payment notify endpoints", () => {
  assert.match(indexSource, /app\.post\("\/api\/payments\/notify\/alipay"/);
  assert.match(indexSource, /app\.post\("\/api\/payments\/notify\/wechat"/);
  assert.match(indexSource, /express\.urlencoded\(\{ extended: false/);
});

test("finance channel config shows copyable alipay and wechat callback urls", () => {
  assert.match(appSource, /function callbackUrlForChannel\(channel\)/);
  assert.match(appSource, /ccAlipayNotifyUrl/);
  assert.match(appSource, /ccWechatNotifyUrl/);
});
