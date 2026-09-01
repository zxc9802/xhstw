import assert from "node:assert/strict";
import test from "node:test";

import { generateWithApiyi } from "../lib/adapters/apiyi-image";

const PROVIDER_ENV = {
  APIYI_IMAGE_API_KEY: "test-apiyi-key",
  APIYI_IMAGE_URL: "https://apiyi.test/v1/images/generations",
  APIYI_IMAGE_EDIT_URL: "https://apiyi.test/v1/images/edits",
  APIYI_IMAGE_MODEL: "gpt-image-2-vip"
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

test("sends one APIYI generation request without n or quality", async () => {
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;
  await withProvider(async (url, init) => {
    receivedUrl = String(url);
    receivedInit = init;
    return Response.json({ data: [{ b64_json: "YWJj" }] });
  }, async () => {
    const result = await generateWithApiyi({
      provider: "gpt-image2-vip",
      prompt: "白底红苹果",
      size: "3:4",
      count: 1
    });
    assert.equal(receivedUrl, PROVIDER_ENV.APIYI_IMAGE_URL);
    assert.deepEqual(receivedInit?.headers, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer test-apiyi-key"
    });
    const body = JSON.parse(String(receivedInit?.body)) as Record<string, unknown>;
    assert.deepEqual(body, {
      model: "gpt-image-2-vip",
      prompt: "白底红苹果",
      size: "1536x2048",
      response_format: "b64_json"
    });
    assert.equal("n" in body, false);
    assert.equal("quality" in body, false);
    assert.equal(result.provider, "gpt-image2-vip");
    assert.equal(result.model, "gpt-image-2-vip");
    assert.equal(result.images[0].url, "data:image/png;base64,YWJj");
  });
});

test("maps every page ratio to an APIYI 2K size", async () => {
  const expected = new Map([
    ["1:1", "2048x2048"],
    ["3:4", "1536x2048"],
    ["4:3", "2048x1536"],
    ["9:16", "1152x2048"],
    ["16:9", "2048x1152"],
    ["unknown", "2048x2048"]
  ]);
  for (const [ratio, size] of expected) {
    await withProvider(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { size?: string };
      assert.equal(body.size, size);
      return Response.json({ data: [{ url: "https://img.test/result.png" }] });
    }, async () => {
      await generateWithApiyi({ prompt: "比例测试", size: ratio, count: 1 });
    });
  }
});

test("makes one APIYI request per requested image", async () => {
  let calls = 0;
  await withProvider(async () => {
    calls += 1;
    return Response.json({ data: [{ url: `https://img.test/${calls}.png` }] });
  }, async () => {
    const result = await generateWithApiyi({ prompt: "三张图", count: 3 });
    assert.equal(calls, 3);
    assert.equal(result.images.length, 3);
  });
});

test("preserves an already-prefixed base64 result", async () => {
  await withProvider(async () => Response.json({
    data: [{ b64_json: "data:image/webp;base64,YWJj" }]
  }), async () => {
    const result = await generateWithApiyi({ prompt: "前缀测试" });
    assert.equal(result.images[0].url, "data:image/webp;base64,YWJj");
  });
});

test("treats an HTTP 200 provider refusal as an error", async () => {
  await withProvider(async () => Response.json({
    success: false,
    message: "provider refused"
  }), async () => {
    await assert.rejects(
      generateWithApiyi({ prompt: "拒绝测试" }),
      /gpt-image2-vip 生成失败：provider refused/
    );
  });
});

test("rejects a successful response without image data", async () => {
  await withProvider(async () => Response.json({ data: [] }), async () => {
    await assert.rejects(
      generateWithApiyi({ prompt: "空结果测试" }),
      /API易未返回图片数据/
    );
  });
});

test("fails clearly when APIYI_IMAGE_API_KEY is missing", async () => {
  const previous = process.env.APIYI_IMAGE_API_KEY;
  delete process.env.APIYI_IMAGE_API_KEY;
  try {
    await assert.rejects(
      generateWithApiyi({ provider: "gpt-image2-vip", prompt: "测试" }),
      /gpt-image2-vip 配置缺失：APIYI_IMAGE_API_KEY/
    );
  } finally {
    if (previous === undefined) delete process.env.APIYI_IMAGE_API_KEY;
    else process.env.APIYI_IMAGE_API_KEY = previous;
  }
});

test("surfaces an APIYI error without exposing credentials", async () => {
  await withProvider(async () => Response.json(
    { error: { message: "upstream rejected" } },
    { status: 429 }
  ), async () => {
    await assert.rejects(
      generateWithApiyi({ prompt: "失败测试" }),
      /gpt-image2-vip 生成失败：upstream rejected/
    );
  });
});
