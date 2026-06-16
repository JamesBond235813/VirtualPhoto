const IMAGE_MODEL_HINTS = ["image", "dall", "flux", "stable-diffusion", "sdxl", "midjourney"];

export function modelsEndpoint(baseUrl) {
  const url = new URL(String(baseUrl || "").replace(/\/+$/, ""));
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? `${path}/models` : `${path}/v1/models`;
  return url.toString();
}

export async function discoverModels({ baseUrl, apiKey }) {
  const response = await fetch(modelsEndpoint(baseUrl), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `模型列表获取失败：HTTP ${response.status}`);
  }
  return parseModelList(payload);
}

export function parseModelList(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .filter((item) => isImageLike(item.id || item.model || item.name || item.display_name || ""))
    .map((item) => {
      const price = extractUnitPriceCents(item);
      return {
        id: String(item.id || item.model || "").trim(),
        displayName: String(item.name || item.display_name || item.id || item.model || "").trim(),
        unitPriceCents: price.unitPriceCents,
        priceSource: price.priceSource,
      };
    })
    .filter((item) => item.id)
    .sort((a, b) => Number(isImageLike(b.id)) - Number(isImageLike(a.id)) || a.id.localeCompare(b.id));
}

function extractUnitPriceCents(item) {
  const centPaths = [
    ["unit_price_cents"],
    ["price_cents"],
    ["pricing", "unit_price_cents"],
    ["pricing", "image_generation_cents"],
    ["pricing", "image_cents"],
    ["pricing", "per_image_cents"],
  ];
  for (const path of centPaths) {
    const value = readPath(item, path);
    if (isMoneyNumber(value)) {
      return { unitPriceCents: Math.round(Number(value)), priceSource: path.join(".") };
    }
  }

  const yuanOrDollarPaths = [
    ["pricing", "image_generation"],
    ["pricing", "image"],
    ["pricing", "per_image"],
    ["pricing", "generation"],
    ["price"],
  ];
  for (const path of yuanOrDollarPaths) {
    const value = readPath(item, path);
    if (isMoneyNumber(value)) {
      return { unitPriceCents: Math.round(Number(value) * 100), priceSource: path.join(".") };
    }
  }

  return { unitPriceCents: 0, priceSource: "not_found" };
}

function readPath(source, path) {
  return path.reduce((value, key) => (value && value[key] !== undefined ? value[key] : undefined), source);
}

function isMoneyNumber(value) {
  return value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function isImageLike(modelId) {
  const normalized = String(modelId).toLowerCase();
  return IMAGE_MODEL_HINTS.some((hint) => normalized.includes(hint));
}
