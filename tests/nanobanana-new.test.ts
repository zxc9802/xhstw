import assert from "node:assert/strict";
import test from "node:test";

import { generateWithNanobananaNew } from "../lib/adapters/nanobanana-new";

const PROVIDER_ENV = {
  IMAGE_AGGREGATION_API_BASE_URL: "https://aggregation.test",
  IMAGE_AGGREGATION_PROJECT_CODE: "project-code",
  IMAGE_AGGREGATION_ACCESS_KEY: "access-key",
  IMAGE_AGGREGATION_SECRET_KEY: "secret-key",
  NANOBANANA_NEW_MODEL_ID: "gemini-3.1-flash-image-preview",
  NANOBANANA_NEW_POLL_INTERVAL_MS: "0",
  NANOBANANA_NEW_POLL_MAX_ATTEMPTS: "3"
} as const;

const ENV_KEYS = Object.keys(PROVIDER_ENV) as Array<keyof typeof PROVIDER_ENV>;

async function withProvider(fetcher: typeof fetch, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, PROVIDER_ENV);
  globalThis.fetch = fetcher;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("submits and polls a nanobanan新 aggregation image task", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  await withProvider(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/openApi/generate")) {
      return Response.json({ success: true, data: { taskId: "task-1" } });
    }
    return Response.json({
      success: true,
      data: {
        taskId: "task-1",
        status: 2,
        images: [{ url: "https://img.test/result.png" }]
      }
    });
  }, async () => {
    const result = await generateWithNanobananaNew({
      prompt: "只替换背景",
      size: "3:4",
      count: 1,
      sourceImageUrls: ["https://app.test/reference/source.png"]
    });

    assert.equal(calls[0].url, "https://aggregation.test/openApi/generate");
    assert.deepEqual(calls[0].init?.headers, {
      Accept: "application/json",
      "Content-Type": "application/json",
      projectCode: "project-code",
      "X-Access-Key": "access-key",
      "X-Secret-Key": "secret-key"
    });
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      modelId: "gemini-3.1-flash-image-preview",
      abilityType: "IMAGE",
      prompt: "只替换背景",
      payload: {
        resources: ["https://app.test/reference/source.png"],
        params: { resolution: "1K", scale: "3:4" }
      }
    });
    assert.equal(calls[1].url, "https://aggregation.test/openApi/queryResult");
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
      taskId: "task-1",
      abilityType: "IMAGE"
    });
    assert.equal(result.provider, "nanobanan新");
    assert.equal(result.model, "gemini-3.1-flash-image-preview");
    assert.equal(result.images[0].url, "https://img.test/result.png");
    assert.equal(result.images[0].provider, "nanobanan新");
  });
});

test("keeps the original prompt for generation without reference images", async () => {
  let submitBody: Record<string, unknown> | undefined;

  await withProvider(async (_url, init) => {
    submitBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      success: true,
      data: { images: [{ url: "https://img.test/text-to-image.png" }] }
    });
  }, async () => {
    await generateWithNanobananaNew({
      prompt: "雨天街头的自然抓拍",
      size: "3:4",
      count: 1
    });
  });

  assert.equal(submitBody?.prompt, "雨天街头的自然抓拍");
  assert.deepEqual(submitBody?.payload, {
    params: { resolution: "1K", scale: "3:4" }
  });
});

test("sends an empty prompt unchanged when the user leaves it blank", async () => {
  let submitBody: Record<string, unknown> | undefined;

  await withProvider(async (_url, init) => {
    submitBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      success: true,
      data: { images: [{ url: "https://img.test/blank-prompt.png" }] }
    });
  }, async () => {
    await generateWithNanobananaNew({
      prompt: "   ",
      size: "3:4",
      count: 1,
      sourceImageUrls: ["https://app.test/reference/source.png"]
    });
  });

  assert.equal(submitBody?.prompt, "");
});

test("rejects missing aggregation configuration", async () => {
  const previous = process.env.IMAGE_AGGREGATION_SECRET_KEY;
  delete process.env.IMAGE_AGGREGATION_SECRET_KEY;
  try {
    await assert.rejects(
      generateWithNanobananaNew({ prompt: "测试" }),
      /IMAGE_AGGREGATION_SECRET_KEY/
    );
  } finally {
    if (previous === undefined) delete process.env.IMAGE_AGGREGATION_SECRET_KEY;
    else process.env.IMAGE_AGGREGATION_SECRET_KEY = previous;
  }
});

test("rejects an aggregation provider refusal", async () => {
  await withProvider(
    async () => Response.json({ success: false, msg: "余额不足" }),
    async () => {
      await assert.rejects(
        generateWithNanobananaNew({ prompt: "测试" }),
        /nanobanan新生成失败：余额不足/
      );
    }
  );
});

test("rejects a submit response without an image or task id", async () => {
  await withProvider(
    async () => Response.json({ success: true, data: {} }),
    async () => {
      await assert.rejects(
        generateWithNanobananaNew({ prompt: "测试" }),
        /响应未返回图片或 taskId/
      );
    }
  );
});

test("surfaces a terminal aggregation task failure", async () => {
  await withProvider(async (url) => {
    if (String(url).endsWith("/openApi/generate")) {
      return Response.json({ success: true, data: { taskId: "task-failed" } });
    }
    return Response.json({
      success: true,
      data: { taskId: "task-failed", status: 3, message: "内容审核未通过" }
    });
  }, async () => {
    await assert.rejects(
      generateWithNanobananaNew({ prompt: "测试" }),
      /nanobanan新生成失败：内容审核未通过/
    );
  });
});

test("stops polling after the configured attempt limit", async () => {
  let queryCalls = 0;
  await withProvider(async (url) => {
    if (String(url).endsWith("/openApi/generate")) {
      return Response.json({ success: true, data: { taskId: "task-pending" } });
    }
    queryCalls += 1;
    return Response.json({
      success: true,
      data: { taskId: "task-pending", status: 1 }
    });
  }, async () => {
    await assert.rejects(
      generateWithNanobananaNew({ prompt: "测试" }),
      /nanobanan新生成超时/
    );
    assert.equal(queryCalls, 3);
  });
});

test("rejects a completed task without an image url", async () => {
  await withProvider(async (url) => {
    if (String(url).endsWith("/openApi/generate")) {
      return Response.json({ success: true, data: { taskId: "task-empty" } });
    }
    return Response.json({
      success: true,
      data: { taskId: "task-empty", status: 2 }
    });
  }, async () => {
    await assert.rejects(
      generateWithNanobananaNew({ prompt: "测试" }),
      /已完成，但未返回图片地址/
    );
  });
});

test("rejects an unknown aggregation task status", async () => {
  await withProvider(async (url) => {
    if (String(url).endsWith("/openApi/generate")) {
      return Response.json({ success: true, data: { taskId: "task-unknown" } });
    }
    return Response.json({
      success: true,
      data: { taskId: "task-unknown", status: 9 }
    });
  }, async () => {
    await assert.rejects(
      generateWithNanobananaNew({ prompt: "测试" }),
      /返回未知状态 9/
    );
  });
});
