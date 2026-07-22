import assert from "node:assert/strict";
import test from "node:test";

import { generateImage } from "../lib/adapters/openai-image";

const PROVIDER_ENV = {
  GPT_IMAGE2_API_URL: "http://provider.test/openApi/generate",
  GPT_IMAGE2_PROJECT_CODE: "project-code",
  GPT_IMAGE2_ACCESS_KEY: "access-key",
  GPT_IMAGE2_SECRET_KEY: "secret-key",
  GPT_IMAGE2_MODEL_ID: "gpt-image2-low",
  GPT_IMAGE2_RESOLUTION: "1K",
  IMAGE_MODEL_PROVIDER: "openapi"
} as const;

const ENV_KEYS = [
  ...Object.keys(PROVIDER_ENV),
  "OPENAI_IMAGE_API_KEY",
  "YUNWU_API_KEY"
] as const;

async function withProvider(
  fetcher: typeof fetch,
  run: () => Promise<void>
) {
  const previousFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, PROVIDER_ENV);
  delete process.env.OPENAI_IMAGE_API_KEY;
  delete process.env.YUNWU_API_KEY;
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

test("sends the project OpenAPI request and preserves the public image result", async () => {
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;

  await withProvider(async (url, init) => {
    receivedUrl = String(url);
    receivedInit = init;
    return Response.json({
      sid: "request-1",
      sign: null,
      success: true,
      code: 0,
      msg: "成功",
      data: { images: [{ url: "https://img.test/cat.jpg" }] }
    });
  }, async () => {
    const result = await generateImage({ prompt: "橘猫", size: "3:4", count: 1 });

    assert.equal(receivedUrl, "http://provider.test/openApi/generate");
    assert.deepEqual(receivedInit?.headers, {
      Accept: "application/json",
      "Content-Type": "application/json",
      projectCode: "project-code",
      "X-Access-Key": "access-key",
      "X-Secret-Key": "secret-key"
    });
    const requestBody = JSON.parse(String(receivedInit?.body));
    assert.equal(requestBody.modelId, "gpt-image2-low");
    assert.equal(requestBody.abilityType, "IMAGE");
    assert.match(requestBody.prompt, /橘猫/);
    assert.deepEqual(requestBody.payload, {
      params: { resolution: "1K", scale: "3:4" }
    });
    assert.equal(result.provider, "Image 2.0");
    assert.equal(result.model, "gpt-image2-low");
    assert.equal(result.images?.[0]?.url, "https://img.test/cat.jpg");
  });
});

test("treats an HTTP 200 provider rejection as an error", async () => {
  await withProvider(async () => Response.json({
    sid: null,
    sign: null,
    success: false,
    code: null,
    msg: "IP 不在白名单",
    data: null
  }), async () => {
    await assert.rejects(
      generateImage({ prompt: "橘猫", count: 1 }),
      /Image 2\.0 生成失败：IP 不在白名单/
    );
  });
});

test("rejects reference-image input before making a provider request", async () => {
  let calls = 0;
  await withProvider(async () => {
    calls += 1;
    return Response.json({ success: true, data: null });
  }, async () => {
    await assert.rejects(
      generateImage({
        prompt: "只换背景",
        sourceImageUrls: ["https://img.test/source.jpg"]
      }),
      /新接口暂不支持参考图编辑/
    );
    assert.equal(calls, 0);
  });
});

test("makes exactly one request per image and parses bounded URL and base64 fields", async () => {
  let calls = 0;
  await withProvider(async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json({
        sid: "not-an-image-url",
        sign: "not-an-image-url",
        success: true,
        code: 0,
        msg: "成功",
        data: { result: { imageUrl: "https://img.test/first.jpg" } }
      });
    }
    return Response.json({
      sid: "still-not-an-image-url",
      sign: null,
      success: true,
      code: 0,
      msg: "成功",
      data: { output: { base64: "YWJj" } }
    });
  }, async () => {
    const result = await generateImage({ prompt: "橘猫", count: 2 });

    assert.equal(calls, 2);
    assert.deepEqual(
      result.images?.map((image) => image.url),
      ["https://img.test/first.jpg", "data:image/jpeg;base64,YWJj"]
    );
  });
});
