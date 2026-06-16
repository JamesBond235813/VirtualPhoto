const IMG_HOST = "https://img.opennana.com/";

const CATEGORY_RULES = [
  {
    id: "comparison",
    keywords: [
      "before after",
      "comparison",
      "compare",
      "versus",
      "vs",
      "对比",
      "前后",
      "改造",
      "重绘",
      "修复",
    ],
  },
  {
    id: "ui",
    keywords: [
      "app",
      "dashboard",
      "interface",
      "ui",
      "ux",
      "website",
      "web page",
      "icon",
      "logo",
      "social media",
      "instagram",
      "界面",
      "应用",
      "图标",
      "标志",
      "小红书",
      "社媒",
      "仪表盘",
      "移动端",
    ],
  },
  {
    id: "character",
    keywords: [
      "character",
      "mascot",
      "toy",
      "figure",
      "cartoon",
      "anime",
      "chibi",
      "lego",
      "doll",
      "blind box",
      "角色",
      "手办",
      "玩具",
      "卡通",
      "动漫",
      "吉祥物",
      "公仔",
      "盲盒",
      "积木",
    ],
  },
  {
    id: "ecommerce",
    keywords: [
      "product",
      "e-commerce",
      "ecommerce",
      "commerce",
      "packaging",
      "bottle",
      "perfume",
      "cosmetic",
      "lipstick",
      "coffee",
      "drink",
      "beverage",
      "food",
      "livestream",
      "商品",
      "产品",
      "电商",
      "包装",
      "饮品",
      "饮料",
      "咖啡",
      "美食",
      "香水",
      "口红",
      "化妆品",
      "带货",
      "好物",
    ],
  },
  {
    id: "portrait",
    keywords: [
      "portrait",
      "headshot",
      "selfie",
      "photo booth",
      "fashion",
      "woman",
      "girl",
      "man",
      "male",
      "female",
      "model",
      "beauty",
      "korean",
      "street style",
      "人像",
      "写真",
      "肖像",
      "自拍",
      "大头贴",
      "美女",
      "少女",
      "女孩",
      "女性",
      "男性",
      "模特",
      "时尚",
      "穿搭",
      "韩系",
      "足球宝贝",
    ],
  },
  {
    id: "ad-creative",
    keywords: [
      "advertising",
      "advertisement",
      "campaign",
      "commercial",
      "creative ad",
      "brand",
      "branding",
      "营销",
      "广告",
      "创意",
      "品牌",
      "宣传",
      "推广",
    ],
  },
  {
    id: "poster",
    keywords: [
      "poster",
      "illustration",
      "painting",
      "typography",
      "watercolor",
      "cinematic",
      "landscape",
      "scene",
      "海报",
      "插画",
      "绘画",
      "排版",
      "电影感",
      "风景",
      "场景",
      "装饰画",
    ],
  },
];

export function selectOpenNanaPrompt(detail = {}) {
  const prompts = Array.isArray(detail.prompts)
    ? detail.prompts
        .map((item) => ({
          type: String(item?.type || "").toLowerCase(),
          label: String(item?.label || "").trim(),
          text: String(item?.text || "").trim(),
        }))
        .filter((item) => item.text)
    : [];
  if (!prompts.length) return String(detail.description || detail.title || "").trim();

  const primary = prompts.find((item) => item.type === "en") || prompts[0];
  const alternatives = prompts
    .filter((item) => item !== primary && item.text !== primary.text)
    .map((item) => `\n\n[${item.label || item.type || "Prompt"}]\n${item.text}`);
  return `${primary.text}${alternatives.join("")}`.trim();
}

export function normalizeOpenNanaImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const duplicateHost = `${IMG_HOST}pthumbs/${IMG_HOST}`;
  if (raw.startsWith(duplicateHost)) return raw.slice(`${IMG_HOST}pthumbs/`.length);
  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(raw.replace(/^\/+/, ""), IMG_HOST).href;
}

export function selectOpenNanaImageUrl(detail = {}, listItem = {}) {
  const candidates = [
    ...(Array.isArray(detail.images) ? detail.images : []),
    detail.thumbnail,
    listItem.cover_image,
    listItem.image_url,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeOpenNanaImageUrl(candidate);
    if (normalized) return normalized;
  }
  return "";
}

export function classifyOpenNanaCase({ title = "", prompt = "", tags = [], mediaType = "" } = {}) {
  const haystack = `${title} ${prompt} ${Array.isArray(tags) ? tags.join(" ") : ""} ${mediaType}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => keywordMatches(haystack, keyword))) {
      return rule.id;
    }
  }
  return "poster";
}

function keywordMatches(haystack, keyword) {
  const normalized = keyword.toLowerCase();
  if (/^[a-z0-9]+$/.test(normalized)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`).test(haystack);
  }
  return haystack.includes(normalized);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildOpenNanaCaseInput(detail = {}, listItem = {}, imagePath = "") {
  const prompt = selectOpenNanaPrompt(detail);
  const slug = String(detail.slug || listItem.slug || "").trim();
  const id = Number(detail.id || listItem.id || 0);
  return {
    caseNumber: id ? 100000 + id : null,
    categoryId: classifyOpenNanaCase({
      title: detail.title || listItem.title,
      prompt,
      tags: detail.tags,
      mediaType: detail.media_type || listItem.media_type,
    }),
    title: String(detail.title || listItem.title || slug || "OpenNana 案例").trim(),
    author: String(detail.source_name || detail.submitter_name || "OpenNana").trim(),
    sourceUrl: detail.source_url || (slug ? `https://opennana.com/awesome-prompt-gallery/${slug}` : "https://opennana.com/awesome-prompt-gallery"),
    image: imagePath || selectOpenNanaImageUrl(detail, listItem),
    prompt,
    sourceFile: slug ? `opennana:${slug}` : `opennana:${id}`,
  };
}
