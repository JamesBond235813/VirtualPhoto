import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOpenNanaCase,
  normalizeOpenNanaImageUrl,
  selectOpenNanaImageUrl,
  selectOpenNanaPrompt,
} from "../scripts/opennana-import-utils.mjs";

test("selects the original prompt text while preserving labeled alternatives", () => {
  const prompt = selectOpenNanaPrompt({
    prompts: [
      { type: "zh", label: "中文提示词", text: "一张电影感人像" },
      { type: "en", label: "English prompt", text: "A cinematic portrait with soft rim light" },
    ],
  });

  assert.equal(
    prompt,
    "A cinematic portrait with soft rim light\n\n[中文提示词]\n一张电影感人像",
  );
});

test("chooses the best available image and normalizes OpenNana relative paths", () => {
  const imageUrl = selectOpenNanaImageUrl(
    { images: ["prompts/assets/202606/sample.jpg"], thumbnail: "pthumbs/prompts/images/17-480.jpg" },
    { cover_image: "https://img.opennana.com/pthumbs/prompts/assets/fallback.jpg" },
  );

  assert.equal(imageUrl, "https://img.opennana.com/prompts/assets/202606/sample.jpg");
  assert.equal(
    normalizeOpenNanaImageUrl("pthumbs/prompts/images/17-480.jpg"),
    "https://img.opennana.com/pthumbs/prompts/images/17-480.jpg",
  );
});

test("classifies imported cases into site category groups", () => {
  assert.equal(
    classifyOpenNanaCase({ title: "韩系大头贴四格拼贴时尚少女", prompt: "fashion photo booth collage portrait" }),
    "portrait",
  );
  assert.equal(
    classifyOpenNanaCase({ title: "咖啡饮品商业广告海报", prompt: "product advertising poster for iced coffee" }),
    "ecommerce",
  );
  assert.equal(
    classifyOpenNanaCase({ title: "移动端 App 登陆界面", prompt: "clean UI dashboard app interface" }),
    "ui",
  );
  assert.equal(
    classifyOpenNanaCase({ title: "世界杯足球宝贝球场人像摄影", prompt: "realistic portrait photography, exquisite appearance, confident pose" }),
    "portrait",
  );
});
