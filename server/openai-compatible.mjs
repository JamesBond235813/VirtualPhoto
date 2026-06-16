import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";

import { nanoid } from "nanoid";

const IMAGE_UPSTREAM_TIMEOUT_MS = Number(process.env.IMAGE_UPSTREAM_TIMEOUT_MS || 240000);

export async function generateImage({ provider, model, prompt, imagePath, imagePaths, maskPath }) {
  const paths = imagePaths?.length ? imagePaths : imagePath ? [imagePath] : [];
  if (paths.length) {
    // 局部重绘依赖蒙版，只能走 images/edits
    if (maskPath) {
      try {
        return await editImage({ provider, model, prompt, imagePaths: paths, maskPath });
      } catch (error) {
        throw new Error(`${error.message}（局部重绘需要模型支持 images/edits 接口）`);
      }
    }
    // 文+图：GPT Image / DALL-E 等 images 专用模型只能走 images/edits；Gemini / Banana 等聊天式图片模型优先走 chat 多模态
    if (isImagesEndpointOnlyModel(model)) {
      return await editImage({ provider, model, prompt, imagePaths: paths });
    }
    const chatFirst = isChatImageModel(model);
    const attempts = chatFirst ? [chatEditImage, editImage] : [editImage, chatEditImage];
    const errors = [];
    for (const attempt of attempts) {
      try {
        return await attempt({ provider, model, prompt, imagePaths: paths });
      } catch (error) {
        errors.push(`${attempt === chatEditImage ? "多模态通道" : "edits 通道"}：${error.message}`);
      }
    }
    throw new Error(`图生图失败（两个通道均未成功）。${errors.join("；")}`);
  }
  const endpoint = openAiEndpoint(provider.baseUrl, "images/generations");
  const response = await fetchUpstream(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "1024x1024",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error?.message || payload.message;
    throw new Error(`生成失败：HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
  }

  return imageFromPayload(payload);
}

async function editImage({ provider, model, prompt, imagePaths, maskPath }) {
  const endpoint = openAiEndpoint(provider.baseUrl, "images/edits");
  const files = await Promise.all(imagePaths.map((item) => readUploadFile(item)));
  const mask = maskPath ? await readUploadFile(maskPath, "mask.png") : null;

  const fieldName = files.length > 1 ? "image[]" : "image";
  const parts = [
    { name: "model", value: model },
    { name: "prompt", value: prompt },
    { name: "size", value: "1024x1024" },
    ...files.map((file) => ({ name: fieldName, filename: file.name, mime: file.mime, data: file.bytes })),
  ];
  if (mask) parts.push({ name: "mask", filename: mask.name, mime: mask.mime, data: mask.bytes });
  const { body, contentType } = buildMultipart(parts);
  const errors = [];

  // 形态1：undici fetch 发送 multipart（一次性 Buffer + 显式 Content-Length）
  try {
    const response = await fetchUpstream(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": contentType },
      body,
    });
    return await parseUpstream(response, "图生图失败");
  } catch (error) {
    if (/上游连接超时|请求超时/.test(error.message)) throw error;
    if (!/上游连接(?:失败|超时)/.test(error.message)) throw error; // 业务错误直接抛出
    errors.push(`fetch形态：${error.message}`);
  }

  // 形态2：Node 原生 https 模块发送同一份 multipart（不同 HTTP 栈，规避对 fetch 指纹的拦截）
  try {
    const { status, text } = await rawPost(endpoint, {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": contentType,
      "User-Agent": "Mozilla/5.0 ai-photo-studio/1.0",
      Accept: "application/json",
    }, body);
    return await parsePayloadText(status, text, "图生图失败");
  } catch (error) {
    if (/上游连接超时|请求超时/.test(error.message)) throw error;
    if (!/上游连接(?:失败|超时)/.test(error.message)) throw error;
    errors.push(`原生https形态：${error.message}`);
  }

  // 形态3：JSON + base64（部分网关支持）
  const dataUrls = files.map((file) => `data:${file.mime};base64,${file.bytes.toString("base64")}`);
  const jsonBody = { model, prompt, size: "1024x1024", image: dataUrls.length > 1 ? dataUrls : dataUrls[0] };
  if (mask) jsonBody.mask = `data:${mask.mime};base64,${mask.bytes.toString("base64")}`;
  try {
    const response = await fetchUpstream(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(jsonBody),
    });
    return await parseUpstream(response, "图生图失败（JSON 形态）");
  } catch (error) {
    errors.push(`JSON形态：${error.message}`);
    throw new Error(errors.join("；"));
  }
}

/** Node 原生 http/https POST（独立于 undici 的传输栈） */
function rawPost(endpoint, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const lib = url.protocol === "http:" ? httpRequest : httpsRequest;
    const req = lib(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: url.pathname + url.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        timeout: 180000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", (error) => reject(new Error(`上游连接失败：${error.message}（${error.code || "raw"}）`)));
    req.end(body);
  });
}

/** 解析以纯文本拿到的上游响应 */
async function parsePayloadText(status, raw, prefix) {
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    /* 非 JSON */
  }
  if (status < 200 || status >= 300) {
    const detail = payload.error?.message || payload.message || String(raw).slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(`${prefix}：HTTP ${status}${detail ? ` · ${detail}` : ""}`);
  }
  return imageFromPayload(payload);
}

/** 手工编码 multipart/form-data：返回完整 Buffer 与 Content-Type（含 boundary） */
function buildMultipart(parts) {
  const boundary = `----aiphoto${crypto.randomBytes(12).toString("hex")}`;
  const chunks = [];
  for (const part of parts) {
    const head = part.filename
      ? `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.mime || "application/octet-stream"}\r\n\r\n`
      : `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n`;
    chunks.push(Buffer.from(head, "utf8"));
    chunks.push(part.filename ? part.data : Buffer.from(String(part.value ?? ""), "utf8"));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** 聊天式图片模型（gemini / nano banana / seedream 等）：带图生成走 chat 多模态 */
function isChatImageModel(model) {
  return /gemini|flash-image|nano-?banana|seedream|seededit/i.test(String(model || ""));
}

function isImagesEndpointOnlyModel(model) {
  return /^(?:gpt-image|dall-e)/i.test(String(model || ""));
}

/** chat/completions 多模态图生图：消息携带文本 + dataURL 图片，从回复中提取生成图 */
async function chatEditImage({ provider, model, prompt, imagePaths }) {
  const endpoint = openAiEndpoint(provider.baseUrl, "chat/completions");
  const content = [{ type: "text", text: prompt }];
  for (const item of imagePaths) {
    const { bytes, mime } = await readUploadFile(item);
    content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } });
  }

  const response = await fetchUpstream(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content }] }),
  });

  const raw = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    /* 非 JSON 响应 */
  }
  if (!response.ok) {
    const detail = payload.error?.message || payload.message || raw.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(`HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
  }
  return imageFromChatPayload(payload);
}

