import { getSetting, listAiNewsItems, replaceAiNewsItems, setSetting } from "./repository.mjs";

const SOURCE_QUERIES = [
  { category: "新模型", sourceName: "Google News", query: "AI model release OR large language model release" },
  { category: "中转站价格", sourceName: "Google News", query: "AI API pricing token price model gateway" },
  { category: "舞弊风控", sourceName: "Google News", query: "AI fraud cheating abuse model API" },
  { category: "福利羊毛", sourceName: "Google News", query: "AI credits free trial token promotion" },
  { category: "法规政策", sourceName: "Google News", query: "中国 人工智能 token 大模型 法规 政策" },
  { category: "法规政策", sourceName: "Google News", query: "China artificial intelligence regulation large model token" },
];

const DIRECT_FEEDS = [
  { category: "新模型", sourceName: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { category: "新模型", sourceName: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" },
  { category: "中转站价格", sourceName: "The Decoder", url: "https://the-decoder.com/feed/" },
  { category: "舞弊风控", sourceName: "AI News", url: "https://www.artificialintelligence-news.com/feed/" },
];

export async function getAiNewsDigest() {
  const [items, lastUpdatedAt, refreshTime] = await Promise.all([
    listAiNewsItems({ limit: 48 }),
    getSetting("aiNewsLastUpdatedAt", ""),
    getSetting("aiNewsRefreshTime", "09:00"),
  ]);
  return { items, lastUpdatedAt, refreshTime };
}

export async function refreshAiNews({ summarize }) {
  const entries = await collectNewsEntries();
  const picked = pickDiverseEntries(entries, 18);
  const items = [];
  const digestDate = beijingDateKey(new Date());
  for (const entry of picked) {
    items.push({
      digestDate,
      category: entry.category,
      title: entry.title,
      summary: await summarizeEntry(entry, summarize),
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl,
      publishedAt: entry.publishedAt,
    });
  }
  await replaceAiNewsItems(items);
  const lastUpdatedAt = new Date().toISOString();
  await setSetting("aiNewsLastUpdatedAt", lastUpdatedAt);
  return { items: await listAiNewsItems({ limit: 48 }), lastUpdatedAt };
}

async function collectNewsEntries() {
  const batches = await Promise.allSettled([
    ...DIRECT_FEEDS.map(fetchDirectFeed),
    ...SOURCE_QUERIES.map(fetchGoogleNews),
  ]);
  return batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
}

async function fetchDirectFeed(source) {
  const response = await fetch(source.url, {
    headers: { "User-Agent": "Mozilla/5.0 AI-Photo-Studio-News" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`新闻源不可达：${source.sourceName}`);
  const xml = await response.text();
  return parseRssItems(xml).map((item) => ({
    ...item,
    category: source.category,
    sourceName: item.sourceName || source.sourceName,
  }));
}

async function fetchGoogleNews(source) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", source.query);
  url.searchParams.set("hl", "zh-CN");
  url.searchParams.set("gl", "CN");
  url.searchParams.set("ceid", "CN:zh-Hans");
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 AI-Photo-Studio-News" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`新闻源不可达：${response.sourceName || source.sourceName}`);
  const xml = await response.text();
  return parseRssItems(xml).map((item) => ({
    ...item,
    category: source.category,
    sourceName: item.sourceName || source.sourceName,
  }));
}

function parseRssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((match) => {
    const block = match[1];
    const title = cleanText(xmlTag(block, "title"));
    const sourceUrl = cleanText(xmlTag(block, "link"));
    const publishedAt = parseRssDate(cleanText(xmlTag(block, "pubDate")));
    const sourceName = cleanText(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "");
    return { title, sourceUrl, publishedAt, sourceName };
  }).filter((item) => item.title && item.sourceUrl);
}

function pickDiverseEntries(entries, maxItems) {
  const seen = new Set();
  const byCategory = new Map();
  for (const entry of entries) {
    const key = normalizeNewsKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = byCategory.get(entry.category) || [];
    bucket.push(entry);
    byCategory.set(entry.category, bucket);
  }
  const picked = [];
  while (picked.length < maxItems && [...byCategory.values()].some((bucket) => bucket.length)) {
    for (const bucket of byCategory.values()) {
      const item = bucket.shift();
      if (item) picked.push(item);
      if (picked.length >= maxItems) break;
    }
  }
  return picked;
}

async function summarizeEntry(entry, summarize) {
  if (!summarize) return fallbackSummary(entry);
  try {
    const result = await summarize(entry);
    return result.trim().slice(0, 220) || fallbackSummary(entry);
  } catch {
    return fallbackSummary(entry);
  }
}

function fallbackSummary(entry) {
  return cleanText(entry.title).replace(/\s+-\s+[^-]+$/, "").slice(0, 160);
}

function xmlTag(block, tag) {
  return block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "";
}

function cleanText(value) {
  return decodeXml(String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseRssDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeNewsKey(entry) {
  return String(entry.sourceUrl || entry.title).replace(/[?#].*$/, "").toLowerCase();
}

function beijingDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
