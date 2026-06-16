import bcrypt from "bcryptjs";

import { query, withTransaction } from "./db.mjs";
import {
  aiNewsSchemaStatements,
  appSettingSchemaStatements,
  caseUsageSchemaStatements,
  videoTaskSchemaStatements,
} from "./schema.mjs";

let caseUsageSchemaReady = null;
let videoTaskSchemaReady = null;
let appSchemaReady = null;
let aiNewsSchemaReady = null;

const DEFAULT_SETTINGS = {
  derivePriceYuan: "0",
  aiNewsRefreshTime: "09:00",
  aiNewsLastUpdatedAt: "",
};

export function ensureCaseUsageSchema() {
  if (!caseUsageSchemaReady) {
    caseUsageSchemaReady = (async () => {
      for (const statement of caseUsageSchemaStatements) {
        await query(statement);
      }
    })();
  }
  return caseUsageSchemaReady;
}

export function ensureVideoTaskSchema() {
  if (!videoTaskSchemaReady) {
    videoTaskSchemaReady = (async () => {
      for (const statement of videoTaskSchemaStatements) {
        await query(statement);
      }
    })();
  }
  return videoTaskSchemaReady;
}

export function ensureAppSchema() {
  if (!appSchemaReady) {
    appSchemaReady = (async () => {
      for (const statement of appSettingSchemaStatements) {
        await query(statement);
      }
    })();
  }
  return appSchemaReady;
}

export function ensureAiNewsSchema() {
  if (!aiNewsSchemaReady) {
    aiNewsSchemaReady = (async () => {
      for (const statement of aiNewsSchemaStatements) {
        await query(statement);
      }
    })();
  }
  return aiNewsSchemaReady;
}

export async function listBootstrap() {
  const [categories, providers, prices, users, settings] = await Promise.all([
    query("SELECT id, name, sort_order AS sortOrder FROM categories ORDER BY sort_order, name"),
    query("SELECT id, name, base_url AS baseUrl, default_model AS defaultModel, enabled FROM providers ORDER BY id DESC"),
    query(`SELECT mp.id, mp.provider_id AS providerId, p.name AS providerName, mp.model, mp.display_name AS displayName,
      mp.unit_price_cents AS unitPriceCents, mp.enabled
      FROM model_prices mp JOIN providers p ON p.id = mp.provider_id ORDER BY mp.id DESC`),
    query("SELECT id, email, name, phone, role, balance_cents AS balanceCents FROM users ORDER BY id"),
    getPublicSettings(),
  ]);

  return { categories, providers: maskProviders(providers), prices, users, settings };
}

export async function getPublicSettings() {
  await ensureAppSchema();
  const rows = await query("SELECT setting_key AS settingKey, setting_value AS settingValue FROM app_settings");
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (Object.hasOwn(settings, row.settingKey)) settings[row.settingKey] = row.settingValue || "";
  }
  return settings;
}

export async function saveSiteSettings(input) {
  await ensureAppSchema();
  const derivePrice = Number(input.derivePriceYuan ?? 0);
  if (!Number.isFinite(derivePrice) || derivePrice < 0) throw new Error("推导提示词单价不能为负数");
  const refreshTime = normalizeRefreshTime(input.aiNewsRefreshTime || DEFAULT_SETTINGS.aiNewsRefreshTime);
  const values = {
    derivePriceYuan: derivePrice.toFixed(2).replace(/\.00$/, ""),
    aiNewsRefreshTime: refreshTime,
  };
  for (const [key, value] of Object.entries(values)) {
    await query(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES (:key, :value)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      { key, value },
    );
  }
  return getPublicSettings();
}

export async function getSetting(key, fallback = "") {
  await ensureAppSchema();
  const rows = await query("SELECT setting_value AS settingValue FROM app_settings WHERE setting_key = :key", { key });
  return rows[0]?.settingValue ?? fallback;
}

export async function setSetting(key, value) {
  await ensureAppSchema();
  await query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (:key, :value)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    { key, value },
  );
}

export async function listAiNewsItems({ limit = 40 } = {}) {
  await ensureAiNewsSchema();
  const safeLimit = normalizeOptionalPositiveInteger(limit) || 40;
  return query(
    `SELECT id, digest_date AS digestDate, category, title, summary, source_name AS sourceName,
      source_url AS sourceUrl, published_at AS publishedAt, created_at AS createdAt
     FROM ai_news_items ORDER BY digest_date DESC, id DESC LIMIT ${Math.min(safeLimit, 120)}`,
  );
}

