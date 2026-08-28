import assert from "node:assert/strict";
import test from "node:test";

import { generateWithOpenlux } from "../lib/adapters/openlux-image";

const PROVIDER_ENV = {
  OPENLUX_API_KEY: "test-openlux-key",
  OPENLUX_IMAGE_URL: "https://openlux.test/v1/images/generations",
  OPENLUX_IMAGE_EDIT_URL: "https://openlux.test/v1/images/edits",
  OPENLUX_IMAGE_MODEL: "gpt-image-2-c"
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

test("sends an OpenLux generation request without the unsupported n parameter", async () => {
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;

  await withProvider(async (url, init) => {
    receivedUrl = String(url);
    receivedInit = init;
    return Response.json({
      created: 1,
      data: [{ b64_json: "YWJj" }]
    });
  }, async () => {
    const result = await generateWithOpenlux({
      provider: "gpt-image-2-c",
      prompt: "白底红苹果",
      size: "3:4",
      count: 1
    });

    assert.equal(receivedUrl, "https://openlux.test/v1/images/generations");
    assert.deepEqual(receivedInit?.headers, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer test-openlux-key"
    });
    const body = JSON.parse(String(receivedInit?.body)) as Record<string, unknown>;
    assert.equal(body.model, "gpt-image-2-c");
    assert.equal(body.prompt, "白底红苹果");
    assert.equal(body.size, "1024x1536");
    assert.equal("n" in body, false);
    assert.equal(result.provider, "gpt-image-2-c");
    assert.equal(result.model, "gpt-image-2-c");
    assert.equal(result.images[0].url, "data:image/jpeg;base64,YWJj");
    assert.equal(result.images[0].provider, "gpt-image-2-c");
  });
});

test("sends OpenLux edits with local reference images", async () => {
  let receivedUrl = "";
  let editForm: FormData | undefined;

  await withProvider(async (url, init) => {
    receivedUrl = String(url);
    editForm = init?.body as FormData;
    return Response.json({
      data: [{ url: "https://img.test/openlux-edit.jpg" }]
    });
  }, async () => {
    const result = await generateWithOpenlux({
      provider: "gpt-image-2-c",
      prompt: "只换背景",
      size: "1:1",
      count: 1,
      sourceImageUrls: ["data:image/png;base64,aGVsbG8="]
    });

    assert.equal(receivedUrl, "https://openlux.test/v1/images/edits");
    assert.equal(editForm?.get("model"), "gpt-image-2-c");
    assert.equal(editForm?.get("prompt"), "只换背景");
    assert.equal(editForm?.get("size"), "1024x1024");
    assert.equal(editForm?.get("n"), null);
    assert.equal(editForm?.getAll("image").length, 1);
    assert.equal(result.images[0].url, "https://img.test/openlux-edit.jpg");
  });
});

test("makes one OpenLux request per requested image", async () => {
  let calls = 0;
  await withProvider(async () => {
    calls += 1;
    return Response.json({
      data: [{ url: `https://img.test/openlux-${calls}.jpg` }]
    });
  }, async () => {
    const result = await generateWithOpenlux({
      provider: "gpt-image-2-c",
      prompt: "白底红苹果",
      count: 2
    });
    assert.equal(calls, 2);
    assert.deepEqual(
      result.images.map((image) => image.url).sort(),
      ["https://img.test/openlux-1.jpg", "https://img.test/openlux-2.jpg"]
    );
  });
});

test("fails clearly when OPENLUX_API_KEY is missing", async () => {
  const previous = process.env.OPENLUX_API_KEY;
  delete process.env.OPENLUX_API_KEY;
  try {
    await assert.rejects(
      generateWithOpenlux({ provider: "gpt-image-2-c", prompt: "白底红苹果" }),
      /gpt-image-2-c 配置缺失：OPENLUX_API_KEY/
    );
  } finally {
    if (previous === undefined) delete process.env.OPENLUX_API_KEY;
    else process.env.OPENLUX_API_KEY = previous;
  }
});
