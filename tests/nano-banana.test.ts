import assert from "node:assert/strict";
import test from "node:test";

import { generateWithNanoBanana } from "../lib/adapters/nano-banana";

async function withNanoBanana(fetcher: typeof fetch, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousApiKey = process.env.NANO_BANANA_API_KEY;
  const previousProvider = process.env.IMAGE_MODEL_PROVIDER;
  process.env.NANO_BANANA_API_KEY = "test-nano-key";
  process.env.IMAGE_MODEL_PROVIDER = "nano-banana";
  globalThis.fetch = fetcher;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.NANO_BANANA_API_KEY;
    else process.env.NANO_BANANA_API_KEY = previousApiKey;
    if (previousProvider === undefined) delete process.env.IMAGE_MODEL_PROVIDER;
    else process.env.IMAGE_MODEL_PROVIDER = previousProvider;
  }
}

test("keeps successful Nano Banana images when one request is blocked by image safety", async () => {
  let requestIndex = 0;
  await withNanoBanana(async () => {
    const index = requestIndex;
    requestIndex += 1;
    if (index === 1) {
      return Response.json({
        error: {
          message: "Gemini image generation blocked [IMAGE_SAFETY]"
        }
      }, { status: 400 });
    }
    return Response.json({
      choices: [{
        message: {
          content: `https://img.test/nano-${index + 1}.jpg`
        }
      }]
    });
  }, async () => {
    const result = await generateWithNanoBanana({
      provider: "Nano Banana 2",
      prompt: "普通生活场景产品图",
      count: 3
    });

    assert.equal(result.images.length, 2);
    assert.equal(result.warnings?.length, 1);
    assert.match(result.warnings?.[0] || "", /第 2 张.*IMAGE_SAFETY/);
  });
});

test("sends only the user prompt without extra system or edit instructions", async () => {
  let requestBody: {
    messages: Array<{ role: string; content: unknown }>;
  } | undefined;

  await withNanoBanana(async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json({
      choices: [{ message: { content: "https://img.test/nano-plain.jpg" } }]
    });
  }, async () => {
    await generateWithNanoBanana({
      provider: "Nano Banana 2",
      prompt: "普通生活场景产品图",
      size: "3:4",
      sourceImageUrls: ["https://img.test/source.jpg"],
      count: 1
    });
  });

  assert.deepEqual(requestBody?.messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "普通生活场景产品图" },
        { type: "image_url", image_url: { url: "https://img.test/source.jpg" } }
      ]
    }
  ]);
});

test("fails clearly when every Nano Banana request is blocked", async () => {
  await withNanoBanana(async () => Response.json({
    error: {
      message: "Gemini image generation blocked [IMAGE_SAFETY]"
    }
  }, { status: 400 }), async () => {
    await assert.rejects(
      generateWithNanoBanana({
        provider: "Nano Banana 2",
        prompt: "普通生活场景产品图",
        count: 2
      }),
      /第 1 张.*IMAGE_SAFETY.*第 2 张.*IMAGE_SAFETY/
    );
  });
});
