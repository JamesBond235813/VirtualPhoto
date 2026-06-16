import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { query } from "../server/db.mjs";
import {
  buildOpenNanaCaseInput,
  normalizeOpenNanaImageUrl,
  selectOpenNanaImageUrl,
} from "./opennana-import-utils.mjs";

const API_ROOT = "https://api.opennana.com/api";
const PAGE_LIMIT = 100;
const DEFAULT_DETAIL_CONCURRENCY = 8;
const DEFAULT_IMAGE_CONCURRENCY = 5;
const JSON_TIMEOUT_MS = 15000;
const IMAGE_TIMEOUT_MS = 7000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const progressPath = path.join(rootDir, "data/opennana_import_progress.json");

const args = parseArgs(process.argv.slice(2));
const detailConcurrency = Number(args.detailConcurrency || args.concurrency || DEFAULT_DETAIL_CONCURRENCY);
const imageConcurrency = Number(args.imageConcurrency || DEFAULT_IMAGE_CONCURRENCY);
const maxItems = args.maxItems ? Number(args.maxItems) : Infinity;
const maxPages = args.pages ? Number(args.pages) : Infinity;
const startPage = args.startPage ? Number(args.startPage) : 1;
const dryRun = Boolean(args.dryRun);
const skipImages = Boolean(args.skipImages);

const stats = {
  seen: 0,
  details: 0,
  inserted: 0,
  skippedExisting: 0,
  skippedSponsor: 0,
  skippedMissing: 0,
  imageFailed: 0,
  failed: 0,
};

await mkdir(path.dirname(progressPath), { recursive: true });
await mkdir(path.join(rootDir, "images"), { recursive: true });

console.log(`[OpenNana] 开始导入：startPage=${startPage}, maxPages=${Number.isFinite(maxPages) ? maxPages : "all"}, maxItems=${Number.isFinite(maxItems) ? maxItems : "all"}`);
if (dryRun) console.log("[OpenNana] 当前为 dry-run，不会写入数据库。");

let importedCandidates = 0;
let totalPages = startPage;
for (let page = startPage; page <= totalPages && page < startPage + maxPages; page += 1) {
  const pageData = await fetchPromptPage(page);
  totalPages = Number(pageData.pagination?.total_pages || totalPages || page);
  const items = (pageData.items || []).filter((item) => {
    if (item?._is_sponsor) {
      stats.skippedSponsor += 1;
      return false;
    }
    return true;
  });
  const remaining = maxItems - importedCandidates;
  const pageItems = Number.isFinite(remaining) ? items.slice(0, Math.max(0, remaining)) : items;
  importedCandidates += pageItems.length;
  stats.seen += pageItems.length;

  await mapLimit(pageItems, detailConcurrency, importListItem);
  await writeProgress({ page, totalPages, stats, updatedAt: new Date().toISOString() });
  console.log(`[OpenNana] page ${page}/${totalPages} 完成：inserted=${stats.inserted}, existing=${stats.skippedExisting}, failed=${stats.failed}, imageFailed=${stats.imageFailed}`);

  if (importedCandidates >= maxItems) break;
}

console.log(`[OpenNana] 导入结束：${JSON.stringify(stats)}`);
process.exit(stats.failed ? 1 : 0);

async function importListItem(listItem) {
  const slug = String(listItem?.slug || "").trim();
  if (!slug) {
    stats.skippedMissing += 1;
    return;
  }

  try {
    const sourceFile = `opennana:${slug}`;
    const exists = await query("SELECT id FROM prompt_cases WHERE source_file = :sourceFile LIMIT 1", { sourceFile });
    if (exists.length) {
      stats.skippedExisting += 1;
      return;
    }

    const detail = await fetchPromptDetail(slug);
    stats.details += 1;
    const remoteImage = selectOpenNanaImageUrl(detail, listItem);
    if (!remoteImage) {
      stats.skippedMissing += 1;
      return;
    }

    const downloadImages = selectOpenNanaDownloadUrls(detail, listItem, remoteImage);
    const localImage = skipImages ? "" : await downloadCaseImage({ detail, listItem, remoteImages: downloadImages }).catch((error) => {
      stats.imageFailed += 1;
      console.warn(`[OpenNana] 图片下载失败，改用远程图：${slug} ${error.message}`);
      return "";
    });
    const input = buildOpenNanaCaseInput(detail, listItem, localImage || remoteImage);
    if (!input.prompt) {
      stats.skippedMissing += 1;
      return;
    }

    if (dryRun) {
      stats.inserted += 1;
      return;
    }

    await query(
      `INSERT INTO prompt_cases (case_number, category_id, title, author, source_url, image_path, prompt, source_file)
       VALUES (:caseNumber, :categoryId, :title, :author, :sourceUrl, :image, :prompt, :sourceFile)`,
      input,
    );
    stats.inserted += 1;
  } catch (error) {
    stats.failed += 1;
    console.warn(`[OpenNana] 导入失败：${slug || listItem?.id || "unknown"} ${error.message}`);
  }
}

async function fetchPromptPage(page) {
  const url = new URL(`${API_ROOT}/prompts`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("sort", "reviewed_at");
  url.searchParams.set("order", "DESC");
  const payload = await fetchJson(url.href);
  return payload.data || payload;
}

async function fetchPromptDetail(slug) {
  const payload = await fetchJson(`${API_ROOT}/prompts/${encodeURIComponent(slug)}`);
  return payload.data || payload;
}

async function fetchJson(url, retries = 4) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0 AI-Photo-Studio OpenNana Importer",
        },
        signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(`HTTP ${response.status}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(350 * (attempt + 1));
    }
  }
  throw lastError;
}

async function downloadCaseImage({ detail, listItem, remoteImages }) {
  const id = Number(detail.id || listItem.id || Date.now());
  const dir = path.join(rootDir, "images", `opennana_case${id}`);
  await mkdir(dir, { recursive: true });
  let lastError;
  for (const remoteImage of remoteImages) {
    try {
      const response = await fetch(remoteImage, {
        headers: { "user-agent": "Mozilla/5.0 AI-Photo-Studio OpenNana Importer" },
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      const ext = imageExtension(remoteImage, contentType);
      const filePath = path.join(dir, `output${ext}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(filePath, buffer);
      return path.relative(rootDir, filePath).split(path.sep).join("/");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("无可下载图片");
}

function imageExtension(url, contentType) {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
}

function selectOpenNanaDownloadUrls(detail, listItem, fallback) {
  const candidates = [
    listItem.cover_image,
    detail.thumbnail,
    ...(Array.isArray(detail.images) ? detail.images : []),
    fallback,
  ];
  const urls = [];
  for (const candidate of candidates) {
    const normalized = normalizeOpenNanaImageUrl(candidate);
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  }
  return urls;
}

async function writeProgress(payload) {
  const previous = await readFile(progressPath, "utf8").catch(() => "");
  const history = previous ? JSON.parse(previous) : {};
  await writeFile(progressPath, JSON.stringify({ ...history, ...payload }, null, 2));
}

async function mapLimit(items, limit, mapper) {
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < items.length; index += limit) {
      await mapper(items[index], index);
      if (!skipImages && imageConcurrency > 0 && index % imageConcurrency === 0) await sleep(20);
    }
  });
  await Promise.all(workers);
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (const raw of rawArgs) {
    if (!raw.startsWith("--")) continue;
    const [key, value] = raw.slice(2).split("=");
    parsed[toCamelCase(key)] = value ?? true;
  }
  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
