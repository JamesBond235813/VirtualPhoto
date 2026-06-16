import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoPrompt,
  createVolcengineVideoTask,
  getVolcengineVideoTask,
  parseVideoTask,
  uploadedFilesToVideoAssets,
  videoEndpoint,
} from "../server/volcengine-video.mjs";

test("builds Volcengine video endpoints from the Ark base url", () => {
  assert.equal(
    videoEndpoint("https://ark.cn-beijing.volces.com/api/v3", "contents/generations/tasks"),
    "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
  );
  assert.equal(
    videoEndpoint("https://ark.cn-beijing.volces.com/api/v3/", "/contents/generations/tasks/task-1"),
    "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task-1",
  );
});

test("builds a concise video prompt with ratio, duration, resolution, and watermark options", () => {
  assert.equal(
    buildVideoPrompt({
      prompt: "一只猫在窗边喝咖啡",
      ratio: "9:16",
      duration: "5",
      resolution: "720p",
      watermark: false,
    }),
    "一只猫在窗边喝咖啡 --ratio 9:16 --duration 5 --resolution 720p --watermark false",
  );
});

test("createVolcengineVideoTask posts an async video generation task", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return jsonResponse({ id: "task-123", status: "queued" });
  };

  try {
    const result = await createVolcengineVideoTask({
      apiKey: "ark-test",
      baseUrl: "https://ark.example/api/v3",
      model: "doubao-seedance-2-0-260128",
      prompt: "雨夜街头电影感镜头",
      images: [{ mime: "image/png", base64: "aGVsbG8=" }],
      ratio: "16:9",
      duration: "10",
      resolution: "720p",
    });

    assert.equal(result.taskId, "task-123");
    assert.equal(captured.url, "https://ark.example/api/v3/contents/generations/tasks");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers.Authorization, "Bearer ark-test");
    const body = JSON.parse(captured.options.body);
    assert.equal(body.model, "doubao-seedance-2-0-260128");
    assert.equal(body.content[0].type, "text");
    assert.match(body.content[0].text, /--ratio 16:9 --duration 10 --resolution 720p/);
    assert.deepEqual(body.content[1], {
      type: "image_url",
      image_url: { url: "data:image/png;base64,aGVsbG8=" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createVolcengineVideoTask can send reference videos for video-to-video", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return jsonResponse({ id: "task-video-123", status: "queued" });
  };

  try {
    const result = await createVolcengineVideoTask({
      apiKey: "ark-test",
      baseUrl: "https://ark.example/api/v3",
      model: "doubao-seedance-2-0-260128",
      prompt: "保留人物动作，改成电影感雨夜",
      videos: [{ mime: "video/mp4", base64: "dmlkZW8=" }],
      ratio: "16:9",
      duration: "5",
      resolution: "720p",
    });

    assert.equal(result.taskId, "task-video-123");
    const body = JSON.parse(captured.options.body);
    assert.deepEqual(body.content[1], {
      type: "video_url",
      video_url: { url: "data:video/mp4;base64,dmlkZW8=" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadedFilesToVideoAssets separates image and video uploads", async () => {
  const assets = await uploadedFilesToVideoAssets([
    { path: new URL("volcengine-video.test.mjs", import.meta.url), mimetype: "image/png" },
    { path: new URL("volcengine-video.test.mjs", import.meta.url), mimetype: "video/mp4" },
  ]);

  assert.equal(assets.images.length, 1);
  assert.equal(assets.videos.length, 1);
  assert.equal(assets.images[0].mime, "image/png");
  assert.equal(assets.videos[0].mime, "video/mp4");
});

test("getVolcengineVideoTask normalizes succeeded task video urls", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    id: "task-123",
    status: "succeeded",
    content: { video_url: "https://cdn.example/video.mp4" },
  });

  try {
    assert.deepEqual(
      await getVolcengineVideoTask({
        apiKey: "ark-test",
        baseUrl: "https://ark.example/api/v3",
        taskId: "task-123",
      }),
      {
        taskId: "task-123",
        status: "succeeded",
        videoUrl: "https://cdn.example/video.mp4",
        errorMessage: "",
        raw: {
          id: "task-123",
          status: "succeeded",
          content: { video_url: "https://cdn.example/video.mp4" },
        },
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseVideoTask handles alternate task status and url shapes", () => {
  assert.deepEqual(
    parseVideoTask({
      task_id: "task-9",
      status: "SUCCESS",
      result: { video: { url: "https://cdn.example/a.mp4" } },
    }),
    {
      taskId: "task-9",
      status: "succeeded",
      videoUrl: "https://cdn.example/a.mp4",
      errorMessage: "",
      raw: {
        task_id: "task-9",
        status: "SUCCESS",
        result: { video: { url: "https://cdn.example/a.mp4" } },
      },
    },
  );
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}