export async function replaceAiNewsItems(items) {
  await ensureAiNewsSchema();
  if (!items.length) return { inserted: 0 };
  return withTransaction(async (connection) => {
    let inserted = 0;
    for (const item of items) {
      const [result] = await connection.execute(
        `INSERT INTO ai_news_items (digest_date, category, title, summary, source_name, source_url, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           digest_date = VALUES(digest_date),
           category = VALUES(category),
           title = VALUES(title),
           summary = VALUES(summary),
           source_name = VALUES(source_name),
           published_at = VALUES(published_at)`,
        [
          item.digestDate,
          item.category,
          item.title,
          item.summary,
          item.sourceName,
          item.sourceUrl,
          item.publishedAt || null,
        ],
      );
      if (result.affectedRows) inserted += 1;
    }
    await connection.execute("DELETE FROM ai_news_items WHERE digest_date < DATE_SUB(CURDATE(), INTERVAL 30 DAY)");
    return { inserted };
  });
}

function normalizeRefreshTime(value) {
  const text = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) throw new Error("更新时间格式应为 HH:mm");
  const [hour, minute] = text.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error("更新时间格式应为 HH:mm");
  return text;
}

function buildCaseFilter({ category = "all", q = "" } = {}) {
  const clauses = [];
  const params = {};
  if (category && category !== "all") {
    clauses.push("pc.category_id = :category");
    params.category = category;
  }
  if (q) {
    clauses.push("(pc.title LIKE :q OR pc.author LIKE :q OR pc.prompt LIKE :q)");
    params.q = `%${q}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

function normalizePageNumber(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(Math.floor(number), max);
}

export async function countCases({ category = "all", q = "" } = {}) {
  const { where, params } = buildCaseFilter({ category, q });
  const rows = await query(
    `SELECT COUNT(*) AS total
      FROM prompt_cases pc JOIN categories c ON c.id = pc.category_id
      ${where}`,
    params,
  );
  return Number(rows[0]?.total || 0);
}

export async function getNextCaseNumber(categoryId) {
  const category = String(categoryId || "").trim();
  if (!category) throw new Error("请选择分类");
  const categories = await query("SELECT id FROM categories WHERE id = :categoryId", { categoryId: category });
  if (!categories[0]) throw new Error("分类不存在");
  const rows = await query(
    `SELECT MAX(case_number) AS maxCaseNumber
      FROM prompt_cases
      WHERE category_id = :categoryId`,
    { categoryId: category },
  );
  return {
    categoryId: category,
    nextCaseNumber: Number(rows[0]?.maxCaseNumber || 0) + 1,
  };
}

export async function listCases({ category = "all", q = "", limit = 600, offset = 0 } = {}) {
  await ensureCaseUsageSchema();
  const { where, params } = buildCaseFilter({ category, q });
  const safeLimit = normalizePageNumber(limit, 600, 1200);
  const safeOffset = normalizePageNumber(offset, 0, 1000000);
  return query(
    `SELECT pc.id, pc.case_number AS caseNumber, pc.category_id AS categoryId, c.name AS categoryName,
      pc.title, pc.author, pc.source_url AS sourceUrl, pc.image_path AS image, pc.prompt, pc.source_file AS sourceFile,
      pc.created_at AS createdAt, pc.updated_at AS updatedAt, COALESCE(cu.useCount, 0) AS useCount
      FROM prompt_cases pc JOIN categories c ON c.id = pc.category_id
      LEFT JOIN (
        SELECT case_id, COUNT(*) AS useCount
        FROM case_usage_events
        GROUP BY case_id
      ) cu ON cu.case_id = pc.id
      ${where}
      ORDER BY COALESCE(cu.useCount, 0) DESC, COALESCE(pc.case_number, 0) DESC, pc.id DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );
}