/** 兼容各家中转的回图形态：message.images / content 图片分片 / dataURL / markdown 图链 */
async function imageFromChatPayload(payload) {
  const message = payload.choices?.[0]?.message || {};
  let url =
    message.images?.[0]?.image_url?.url ||
    message.images?.[0]?.url ||
    null;

  if (!url && Array.isArray(message.content)) {
    const part = message.content.find((p) => p?.type === "image_url" && p.image_url?.url);
    if (part) url = part.image_url.url;
  }
  if (!url && typeof message.content === "string") {
    const dataMatch = message.content.match(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/i);
    const mdMatch = message.content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
    const plainMatch = message.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)(?:\?\S*)?/i);
    url = dataMatch?.[0] || mdMatch?.[1] || plainMatch?.[0] || null;
  }
  if (!url) {
    const text = typeof message.content === "string" ? message.content.slice(0, 120).replace(/\s+/g, " ") : "";
    throw new Error(`多模态接口未返回图片${text ? `（模型回复：${text}…）` : ""}`);
  }
  if (url.startsWith("data:")) {
    return saveBase64Image(url.replace(/^data:image\/[a-z+.-]+;base64,/i, ""));
  }
  return url;
}

/** 读取 multer 落盘文件：补全 MIME 与带扩展名的 ASCII 安全文件名
   （multer 临时文件无后缀；中文等非 ASCII 文件名部分网关会拒收） */
async function readUploadFile(item, fallbackName) {
  const filePath = typeof item === "string" ? item : item.path;
  const mime = (typeof item === "object" && item.mimetype) || "image/png";
  const original = (typeof item === "object" && item.originalname) || fallbackName || path.basename(filePath);
  const extMatch = original.match(/\.[a-z0-9]{2,5}$/i);
  const extension = extMatch
    ? extMatch[0].toLowerCase()
    : { "image/jpeg": ".jpg", "image/webp": ".webp" }[mime] || ".png";
  const base = original.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\x20-\x7E]/g, "").replace(/[^\w-]/g, "_").slice(0, 40) || "image";
  return { bytes: await readFile(filePath), name: `${base}${extension}`, mime };
}

/** 统一解析上游响应：非 JSON / 无错误字段时附带原始报文片段便于定位 */
async function parseUpstream(response, prefix) {
  const raw = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    /* 上游返回非 JSON（如网关 HTML 错误页） */
  }
  if (!response.ok) {
    const detail = payload.error?.message || payload.message || raw.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(`${prefix}：HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
  }
  return imageFromPayload(payload);
}

async function fetchUpstream(endpoint, options, timeoutMs = IMAGE_UPSTREAM_TIMEOUT_MS) {
  try {
    return await fetch(endpoint, { ...options, signal: options.signal || AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isTimeoutError(error)) throw new Error("上游连接超时：模型响应过慢，请稍后重试或换一个模型");
    const code = error.cause?.code || error.cause?.message || "";
    throw new Error(`上游连接失败：${error.message}${code ? `（${code}）` : ""}`);
  }
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    error?.cause?.code === "UND_ERR_HEADERS_TIMEOUT" ||
    /timeout/i.test(String(error?.cause?.message || error?.message || ""));
}

function openAiEndpoint(baseUrl, resource) {
  const url = new URL(String(baseUrl || "").replace(/\/+$/, ""));
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? `${path}/${resource}` : `${path}/v1/${resource}`;
  return url.toString();
}

function imageFromPayload(payload) {
  const item = payload.data?.[0];
  if (!item) {
    throw new Error("生成接口没有返回图片");
  }
  if (item.url) {
    return item.url;
  }
  if (item.b64_json) {
    return saveBase64Image(item.b64_json);
  }
  throw new Error("生成接口返回格式不包含 url 或 b64_json");
}

async function saveBase64Image(base64) {
  const dir = path.resolve("uploads/generated");
  await mkdir(dir, { recursive: true });
  const fileName = `${Date.now()}-${nanoid(8)}.png`;
  await writeFile(path.join(dir, fileName), Buffer.from(base64, "base64"));
  return `/uploads/generated/${fileName}`;
}
