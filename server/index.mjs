import express from "express";
import multer from "multer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { calculateGenerationCharge, ensureSufficientBalance } from "./billing.mjs";
import {
  consumePayOrder,
  createPaymentOrder,
  createWithdrawal,
  ensurePaymentSchema,
  getFinanceSummary,
  getPaymentOrderStatus,
  handleAlipayNotify,
  handleWechatNotify,
  listEnabledChannels,
  listPaymentConfigs,
  markPayOrderUsed,
  markWithdrawalDone,
  paymentCallbackUrls,
  savePaymentConfig,
  simulatePayOrder,
} from "./payments.mjs";
import { config } from "./config.mjs";
import { getPool, query } from "./db.mjs";
import { ensureSmsSchema, requestSmsCode, verifySmsCode } from "./sms.mjs";
import { discoverModels } from "./model-discovery.mjs";
import { buildCaseReferenceGroups } from "./case-reference-utils.mjs";
import { getAiNewsDigest, refreshAiNews } from "./ai-news.mjs";
import { generateImage } from "./openai-compatible.mjs";
import {
  createVolcengineVideoTask,
  getVolcengineVideoTask,
  uploadedFilesToVideoAssets,
  volcengineVideoConfig,
} from "./volcengine-video.mjs";
import { withAuthorizationStatement } from "./prompt-utils.mjs";
import {
  createCase,
  createUser,
  chargeUserFee,
  createVideoTaskRecord,
  deleteCase,
  deletePrice,
  deleteProvider,
  ensureAiNewsSchema,
  ensureAppSchema,
  ensureCaseUsageSchema,
  ensureVideoTaskSchema,
  finalizeSuccessfulVideoTask,
  countCases,
  getVideoTask,
  getNextCaseNumber,
  getGenerationContext,
  getGenerationContextByDisplayName,
  getPublicSettings,
  getSetting,
  listBootstrap,
  listCases,
  listCreations,
  listWallet,
  recordCaseUse,
  recordGeneration,
  rechargeUser,
  saveSiteSettings,
  setPriceEnabled,
  setProviderEnabled,
  updateVideoTask,
  updateCase,
  upsertPrice,
  upsertProvider,
  verifyLogin,
} from "./repository.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const app = express();
const routeCursor = new Map();
const upload = multer({
  dest: path.join(rootDir, "uploads/input"),
  limits: { fileSize: 12 * 1024 * 1024 },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use("/uploads", express.static(path.join(rootDir, "uploads")));
app.use(express.static(rootDir, { extensions: ["html"] }));

app.get("/api/health", async (req, res) => {
  await getPool().query("SELECT 1");
  res.json({ ok: true });
});

app.get("/api/bootstrap", asyncHandler(async (req, res) => {
  res.json(await listBootstrap());
}));

app.get("/api/settings", asyncHandler(async (req, res) => {
  res.json(await getPublicSettings());
}));

app.post("/api/settings", asyncHandler(async (req, res) => {
  res.json(await saveSiteSettings(req.body));
}));

app.get("/api/ai-news", asyncHandler(async (req, res) => {
  res.json(await getAiNewsDigest());
}));

app.post("/api/ai-news/refresh", asyncHandler(async (req, res) => {
  res.json(await runAiNewsRefresh());
}));

app.post("/api/login", asyncHandler(async (req, res) => {
  res.json({ user: await verifyLogin(req.body) });
}));

/* 发送注册验证码（限流防刷见 sms.mjs） */
app.post("/api/sms/send", asyncHandler(async (req, res) => {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  res.json(await requestSmsCode({ phone: String(req.body.phone || "").trim(), ip }));
}));

app.post("/api/register", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");
  const phone = String(req.body.phone || "").trim();
  const smsCode = String(req.body.smsCode || "").trim();
  assertRequired(email, "账号不能为空");
  if (email.length < 3) throw new Error("账号至少 3 个字符");
  if (password.length < 6) throw new Error("密码至少 6 位");
  assertRequired(phone, "手机号不能为空");
  assertRequired(smsCode, "短信验证码不能为空");

  await verifySmsCode({ phone, code: smsCode });

  const name = String(req.body.name || "").trim() || email;
  try {
    const { id } = await createUser({ email, name, password, role: "user", phone });
    res.json({ user: { id, email, name, role: "user", balanceCents: 0 } });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") throw new Error("该账号或手机号已被注册，请直接登录");
    throw error;
  }
}));