export async function recordCaseUse({ caseId, userId = null, source = null }) {
  await ensureCaseUsageSchema();
  const normalizedCaseId = Number(caseId);
  if (!Number.isFinite(normalizedCaseId) || normalizedCaseId <= 0) throw new Error("案例不存在");
  const cases = await query("SELECT id FROM prompt_cases WHERE id = :caseId", { caseId: normalizedCaseId });
  if (!cases[0]) throw new Error("案例不存在");

  const normalizedUserId = normalizeOptionalPositiveInteger(userId);
  await query(
    `INSERT INTO case_usage_events (case_id, user_id, source)
     VALUES (:caseId, :userId, :source)`,
    {
      caseId: normalizedCaseId,
      userId: normalizedUserId,
      source: normalizeCaseUseSource(source),
    },
  );
  const rows = await query(
    "SELECT COUNT(*) AS useCount FROM case_usage_events WHERE case_id = :caseId",
    { caseId: normalizedCaseId },
  );
  return { ok: true, caseId: normalizedCaseId, useCount: Number(rows[0]?.useCount || 0) };
}

export async function createCase(input) {
  const result = await query(
    `INSERT INTO prompt_cases (case_number, category_id, title, author, source_url, image_path, prompt, source_file)
     VALUES (:caseNumber, :categoryId, :title, :author, :sourceUrl, :image, :prompt, :sourceFile)`,
    normalizeCase(input),
  );
  return { id: result.insertId };
}

export async function updateCase(id, input) {
  await query(
    `UPDATE prompt_cases SET case_number = :caseNumber, category_id = :categoryId, title = :title,
      author = :author, source_url = :sourceUrl, image_path = :image, prompt = :prompt, source_file = :sourceFile
      WHERE id = :id`,
    { ...normalizeCase(input), id },
  );
}

export async function deleteCase(id) {
  await query("DELETE FROM prompt_cases WHERE id = :id", { id });
}

export async function upsertProvider(input) {
  const enabled = input.enabled ? 1 : 0;
  if (input.id) {
    if (input.apiKey) {
      await query(
        `UPDATE providers SET name = :name, base_url = :baseUrl, api_key = :apiKey, default_model = :defaultModel, enabled = :enabled
         WHERE id = :id`,
        { ...input, enabled },
      );
    } else {
      // 编辑时未填写 Key：保留原 Key
      await query(
        `UPDATE providers SET name = :name, base_url = :baseUrl, default_model = :defaultModel, enabled = :enabled
         WHERE id = :id`,
        { name: input.name, baseUrl: input.baseUrl, defaultModel: input.defaultModel, enabled, id: input.id },
      );
    }
    return { id: Number(input.id) };
  }
  const result = await query(
    `INSERT INTO providers (name, base_url, api_key, default_model, enabled)
     VALUES (:name, :baseUrl, :apiKey, :defaultModel, :enabled)`,
    { ...input, enabled },
  );
  return { id: result.insertId };
}

export async function setProviderEnabled({ id, enabled }) {
  await query("UPDATE providers SET enabled = :enabled WHERE id = :id", {
    id,
    enabled: enabled ? 1 : 0,
  });
}

export async function deleteProvider(id) {
  await query("DELETE FROM providers WHERE id = :id", { id });
}

export async function upsertPrice(input) {
  const enabled = input.enabled ? 1 : 0;
  if (input.id) {
    await query(
      `UPDATE model_prices SET provider_id = :providerId, model = :model, display_name = :displayName,
       unit_price_cents = :unitPriceCents, enabled = :enabled WHERE id = :id`,
      { ...input, enabled },
    );
    return { id: Number(input.id) };
  }
  const result = await query(
    `INSERT INTO model_prices (provider_id, model, display_name, unit_price_cents, enabled)
     VALUES (:providerId, :model, :displayName, :unitPriceCents, :enabled)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name),
       unit_price_cents = VALUES(unit_price_cents),
       enabled = VALUES(enabled)`,
    { ...input, enabled },
  );
  return { id: result.insertId };
}

export async function setPriceEnabled({ id, enabled }) {
  await query("UPDATE model_prices SET enabled = :enabled WHERE id = :id", {
    id,
    enabled: enabled ? 1 : 0,
  });
}

export async function deletePrice(id) {
  await query("DELETE FROM model_prices WHERE id = :id", { id });
}

export async function createUser({ email, name, password, role = "user", phone = null }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query(
    "INSERT INTO users (email, name, password_hash, role, phone) VALUES (:email, :name, :passwordHash, :role, :phone)",
    { email, name, passwordHash, role, phone },
  );
  return { id: result.insertId };
}

