import { readFile } from "node:fs/promises";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_VIDEO_MODEL = "doubao-seedance-2-0-260128";
const DEFAULT_TIMEOUT_MS = 90_000;

export function volcengineVideoConfig(env = process.env) {
  return {
    apiKey: env.ARK_API_KEY || env.VOLCENGINE_API_KEY || "",
    baseUrl: env.VOLCENGINE_BASE_URL || DEFAULT_BASE_URL,
    model: env.VOLCENGINE_VIDEO_MODEL || DEFAULT_VIDEO_MODEL,
    priceCents: yuanToCents(env.VOLCENGINE_VIDEO_PRICE_YUAN || "0"),
    timeoutMs: Number(env.VOLCENGINE_VIDEO_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    pollMs: Number(env.VOLCENGINE_VIDEO_POLL_MS || 5000),
  };
}

export function videoEndpoint(baseUrl, path) {
  const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const suffix = String(path || "").replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

export function buildVideoPrompt({ prompt, ratio = "9:16", duration = "5", resolution = "720p", watermark = false } = {}) {
  const text = String(prompt || "").trim();
  const parts = [];
  if (ratio) parts.push(`--ratio ${ratio}`);
  if (duration) parts.push(`--duration ${duration}`);
  if (resolution) parts.push(`--resolution ${resolution}`);
  if (typeof watermark === "boolean") parts.push(`--watermark ${watermark ? "true" : "false"}`);
  return [text, parts.join(" ")].filter(Boolean).join(" ").trim();
}

export async function uploadedFilesToVideoImages(files = []) {
  return readUploadedFiles(files);
}

export async function uploadedFilesToVideoAssets(files = []) {
  const assets = await readUploadedFiles(files);
  return {
    images: assets.filter((asset) => asset.mime.startsWith("image/")),
    videos: assets.filter((asset) => asset.mime.startsWith("video/")),
  };
}

function readUploadedFiles(files = []) {
  return Promise.all(
    files.map(async (file) => ({
      mime: file.mimetype || file.type || "application/octet-stream",
      base64: (await readFile(file.path)).toString("base64"),
    })),
  );
}

export async function createVolcengineVideoTask({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model = DEFAULT_VIDEO_MODEL,
  prompt,
  images = [],
  videos = [],
  ratio,
  duration,
  resolution,
  watermark = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!apiKey) throw new Error("未配置火山方舟 API Key（ARK_API_KEY 或 VOLCENGINE_API_KEY）");
  if (!model) throw new Error("未配置火山视频模型（VOLCENGINE_VIDEO_MODEL）");
  const content = [
    { type: "text", text: buildVideoPrompt({ prompt, ratio, duration, resolution, watermark }) },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: `data:${image.mime || "image/png"};base64,${image.base64}` },
    })),
    ...videos.map((video) => ({
      type: "video_url",
      video_url: { url: `data:${video.mime || "video/mp4"};base64,${video.base64}` },
    })),
  ];
  const response = await fetch(videoEndpoint(baseUrl, "contents/generations/tasks"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, content }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `火山视频任务创建失败：HTTP ${response.status}`);
  const parsed = parseVideoTask(payload);
  if (!parsed.taskId) throw new Error("火山视频任务创建失败：未返回任务 ID");
  return parsed;
}

export async function getVolcengineVideoTask({ apiKey, baseUrl = DEFAULT_BASE_URL, taskId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!apiKey) throw new Error("未配置火山方舟 API Key（ARK_API_KEY 或 VOLCENGINE_API_KEY）");
  if (!taskId) throw new Error("火山视频任务 ID 不能为空");
  const response = await fetch(videoEndpoint(baseUrl, `contents/generations/tasks/${encodeURIComponent(taskId)}`), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `火山视频任务查询失败：HTTP ${response.status}`);
  return parseVideoTask(payload);
}

export function parseVideoTask(payload = {}) {
  const taskId = String(payload.id || payload.task_id || payload.taskId || "").trim();
  const status = normalizeVideoStatus(payload.status || payload.task_status || payload.state);
  const videoUrl = findVideoUrl(payload);
  const errorMessage = String(
    payload.error?.message ||
      (payload.message && status === "failed" ? payload.message : "") ||
      payload.error_message ||
      payload.fail_reason ||
      "",
  ).trim();
  return { taskId, status, videoUrl, errorMessage, raw: payload };
}

export function normalizeVideoStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["success", "succeeded", "done", "completed"].includes(value)) return "succeeded";
  if (["failed", "fail", "error", "cancelled", "canceled"].includes(value)) return "failed";
  if (["queued", "created", "pending"].includes(value)) return "queued";
  return "running";
}

function findVideoUrl(payload) {
  const direct =
    payload.video_url ||
    payload.videoUrl ||
    payload.output?.video_url ||
    payload.output?.videoUrl ||
    payload.result?.video_url ||
    payload.result?.videoUrl ||
    payload.result?.video?.url ||
    payload.content?.video_url ||
    payload.content?.videoUrl;
  if (direct) return String(direct);
  const serialized = JSON.stringify(payload);
  return serialized.match(/https?:\/\/[^"\\\s]+\.mp4(?:\?[^"\\\s]*)?/i)?.[0] || "";
}

function yuanToCents(value) {
  return Math.round(Number(value || 0) * 100);
}