app.post("/api/users", asyncHandler(async (req, res) => {
  try {
    res.json(await createUser(req.body));
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") throw new Error("该账号已存在，请换一个账号");
    throw error;
  }
}));

app.post("/api/users/:id/recharge", asyncHandler(async (req, res) => {
  const amountCents = yuanToCents(req.body.amountYuan);
  res.json(await rechargeUser({ userId: req.params.id, amountCents, note: req.body.note }));
}));

app.get("/api/users/:id/wallet", asyncHandler(async (req, res) => {
  res.json(await listWallet(req.params.id, { from: req.query.from, to: req.query.to }));
}));

app.get("/api/users/:id/creations", asyncHandler(async (req, res) => {
  res.json(await listCreations(req.params.id, { userId: req.query.userId, from: req.query.from, to: req.query.to }));
}));

app.get("/api/cases", asyncHandler(async (req, res) => {
  const paged = req.query.limit !== undefined || req.query.offset !== undefined;
  const paging = paged
    ? { limit: positiveInteger(req.query.limit, 240, 1200), offset: positiveInteger(req.query.offset, 0, 1000000) }
    : {};
  const params = { category: req.query.category, q: req.query.q, ...paging };
  const [items, total] = await Promise.all([
    listCases(params),
    paged ? countCases(params) : Promise.resolve(null),
  ]);
  if (!paged) {
    res.json(items);
    return;
  }
  res.json({
    items,
    total,
    limit: paging.limit,
    offset: paging.offset,
    hasMore: paging.offset + items.length < total,
  });
}));

app.get("/api/cases/next-number", asyncHandler(async (req, res) => {
  assertRequired(req.query.categoryId, "请选择分类");
  res.json(await getNextCaseNumber(req.query.categoryId));
}));

app.get("/api/case-references", asyncHandler(async (req, res) => {
  const [bootstrap, cases] = await Promise.all([
    listBootstrap(),
    listCases({ category: "all", q: "" }),
  ]);
  res.json(buildCaseReferenceGroups({ categories: bootstrap.categories, cases }));
}));

app.post("/api/cases/:id/use", asyncHandler(async (req, res) => {
  res.json(await recordCaseUse({
    caseId: req.params.id,
    userId: req.body.userId,
    source: req.body.source,
  }));
}));

app.post("/api/translate", asyncHandler(async (req, res) => {
  assertRequired(req.body.text, "翻译内容不能为空");
  const text = String(req.body.text);
  if (text.length > 30000) throw new Error("翻译内容过长");
  res.json({ text: await translateToChinese(text) });
}));

/* 图片反推提示词：用已配置供应商的视觉模型推导英文提示词，再翻译出中文
   定价：.env 中 DERIVE_PRICE_YUAN（默认 0 = 免费）；收费时计入用户消费流水 */
app.post("/api/derive-prompt", upload.single("image"), asyncHandler(async (req, res) => {
  if (!req.file) throw new Error("请先上传图片");
  const priceCents = await getDerivePromptPriceCents();
  const userId = req.body.userId;
  if (priceCents > 0) {
    assertRequired(userId, "推导提示词为付费功能，请先登录");
  }

  const en = await derivePromptFromImage(req.file.path, req.file.mimetype);
  let zh = "";
  try {
    zh = await translateToChinese(en);
  } catch {
    zh = ""; // 翻译失败不阻塞，前端仅展示英文
  }

  let balanceCents = null;
  if (priceCents > 0 && userId) {
    const charged = await chargeUserFee({ userId, amountCents: priceCents, note: "提示词推导（图片反推）" });
    balanceCents = charged.balanceCents;
  }
  res.json({ en, zh, chargeCents: priceCents, balanceCents });
}));