export async function verifyLogin({ email, password }) {
  const rows = await query("SELECT id, email, name, password_hash AS passwordHash, role, balance_cents AS balanceCents FROM users WHERE email = :email", { email });
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new Error("账号或密码错误");
  }
  delete user.passwordHash;
  return user;
}

/** 扣减用户余额并记一笔消费流水（用于推导提示词等功能性收费），余额不足时报错 */
export async function chargeUserFee({ userId, amountCents, note }) {
  return withTransaction(async (connection) => {
    const [[user]] = await connection.execute("SELECT id, balance_cents AS balanceCents FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!user) throw new Error("用户不存在");
    const nextBalance = Number(user.balanceCents) - Math.abs(Number(amountCents));
    if (nextBalance < 0) throw new Error("余额不足，请先充值");
    await connection.execute("UPDATE users SET balance_cents = ? WHERE id = ?", [nextBalance, userId]);
    await connection.execute(
      "INSERT INTO wallet_transactions (user_id, type, amount_cents, balance_after_cents, note) VALUES (?, 'consume', ?, ?, ?)",
      [userId, -Math.abs(amountCents), nextBalance, note || "功能消费"],
    );
    return { balanceCents: nextBalance };
  });
}

export async function rechargeUser({ userId, amountCents, note }) {  return withTransaction(async (connection) => {
    const [[user]] = await connection.execute("SELECT id, balance_cents AS balanceCents FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!user) throw new Error("用户不存在");
    const nextBalance = Number(user.balanceCents) + Number(amountCents);
    await connection.execute("UPDATE users SET balance_cents = ? WHERE id = ?", [nextBalance, userId]);
    await connection.execute(
      "INSERT INTO wallet_transactions (user_id, type, amount_cents, balance_after_cents, note) VALUES (?, 'recharge', ?, ?, ?)",
      [userId, amountCents, nextBalance, note || "管理员充值"],
    );
    return { balanceCents: nextBalance };
  });
}

export async function listWallet(userId, { from, to } = {}) {
  const viewer = await getWalletViewer(userId);
  const clauses = viewer.role === "admin" ? [] : ["w.user_id = :userId"];
  const params = { userId };
  if (from) {
    clauses.push("w.created_at >= :fromTime");
    params.fromTime = beijingDateToUtcSql(from, false);
  }
  if (to) {
    clauses.push("w.created_at <= :toTime");
    params.toTime = beijingDateToUtcSql(to, true);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return query(
    `SELECT w.id, w.user_id AS userId, u.name AS userName, u.email AS userEmail, u.phone AS userPhone,
      w.type, w.amount_cents AS amountCents, w.balance_after_cents AS balanceAfterCents, w.note, w.created_at AS createdAt
     FROM wallet_transactions w JOIN users u ON u.id = w.user_id ${where} ORDER BY w.id DESC LIMIT 500`,
    params,
  );
}

async function getWalletViewer(userId) {
  const rows = await query("SELECT id, role FROM users WHERE id = :userId", { userId });
  if (!rows[0]) throw new Error("用户不存在");
  return rows[0];
}

function beijingDateToUtcSql(dateValue, endOfDay) {
  const match = String(dateValue || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(dateValue || "");
  const [, y, m, d] = match.map(Number);
  const utc = endOfDay
    ? new Date(Date.UTC(y, m - 1, d, 15, 59, 59))
    : new Date(Date.UTC(y, m - 1, d, -8, 0, 0));
  return utc.toISOString().slice(0, 19).replace("T", " ");
}

export async function listCreations(viewerId, { userId, from, to } = {}) {
  const viewer = await getWalletViewer(viewerId);
  const clauses = viewer.role === "admin" ? [] : ["c.user_id = :viewerId"];
  const params = { viewerId };
  if (viewer.role === "admin" && userId && userId !== "all") {
    clauses.push("c.user_id = :filterUserId");
    params.filterUserId = userId;
  }
  if (from) {
    clauses.push("c.created_at >= :fromTime");
    params.fromTime = beijingDateToUtcSql(from, false);
  }
  if (to) {
    clauses.push("c.created_at <= :toTime");
    params.toTime = beijingDateToUtcSql(to, true);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return query(
    `SELECT c.id, c.user_id AS userId, u.name AS userName, u.email AS userEmail, u.phone AS userPhone,
      c.case_id AS caseId, c.model, c.prompt, c.charge_cents AS chargeCents, c.status, c.image_url AS imageUrl,
      c.error_message AS errorMessage, c.created_at AS createdAt
     FROM creations c JOIN users u ON u.id = c.user_id ${where} ORDER BY c.id DESC LIMIT 500`,
    params,
  );
}

export async function getGenerationContext({ userId, priceId }) {
  const users = await query("SELECT id, balance_cents AS balanceCents FROM users WHERE id = :userId", { userId });
  const prices = await query(
    `SELECT mp.id, mp.model, mp.unit_price_cents AS unitPriceCents, p.id AS providerId, p.name AS providerName,
      p.base_url AS baseUrl, p.api_key AS apiKey, p.enabled AS providerEnabled, mp.enabled AS priceEnabled
     FROM model_prices mp JOIN providers p ON p.id = mp.provider_id WHERE mp.id = :priceId`,
    { priceId },
  );
  if (!users[0]) throw new Error("用户不存在");
  if (!prices[0]) throw new Error("模型价格不存在");
  if (!prices[0].providerEnabled || !prices[0].priceEnabled) throw new Error("供应商或模型未启用");
  return { user: users[0], price: prices[0] };
}

export async function getGenerationContextByDisplayName({ userId, displayName }) {
  const users = await query("SELECT id, balance_cents AS balanceCents FROM users WHERE id = :userId", { userId });
  const prices = await query(
    `SELECT mp.id, mp.model, mp.unit_price_cents AS unitPriceCents, p.id AS providerId, p.name AS providerName,
      p.base_url AS baseUrl, p.api_key AS apiKey, p.enabled AS providerEnabled, mp.enabled AS priceEnabled
     FROM model_prices mp JOIN providers p ON p.id = mp.provider_id
     WHERE mp.display_name = :displayName AND mp.enabled = 1 AND p.enabled = 1
     ORDER BY mp.id`,
    { displayName },
  );
  if (!users[0]) throw new Error("用户不存在");
  if (!prices.length) throw new Error("本站模型不可用");
  return { user: users[0], prices };
}

export async function recordGeneration({ userId, caseId, providerId, model, prompt, chargeCents, status, imageUrl, errorMessage, skipCharge = false, chargeNote = null }) {
  return withTransaction(async (connection) => {
    const [[user]] = await connection.execute("SELECT balance_cents AS balanceCents FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!user) throw new Error("用户不存在");
    const nextBalance = Number(user.balanceCents) - Number(chargeCents);
    if (status === "succeeded" && !skipCharge) {
      await connection.execute("UPDATE users SET balance_cents = ? WHERE id = ?", [nextBalance, userId]);
      await connection.execute(
        "INSERT INTO wallet_transactions (user_id, type, amount_cents, balance_after_cents, note) VALUES (?, 'consume', ?, ?, ?)",
        [userId, -Math.abs(chargeCents), nextBalance, `${chargeNote || "图片生成"}：${model}`],
      );
    } else if (status === "succeeded" && skipCharge) {
      // 单次付费：余额不变，仅记一笔流水方便用户对账
      await connection.execute(
        "INSERT INTO wallet_transactions (user_id, type, amount_cents, balance_after_cents, note) VALUES (?, 'consume', ?, ?, ?)",
        [userId, -Math.abs(chargeCents), Number(user.balanceCents), `${chargeNote || "单次支付"}：${model}`],
      );
    }
    const [result] = await connection.execute(
      `INSERT INTO creations (user_id, case_id, provider_id, model, prompt, charge_cents, status, image_url, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, caseId || null, providerId, model, prompt, chargeCents, status, imageUrl || null, errorMessage || null],
    );
    return { id: result.insertId, balanceCents: status === "succeeded" && !skipCharge ? nextBalance : Number(user.balanceCents) };
  });
}

export async function createVideoTaskRecord({ userId, model, prompt, chargeCents, status = "queued", providerTaskId, params }) {
  const result = await query(
    `INSERT INTO video_tasks (user_id, model, prompt, charge_cents, status, provider_task_id, params_json)
     VALUES (:userId, :model, :prompt, :chargeCents, :status, :providerTaskId, :paramsJson)`,
    {
      userId,
      model,
      prompt,
      chargeCents,
      status,
      providerTaskId,
      paramsJson: JSON.stringify(params || {}),
    },
  );
  return getVideoTask(result.insertId, userId);
}

export async function getVideoTask(id, userId) {
  const rows = await query(
    `SELECT id, user_id AS userId, model, prompt, charge_cents AS chargeCents, status,
      provider_task_id AS providerTaskId, video_url AS videoUrl, error_message AS errorMessage,
      params_json AS paramsJson, charged, creation_id AS creationId, created_at AS createdAt, updated_at AS updatedAt
     FROM video_tasks WHERE id = :id AND user_id = :userId`,
    { id, userId },
  );
  if (!rows[0]) throw new Error("视频任务不存在");
  return normalizeVideoTaskRow(rows[0]);
}

export async function updateVideoTask({ id, userId, status, videoUrl = null, errorMessage = null }) {
  await query(
    `UPDATE video_tasks SET status = :status, video_url = :videoUrl, error_message = :errorMessage
     WHERE id = :id AND user_id = :userId`,
    { id, userId, status, videoUrl, errorMessage },
  );
  return getVideoTask(id, userId);
}

export async function finalizeSuccessfulVideoTask({ id, userId, videoUrl }) {
  return withTransaction(async (connection) => {
    const [[task]] = await connection.execute(
      `SELECT id, model, prompt, charge_cents AS chargeCents, charged, creation_id AS creationId
       FROM video_tasks WHERE id = ? AND user_id = ? FOR UPDATE`,
      [id, userId],
    );
    if (!task) throw new Error("视频任务不存在");
    if (!task.charged) {
      const [[user]] = await connection.execute("SELECT balance_cents AS balanceCents FROM users WHERE id = ? FOR UPDATE", [userId]);
      if (!user) throw new Error("用户不存在");
      if (Number(user.balanceCents) < Number(task.chargeCents)) throw new Error("余额不足，视频已生成但扣费失败，请联系管理员处理");
      const nextBalance = Number(user.balanceCents) - Number(task.chargeCents);
      await connection.execute("UPDATE users SET balance_cents = ? WHERE id = ?", [nextBalance, userId]);
      await connection.execute(
        "INSERT INTO wallet_transactions (user_id, type, amount_cents, balance_after_cents, note) VALUES (?, 'consume', ?, ?, ?)",
        [userId, -Math.abs(task.chargeCents), nextBalance, `视频生成：${task.model}`],
      );
      const [creation] = await connection.execute(
        `INSERT INTO creations (user_id, case_id, provider_id, model, prompt, charge_cents, status, image_url, error_message)
         VALUES (?, NULL, NULL, ?, ?, ?, 'succeeded', ?, NULL)`,
        [userId, task.model, task.prompt, task.chargeCents, videoUrl],
      );
      await connection.execute(
        "UPDATE video_tasks SET status = 'succeeded', video_url = ?, charged = 1, creation_id = ? WHERE id = ?",
        [videoUrl, creation.insertId, id],
      );
    } else {
      await connection.execute("UPDATE video_tasks SET status = 'succeeded', video_url = ? WHERE id = ?", [videoUrl, id]);
    }
    const [rows] = await connection.execute(
      `SELECT id, user_id AS userId, model, prompt, charge_cents AS chargeCents, status,
        provider_task_id AS providerTaskId, video_url AS videoUrl, error_message AS errorMessage,
        params_json AS paramsJson, charged, creation_id AS creationId, created_at AS createdAt, updated_at AS updatedAt
       FROM video_tasks WHERE id = ?`,
      [id],
    );
    return normalizeVideoTaskRow(rows[0]);
  });
}

function normalizeVideoTaskRow(row) {
  return {
    ...row,
    charged: Boolean(row.charged),
    params: safeJson(row.paramsJson),
  };
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function normalizeCase(input) {
  return {
    caseNumber: input.caseNumber ? Number(input.caseNumber) : null,
    categoryId: input.categoryId,
    title: input.title,
    author: input.author || null,
    sourceUrl: input.sourceUrl || null,
    image: input.image || null,
    prompt: input.prompt,
    sourceFile: input.sourceFile || "manual",
  };
}

function normalizeOptionalPositiveInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function normalizeCaseUseSource(value) {
  const source = String(value || "").trim();
  return source ? source.slice(0, 32) : null;
}

function maskProviders(providers) {
  return providers.map((provider) => ({
    ...provider,
    hasApiKey: true,
  }));
}
