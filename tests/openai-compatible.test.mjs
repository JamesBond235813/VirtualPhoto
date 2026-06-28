import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateImage } from "../server/openai-compatible.mjs";

const provider = {
  baseUrl: "http://user-service.local",
  apiKey: "sk-test",
};

test("text-only generation calls the OpenAI compatible image generation endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return jsonResponse({ data: [{ url: "https://cdn.example/text.png" }] });
  };

  try {
    const imageUrl = await generateImage({
      provider,
      model: "gpt-image-2",
      prompt: "生成一张证件照",
    });

    assert.equal(imageUrl, "https://cdn.example/text.png");
    assert.equal(captured.url, "http://user-service.local/v1/images/generations");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers.Authorization, "Bearer sk-test");
    assert.equal(captured.options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(captured.options.body), {
      model: "gpt-image-2",
      prompt: "生成一张证件照",
      n: 1,
      size: "1024x1024",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reference image generation calls edits with an image multipart field", async () => {
  const originalFetch = globalThis.fetch;
  const imagePath = await writeTempImage("reference.png");
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return jsonResponse({ data: [{ b64_json: Buffer.from("fake-image").toString("base64") }] });
  };

  try {
    const imageUrl = await generateImage({
      provider,
      model: "gpt-image-2",
      prompt: "按参考图生成新照片",
      imagePath,
    });

    assert.match(imageUrl, /^\/uploads\/generated\/.+\.png$/);
    assert.equal(captured.url, "http://user-service.local/v1/images/edits");
    assert.equal(captured.options.headers.Authorization, "Bearer sk-test");
    const multipart = multipartText(captured.options);
    assertMultipartField(multipart, "model", "gpt-image-2");
    assertMultipartField(multipart, "prompt", "按参考图生成新照片");
    assertMultipartField(multipart, "size", "1024x1024");
    assertMultipartFile(multipart, "image");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("multiple reference images use repeated image multipart fields for gpt-image edits", async () => {
  const originalFetch = globalThis.fetch;
  const imagePaths = [await writeTempImage("first.png"), await writeTempImage("second.png")];
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return jsonResponse({ data: [{ url: "https://cdn.example/combined.png" }] });
  };

  try {
    const imageUrl = await generateImage({
      provider,
      model: "gpt-image-2",
      prompt: "融合两张参考图生成新照片",
      imagePaths,
    });

    assert.equal(imageUrl, "https://cdn.example/combined.png");
    assert.equal(captured.url, "http://user-service.local/v1/images/edits");
    const multipart = multipartText(captured.options);
    assert.equal(countMultipartFiles(multipart, "image"), 2);
    assert.equal(countMultipartFiles(multipart, "image[]"), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gpt-image image edits do not fall back to chat completions after upstream image failure", async () => {
  const originalFetch = globalThis.fetch;
  const imagePath = await writeTempImage("reference.png");
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return jsonResponse({ error: { message: "upstream did not return image output" } }, 502);
  };

  try {
    await assert.rejects(
      () => generateImage({
        provider,
        model: "gpt-image-2",
        prompt: "按参考图生成新照片",
        imagePath,
      }),
      (error) => {
        assert.match(error.message, /图生图失败：HTTP 502 · upstream did not return image output/);
        assert.doesNotMatch(error.message, /chat|多模态|only supported on/);
        return true;
      },
    );
    assert.deepEqual(urls, ["http://user-service.local/v1/images/edits"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mask edits include both image and mask multipart fields", async () => {
  const originalFetch = globalThis.fetch;
  const imagePath = await writeTempImage("reference.png");
  const maskPath = await writeTempImage("mask.png");
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return jsonResponse({ data: [{ url: "https://cdn.example/masked.png" }] });
  };

  try {
    const imageUrl = await generateImage({
      provider,
      model: "gpt-image-2",
      prompt: "只重绘衣服区域",
      imagePath,
      maskPath,
    });

    assert.equal(imageUrl, "https://cdn.example/masked.png");
    assert.equal(captured.url, "http://user-service.local/v1/images/edits");
    const multipart = multipartText(captured.options);
    assertMultipartFile(multipart, "image");
    assertMultipartFile(multipart, "mask");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
    async json() {
      return payload;
    },
  };
}

async function writeTempImage(fileName) {
  const dir = path.join(os.tmpdir(), "ai-photo-tests");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);
  await writeFile(filePath, Buffer.from("fake-png"));
  return filePath;
}

function multipartText(options) {
  assert.match(options.headers["Content-Type"], /^multipart\/form-data; boundary=----aiphoto[a-f0-9]+$/);
  assert.ok(Buffer.isBuffer(options.body));
  return options.body.toString("utf8");
}

function assertMultipartField(text, name, value) {
  assert.match(text, new RegExp(`Content-Disposition: form-data; name="${escapeRegExp(name)}"\\r\\n\\r\\n${escapeRegExp(value)}\\r\\n`));
}

function assertMultipartFile(text, name) {
  assert.match(
    text,
    new RegExp(`Content-Disposition: form-data; name="${escapeRegExp(name)}"; filename="[^"]+\\.png"\\r\\nContent-Type: image/png\\r\\n\\r\\nfake-png\\r\\n`),
  );
}

function countMultipartFiles(text, name) {
  const pattern = new RegExp(`Content-Disposition: form-data; name="${escapeRegExp(name)}"; filename="[^"]+"`, "g");
  return [...text.matchAll(pattern)].length;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