app.post("/api/cases", asyncHandler(async (req, res) => {
  assertCase(req.body);
  res.json(await createCase(req.body));
}));

app.put("/api/cases/:id", asyncHandler(async (req, res) => {
  assertCase(req.body);
  await updateCase(req.params.id, req.body);
  res.json({ ok: true });
}));

app.delete("/api/cases/:id", asyncHandler(async (req, res) => {
  await deleteCase(req.params.id);
  res.json({ ok: true });
}));

app.post("/api/providers", asyncHandler(async (req, res) => {
  assertRequired(req.body.name, "供应商名称不能为空");
  assertRequired(req.body.baseUrl, "Base URL 不能为空");
  if (!req.body.id) assertRequired(req.body.apiKey, "API Key 不能为空");
  assertRequired(req.body.defaultModel, "默认模型不能为空");
  res.json(await upsertProvider(req.body));
}));

app.post("/api/providers/discover", asyncHandler(async (req, res) => {
  assertRequired(req.body.baseUrl, "Base URL 不能为空");
  assertRequired(req.body.apiKey, "API Key 不能为空");
  res.json({ models: await discoverModels(req.body) });
}));

app.patch("/api/providers/:id/enabled", asyncHandler(async (req, res) => {
  await setProviderEnabled({ id: req.params.id, enabled: Boolean(req.body.enabled) });
  res.json({ ok: true });
}));

app.delete("/api/providers/:id", asyncHandler(async (req, res) => {
  await deleteProvider(req.params.id);
  res.json({ ok: true });
}));

app.post("/api/prices", asyncHandler(async (req, res) => {
  assertRequired(req.body.providerId, "请选择供应商");
  assertRequired(req.body.model, "模型不能为空");
  assertRequired(req.body.displayName, "显示名称不能为空");
  const unitPriceCents = yuanToCents(req.body.unitPriceYuan ?? centsToYuan(req.body.unitPriceCents ?? 0));
  res.json(await upsertPrice({ ...req.body, unitPriceCents }));
}));

app.patch("/api/prices/:id/enabled", asyncHandler(async (req, res) => {
  await setPriceEnabled({ id: req.params.id, enabled: Boolean(req.body.enabled) });
  res.json({ ok: true });
}));

app.delete("/api/prices/:id", asyncHandler(async (req, res) => {
  await deletePrice(req.params.id);
  res.json({ ok: true });
}));

