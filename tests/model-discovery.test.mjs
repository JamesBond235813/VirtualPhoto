import assert from "node:assert/strict";
import test from "node:test";

import { modelsEndpoint, parseModelList } from "../server/model-discovery.mjs";

test("builds a models endpoint from root or v1 base urls", () => {
  assert.equal(modelsEndpoint("https://api.example.com"), "https://api.example.com/v1/models");
  assert.equal(modelsEndpoint("https://api.example.com/v1"), "https://api.example.com/v1/models");
});

test("parses only image model ids and common image price metadata", () => {
  const models = parseModelList({
    data: [
      { id: "gpt-image-1", pricing: { image_generation: "0.04" } },
      { id: "gpt-4.1", pricing: { prompt: "0.000001" } },
      { id: "image-model-cents", unit_price_cents: 9 },
    ],
  });

  assert.deepEqual(models, [
    {
      id: "gpt-image-1",
      displayName: "gpt-image-1",
      unitPriceCents: 4,
      priceSource: "pricing.image_generation",
    },
    {
      id: "image-model-cents",
      displayName: "image-model-cents",
      unitPriceCents: 9,
      priceSource: "unit_price_cents",
    },
  ]);
});
