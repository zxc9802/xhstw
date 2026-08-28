import assert from "node:assert/strict";
import test from "node:test";

import { generateWithNanoBanana } from "../lib/adapters/nano-banana";

function geminiImageResponse(id: string) {
  return {
    candidates: [{
      content: {
        role: "model",
        parts: [{
          inlineData: {
            mimeType: "image/jpeg",
            data: Buffer.from(`fake-image-${id}`).toString("base64")
          }
        }]
      },
      finishReason: "STOP"
    }]
  };
}

async function withNanoBanana(fetcher: typeof fetch, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousApiKey = process.env.NANO_BANANA_API_KEY;
  const previousApiUrl = process.env.NANO_BANANA_API_URL;
  const previousProvider = process.env.IMAGE_MODEL_PROVIDER;
  process.env.NANO_BANANA_API_KEY = "test-nano-key";
  process.env.NANO_BANANA_API_URL = "https://api.openlux.ai/v1beta/models/gemini-3.1-flash-image:generateContent";
  process.env.IMAGE_MODEL_PROVIDER = "nano-banana";
  globalThis.fetch = fetcher;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.NANO_BANANA_API_KEY;
    else process.env.NANO_BANANA_API_KEY = previousApiKey;
    if (previousApiUrl === undefined) delete process.env.NANO_BANANA_API_URL;
    else process.env.NANO_BANANA_API_URL = previousApiUrl;
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
    return Response.json(geminiImageResponse(String(index + 1)));
  }, async () => {
    const result = await generateWithNanoBanana({
      provider: "Nano Banana 2",
      prompt: "普通生活场景产品图",
      count: 3
    });

    assert.equal(result.images.length, 2);
    assert.match(result.images[0].url, /^data:image\/jpeg;base64,/);
    assert.equal(result.warnings?.length, 1);
    assert.match(result.warnings?.[0] || "", /第 2 张.*IMAGE_SAFETY/);
  });
});

test("sends Gemini generateContent parts without extra system or edit instructions", async () => {
  let requestUrl = "";
  let requestBody: {
    contents: Array<{ role: string; parts: unknown[] }>;
    generationConfig?: { responseModalities?: string[]; imageConfig?: { aspectRatio?: string } };
  } | undefined;

  await withNanoBanana(async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json(geminiImageResponse("plain"));
  }, async () => {
    await generateWithNanoBanana({
      provider: "Nano Banana 2",
      prompt: "普通生活场景产品图",
      size: "3:4",
      sourceImageUrls: ["https://img.test/source.jpg"],
      count: 1
    });
  });

  assert.equal(requestUrl, "https://api.openlux.ai/v1beta/models/gemini-3.1-flash-image:generateContent");
  assert.deepEqual(requestBody, {
    contents: [
      {
        role: "user",
        parts: [
          { text: "普通生活场景产品图" },
          { fileData: { fileUri: "https://img.test/source.jpg" } }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "3:4" }
    }
  });
});

test("sends data-url references as Gemini inline image parts", async () => {
  let requestBody: {
    contents: Array<{ parts: unknown[] }>;
  } | undefined;

  await withNanoBanana(async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
    return Response.json(geminiImageResponse("data-url"));
  }, async () => {
    await generateWithNanoBanana({
      provider: "Nano Banana 2",
      prompt: "参考这张图生成新品图",
      sourceImageUrls: ["data:image/png;base64,ZmFrZQ=="],
      count: 1
    });
  });

  assert.deepEqual(requestBody?.contents[0].parts, [
    { text: "参考这张图生成新品图" },
    { inlineData: { mimeType: "image/png", data: "ZmFrZQ==" } }
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