app.post("/api/generate", upload.fields([
  { name: "referenceImage", maxCount: 6 },
  { name: "maskImage", maxCount: 1 },
]), asyncHandler(async (req, res) => {
  const userId = req.body.userId;
  const priceId = req.body.priceId;
  const modelDisplayName = req.body.modelDisplayName;
  const generationMode = normalizeGenerationMode(req.body.generationMode);
  const prompt = withAuthorizationStatement(req.body.prompt, req.body.authorizationConfirmed === "true" || req.body.authorizationConfirmed === true);
  if (!prompt) throw new Error("Prompt 不能为空");
  const referenceImages = Array.isArray(req.files?.referenceImage) ? req.files.referenceImage : [];
  const referenceImage = referenceImages[0] || null;
  const maskImage = uploadedFile(req, "maskImage");
  if (generationMode === "image" && !referenceImage) {
    throw new Error("文+图生图需要上传参考图");
  }
  if (generationMode === "inpaint") {
    if (!referenceImage) throw new Error("局部重绘需要上传原图");
    if (!maskImage) throw new Error("局部重绘需要提供蒙版");
  }

  let context;
  if (modelDisplayName) {
    try {
      context = selectRoutedPrice(await getGenerationContextByDisplayName({ userId, displayName: modelDisplayName }), modelDisplayName);
    } catch (error) {
      if (generationMode !== "image") throw error;
      context = await getFallbackImageGenerationContext(userId);
    }
  } else {
    context = await getGenerationContext({ userId, priceId });
  }
  const user = context.user;
  const price = await chooseStableImagePrice({ price: context.price, generationMode });
  const chargeCents = calculateGenerationCharge({ unitPriceCents: price.unitPriceCents });

  // 单次付费订单核销 / 余额扣费 二选一
  const payOrderNo = req.body.payOrderNo;
  if (payOrderNo) {
    await consumePayOrder({ orderNo: payOrderNo, requiredCents: chargeCents });
  } else {
    ensureSufficientBalance({ balanceCents: user.balanceCents, chargeCents });
  }

  try {
    const imageUrl = await generateImage({
      provider: price,
      model: price.model,
      prompt,
      // 局部重绘只用第一张原图；文+图模式支持多张参考图（传完整文件对象以保留文件名与 MIME）
      imagePaths: generationMode === "inpaint"
        ? (referenceImage ? [referenceImage] : [])
        : referenceImages,
      maskPath: maskImage || undefined,
    });
    const record = await recordGeneration({
      userId,
      caseId: req.body.caseId,
      providerId: price.providerId,
      model: price.model,
      prompt,
      chargeCents,
      status: "succeeded",
      imageUrl,
      skipCharge: Boolean(payOrderNo),
      chargeNote: payOrderNo ? "单次支付" : null,
    });
    if (payOrderNo) await markPayOrderUsed(payOrderNo);
    res.json({ ...record, imageUrl, chargeCents });
  } catch (error) {
    console.error(`[generate] 失败 user=${userId} model=${price.model} mode=${generationMode} 参考图=${referenceImages.length}张：`, error.message);
    await recordGeneration({
      userId,
      caseId: req.body.caseId,
      providerId: price.providerId,
      model: price.model,
      prompt,
      chargeCents,
      status: "failed",
      errorMessage: error.message,
      skipCharge: Boolean(payOrderNo),
    });
    // 生成失败时不核销订单，用户可凭该订单免费重试
    throw error;
  }
}));

app.post("/api/video/generate", upload.fields([
  { name: "referenceImage", maxCount: 3 },
  { name: "referenceVideo", maxCount: 1 },
]), asyncHandler(async (req, res) => {
  const userId = req.body.userId;
  assertRequired(userId, "请先登录");
  const prompt = withAuthorizationStatement(req.body.prompt, req.body.authorizationConfirmed === "true" || req.body.authorizationConfirmed === true);
  assertRequired(prompt, "Prompt 不能为空");
  const config = volcengineVideoConfig();
  if (!config.apiKey) throw new Error("未配置火山方舟 API Key（ARK_API_KEY 或 VOLCENGINE_API_KEY）");
  const userRows = await query("SELECT id, balance_cents AS balanceCents FROM users WHERE id = :userId", { userId });
  if (!userRows[0]) throw new Error("用户不存在");
  if (Number(userRows[0].balanceCents) < Number(config.priceCents)) throw new Error("余额不足，请先充值");
  const referenceImages = Array.isArray(req.files?.referenceImage) ? req.files.referenceImage : [];
  const referenceVideos = Array.isArray(req.files?.referenceVideo) ? req.files.referenceVideo : [];
  const params = {
    videoMode: req.body.videoMode || "video",
    ratio: req.body.videoRatio || "9:16",
    duration: req.body.videoDuration || "5",
    resolution: req.body.videoResolution || "720p",
    watermark: false,
  };
  if (params.videoMode === "imageVideo" && !referenceImages.length) throw new Error("图生视频需要先上传参考图");
  if (params.videoMode === "videoVideo" && !referenceVideos.length) throw new Error("视频生视频需要先上传参考视频");
  const assets = await uploadedFilesToVideoAssets([...referenceImages, ...referenceVideos]);
  const task = await createVolcengineVideoTask({
    ...config,
    prompt,
    images: assets.images,
    videos: assets.videos,
    ...params,
  });
  const record = await createVideoTaskRecord({
    userId,
    model: config.model,
    prompt,
    chargeCents: config.priceCents,
    status: task.status === "succeeded" ? "running" : task.status,
    providerTaskId: task.taskId,
    params,
  });
  res.json({ ...record, pollMs: config.pollMs });
}));

app.get("/api/video/tasks/:id", asyncHandler(async (req, res) => {
  const userId = req.query.userId || req.body.userId;
  assertRequired(userId, "请先登录");
  const existing = await getVideoTask(req.params.id, userId);
  if (["succeeded", "failed"].includes(existing.status)) {
    res.json(existing);
    return;
  }
  const config = volcengineVideoConfig();
  const upstream = await getVolcengineVideoTask({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    taskId: existing.providerTaskId,
    timeoutMs: config.timeoutMs,
  });
  if (upstream.status === "succeeded") {
    if (!upstream.videoUrl) throw new Error("火山视频任务已成功但未返回视频地址");
    res.json(await finalizeSuccessfulVideoTask({ id: existing.id, userId, videoUrl: upstream.videoUrl }));
    return;
  }
  if (upstream.status === "failed") {
    res.json(await updateVideoTask({
      id: existing.id,
      userId,
      status: "failed",
      errorMessage: upstream.errorMessage || "火山视频任务失败",
    }));
    return;
  }
  res.json(await updateVideoTask({ id: existing.id, userId, status: upstream.status }));
}));

/* ---------- 支付与财务 ---------- */
app.get("/api/payments/config", asyncHandler(async (req, res) => {
  res.json({ channels: await listPaymentConfigs(), callbackUrls: paymentCallbackUrls(publicBaseUrl(req)) });
}));

app.post("/api/payments/config", asyncHandler(async (req, res) => {
  res.json(await savePaymentConfig(req.body));
}));

app.get("/api/payments/callback-urls", asyncHandler(async (req, res) => {
  res.json({ callbackUrls: paymentCallbackUrls(publicBaseUrl(req)) });
}));

app.get("/api/payments/channels", asyncHandler(async (req, res) => {
  res.json({ channels: await listEnabledChannels() });
}));

app.post("/api/payments/orders", asyncHandler(async (req, res) => {
  const { type, channel, userId } = req.body;
  let amountCents;
  if (type === "recharge") {
    amountCents = yuanToCents(req.body.amountYuan);
    assertRequired(userId, "充值需要先登录");
  } else {
    amountCents = yuanToCents(req.body.amountYuan);
  }
  res.json(await createPaymentOrder({ type, channel, amountCents, userId, subject: req.body.subject }));
}));

app.get("/api/payments/orders/:orderNo", asyncHandler(async (req, res) => {
  res.json(await getPaymentOrderStatus(req.params.orderNo));
}));

app.post("/api/payments/orders/:orderNo/simulate", asyncHandler(async (req, res) => {
  res.json(await simulatePayOrder(req.params.orderNo));
}));

app.post("/api/payments/notify/alipay", asyncHandler(async (req, res) => {
  await handleAlipayNotify(req.body);
  res.type("text/plain").send("success");
}));

app.post("/api/payments/notify/wechat", async (req, res) => {
  try {
    await handleWechatNotify(req.body);
    res.json({ code: "SUCCESS", message: "成功" });
  } catch (error) {
    res.status(500).json({ code: "FAIL", message: error.message || "失败" });
  }
});

app.get("/api/finance/summary", asyncHandler(async (req, res) => {
  res.json(await getFinanceSummary());
}));

app.post("/api/finance/withdrawals", asyncHandler(async (req, res) => {
  const amountCents = yuanToCents(req.body.amountYuan);
  res.json(await createWithdrawal({ amountCents, note: req.body.note }));
}));

app.patch("/api/finance/withdrawals/:id/done", asyncHandler(async (req, res) => {
  res.json(await markWithdrawalDone(req.params.id));
}));

app.use("/api", (req, res) => {
  res.status(404).json({ error: "接口不存在，请刷新服务后重试" });
});

app.use((req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.use((error, req, res, next) => {
  res.status(400).json({ error: error.message || "请求失败" });
});

console.log(`Starting AI照相馆 server on port ${config.port}...`);

// 预热支付表结构（失败不阻塞启动，首次支付请求会再次尝试）
ensurePaymentSchema().catch((error) => console.warn("支付表初始化推迟：", error.message));
ensureSmsSchema().catch((error) => console.warn("短信表初始化推迟：", error.message));
ensureCaseUsageSchema().catch((error) => console.warn("案例使用记录表初始化推迟：", error.message));
ensureVideoTaskSchema().catch((error) => console.warn("视频任务表初始化推迟：", error.message));
ensureAppSchema().catch((error) => console.warn("站点参数表初始化推迟：", error.message));
ensureAiNewsSchema().catch((error) => console.warn("AI产经表初始化推迟：", error.message));
scheduleAiNewsRefresh();

app.listen(config.port, () => {
  console.log(`Prompt gallery app running at http://localhost:${config.port}`);
});

async function runAiNewsRefresh() {
  return refreshAiNews({ summarize: summarizeAiNewsEntry });
}

function scheduleAiNewsRefresh() {
  const planNext = async () => {
    const refreshTime = await getSetting("aiNewsRefreshTime", "09:00").catch(() => "09:00");
    const delay = nextBeijingNineOClock(refreshTime) - Date.now();
    setTimeout(async () => {
      try {
        await runAiNewsRefresh();
      } catch (error) {
        console.warn("AI产经自动更新失败：", error.message);
      } finally {
        planNext();
      }
    }, Math.max(1000, delay));
  };
  planNext();
}

function nextBeijingNineOClock(refreshTime = "09:00") {
  const [hour = 9, minute = 0] = String(refreshTime || "09:00").split(":").map(Number);
  const now = new Date();
  const beijingParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  let target = Date.parse(`${beijingParts.year}-${beijingParts.month}-${beijingParts.day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
  if (target <= now.getTime()) target += 24 * 60 * 60 * 1000;
  return target;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function assertCase(input) {
  assertRequired(input.categoryId, "请选择分类");
  assertRequired(input.title, "标题不能为空");
  assertRequired(input.prompt, "Prompt 不能为空");
}

function assertRequired(value, message) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(message);
  }
}

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (configured) return configured;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const fallbackProto = host && !/^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?$/i.test(host) ? "https" : (req.protocol || "http");
  const proto = String(req.headers["x-forwarded-proto"] || fallbackProto).split(",")[0].trim();
  return `${proto}://${host}`;
}

function uploadedFile(req, fieldName) {
  return Array.isArray(req.files?.[fieldName]) ? req.files[fieldName][0] : null;
}

function normalizeGenerationMode(value) {
  const mode = String(value || "text").trim();
  if (["text", "image", "inpaint"].includes(mode)) return mode;
  throw new Error("不支持的生成模式");
}

async function getFallbackImageGenerationContext(userId) {
  const users = await query("SELECT id, balance_cents AS balanceCents FROM users WHERE id = :userId", { userId });
  if (!users[0]) throw new Error("用户不存在");
  const prices = await enabledMultimodalImagePrices();
  if (!prices.length) throw new Error("当前没有可用的文+图模型，请到供应商页启用 Gemini / flash-image 类模型");
  return { user: users[0], price: prices[0] };
}

async function chooseStableImagePrice({ price, generationMode }) {
  if (generationMode !== "image" || !isUnstableImageEditModel(price.model)) return price;
  const prices = await enabledMultimodalImagePrices();
  return prices[0] || price;
}

async function enabledMultimodalImagePrices() {
  return query(
    `SELECT mp.id, mp.model, mp.unit_price_cents AS unitPriceCents, p.id AS providerId, p.name AS providerName,
      p.base_url AS baseUrl, p.api_key AS apiKey, p.enabled AS providerEnabled, mp.enabled AS priceEnabled
     FROM model_prices mp JOIN providers p ON p.id = mp.provider_id
     WHERE mp.enabled = 1 AND p.enabled = 1
       AND (
        mp.model LIKE '%gemini%' OR mp.model LIKE '%flash-image%' OR mp.model LIKE '%nano-banana%' OR
        mp.model LIKE '%nanobanana%' OR mp.model LIKE '%seedream%' OR mp.model LIKE '%seededit%'
       )
     ORDER BY mp.unit_price_cents, mp.id`,
  );
}

function isUnstableImageEditModel(model) {
  return /^gpt-image/i.test(String(model || ""));
}

function yuanToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("金额必须是非负数字");
  return Math.round(amount * 100);
}

function centsToYuan(value) {
  return Number(value) / 100;
}

function positiveInteger(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(Math.floor(number), max);
}

/**
 * 提示词翻译：三级容灾
 *  1) Google 免费接口（国内网络通常不可达，4.5s 超时快速失败）
 *  2) MyMemory 免费接口（国内可达，按 450 字分块）
 *  3) 本站已启用的 OpenAI 兼容供应商（chat 补全，模型可用 TRANSLATE_MODEL 环境变量指定）
 */
async function translateToChinese(text) {
  const source = String(text || "").trim();
  if (!source || isMostlyChinese(source)) return source;

  const errors = [];
  for (const provider of [translateViaGoogle, translateViaMyMemory, translateViaSiteProvider]) {
    try {
      const result = await provider(source);
      if (result && result.trim()) return result.trim();
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }
  throw new Error(`中文翻译失败（已尝试 ${errors.length} 个翻译源）。${errors.join("；")}`);
}

function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

async function translateViaGoogle(source) {
  const translated = [];
  for (const chunk of splitTranslationChunks(source)) {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", "zh-CN");
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", chunk);

    const response = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0 AI-Photo-Studio" } }, 4500);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.[0])) throw new Error("接口不可达");
    translated.push(payload[0].map((segment) => segment?.[0] || "").join(""));
  }
  return translated.join("");
}

async function translateViaMyMemory(source) {
  const translated = [];
  for (const chunk of splitTranslationChunks(source, 450)) {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", chunk);
    url.searchParams.set("langpair", "en|zh-CN");
    const response = await fetchWithTimeout(url, {}, 8000);
    const payload = await response.json().catch(() => null);
    const piece = payload?.responseData?.translatedText;
    if (!response.ok || !piece) throw new Error("接口不可达或超出限额");
    translated.push(piece);
  }
  return translated.join("");
}

async function getDerivePromptPriceCents() {
  const configured = await getSetting("derivePriceYuan", process.env.DERIVE_PRICE_YUAN || "0");
  return yuanToCents(configured || "0");
}

async function getProviderCredentialForModel(model) {
  const providers = await query(
    `SELECT p.base_url AS baseUrl, p.api_key AS apiKey
     FROM providers p
     LEFT JOIN model_prices mp ON mp.provider_id = p.id AND mp.enabled = 1
     WHERE p.enabled = 1
       AND (p.default_model = :model OR mp.model = :model OR mp.display_name = :model)
     ORDER BY p.id
     LIMIT 1`,
    { model },
  );
  if (!providers[0]) throw new Error(`模型 ${model} 未绑定可用供应商，请在供应商与定价中启用该模型`);
  const base = String(providers[0].baseUrl || "").replace(/\/+$/, "");
  return {
    apiKey: providers[0].apiKey,
    chatEndpoint: base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`,
  };
}

async function summarizeAiNewsEntry(entry) {
  const model = process.env.AI_NEWS_MODEL || process.env.TRANSLATE_MODEL || process.env.DERIVE_MODEL || "gpt-5.4";
  const { apiKey, chatEndpoint } = await getProviderCredentialForModel(model);
  const response = await fetchWithTimeout(chatEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 160,
      messages: [
        {
          role: "system",
          content: "你是 AI 产业快讯编辑。把新闻标题压缩成中文简报，保留模型名、公司、价格、监管、风险等关键信息。只输出一句话，35到80个中文字符。",
        },
        {
          role: "user",
          content: `分类：${entry.category}\n标题：${entry.title}\n来源：${entry.sourceName || "未知"}`,
        },
      ],
    }),
  }, 30000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `AI产经摘要失败：${response.status}`);
  const result = payload?.choices?.[0]?.message?.content;
  if (!result) throw new Error("AI产经摘要模型未返回内容");
  return result;
}

async function derivePromptFromImage(filePath, mimeType) {
  const model = process.env.DERIVE_MODEL || process.env.TRANSLATE_MODEL || "gpt-4o-mini";
  const { apiKey, chatEndpoint } = await getProviderCredentialForModel(model);
  const base64 = (await readFile(filePath)).toString("base64");

  const response = await fetchWithTimeout(chatEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 900,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "你是资深 AI 绘图提示词工程师。仔细观察这张图片，反推出能够复现它的英文生成提示词：涵盖主体与动作、风格、构图与镜头、光线、色调、材质细节和画质关键词，用逗号分隔的短语书写。只输出提示词本身，不要任何解释或前后缀。",
            },
            { type: "image_url", image_url: { url: `data:${mimeType || "image/png"};base64,${base64}` } },
          ],
        },
      ],
    }),
  }, 60000);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `推导失败：HTTP ${response.status}（可用 DERIVE_MODEL 环境变量更换视觉模型，当前 ${model}）`);
  }
  const result = payload?.choices?.[0]?.message?.content?.trim();
  if (!result) throw new Error("视觉模型未返回提示词");
  return result;
}

async function translateViaSiteProvider(source) {
  const model = process.env.TRANSLATE_MODEL || "gpt-4o-mini";
  const { apiKey, chatEndpoint } = await getProviderCredentialForModel(model);

  const response = await fetchWithTimeout(chatEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "你是专业翻译引擎。把用户提供的 AI 绘图提示词完整翻译成简体中文，保留专有名词、参数与格式，只输出译文，不要任何解释。" },
        { role: "user", content: source },
      ],
    }),
  }, 30000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `供应商返回 ${response.status}（可用 TRANSLATE_MODEL 环境变量更换翻译模型，当前 ${model}）`);
  const result = payload?.choices?.[0]?.message?.content;
  if (!result) throw new Error("供应商未返回译文");
  return result;
}

function splitTranslationChunks(text, maxLength = 1400) {
  const chunks = [];
  let current = "";
  for (const part of text.split(/([。！？.!?；;，,\n])/)) {
    if (current.length + part.length > maxLength && current.trim()) {
      chunks.push(current);
      current = "";
    }
    if (part.length > maxLength) {
      for (let index = 0; index < part.length; index += maxLength) {
        const slice = part.slice(index, index + maxLength);
        if (slice.length === maxLength) chunks.push(slice);
        else current += slice;
      }
    } else {
      current += part;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function isMostlyChinese(text) {
  const compact = text.replace(/\s/g, "");
  if (!compact) return true;
  const chinese = compact.match(/[\u3400-\u9fff]/g)?.length || 0;
  return chinese / compact.length > 0.45;
}

function selectRoutedPrice(context, key) {
  const cursor = routeCursor.get(key) || 0;
  const price = context.prices[cursor % context.prices.length];
  routeCursor.set(key, cursor + 1);
  return { user: context.user, price };
}
