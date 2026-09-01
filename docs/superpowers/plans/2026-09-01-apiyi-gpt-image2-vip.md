# API易 gpt-image2-vip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-only API易 `gpt-image-2-vip` integration that appears as `gpt-image2-vip` in every image-model selector and supports text-to-image plus ordered multi-image editing.

**Architecture:** Add one focused `apiyi-image.ts` adapter and route only the exact `gpt-image2-vip` provider to it. Keep the existing job, caching, billing, page, and storage contracts unchanged; the adapter maps current ratios to API易 2K sizes, performs one synchronous upstream call per requested image, and normalizes URL or Base64 results.

**Tech Stack:** Next.js 15 App Router, TypeScript 5.7, Node `fetch`/`FormData`/`Blob`, Node test runner through `tsx`, existing main-app billing and image-job adapters.

---

## File map

- Create `lib/adapters/apiyi-image.ts`: API易 configuration, request mapping, reference-file conversion, response normalization, concurrency, and billing.
- Create `tests/apiyi-image.test.ts`: adapter contract tests with a local `fetch` replacement only at the network boundary.
- Modify `types/image.ts`: add the public provider literal.
- Modify `app/content/page.tsx`: expose the provider through the shared selector array.
- Modify `tests/content-production-contract.test.ts`: lock the selector and public environment contract.
- Modify `app/api/image/generate/route.ts`: validate direct references and dispatch the exact provider.
- Modify `tests/image-generation-job-route.test.ts`: prove route dispatch and reference behavior.
- Modify `.env.example`: document non-secret API易 configuration.
- Modify ignored `.env.local` in both the worktree and primary workspace: store the supplied key for verification and local runtime without committing it.

### Task 1: Expose the provider in every image-model selector

**Files:**
- Modify: `tests/content-production-contract.test.ts:5-23`
- Modify: `types/image.ts:1`
- Modify: `app/content/page.tsx:35`

- [ ] **Step 1: Write the failing selector contract**

Add this test beside the existing `gpt-image-2-c` selector test:

```ts
test("all image provider selectors expose gpt-image2-vip", () => {
  assert.equal(imageTypeSource.includes('"gpt-image2-vip"'), true);
  assert.match(
    source,
    /const imageProviders: ImageProvider\[\] = \[[^\]]*"gpt-image2-vip"/
  );
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/content-production-contract.test.ts
```

Expected: FAIL in `all image provider selectors expose gpt-image2-vip` because neither source file contains the new literal.

- [ ] **Step 3: Add the provider literal and shared selector option**

Change the type to:

```ts
export type ImageProvider = "Image 2.0" | "gpt-image-2-c" | "gpt-image2-vip" | "Nano Banana 2" | "nanobanan新" | "仅生成提示词，不直接生图";
```

Change the shared page array to:

```ts
const imageProviders: ImageProvider[] = ["Image 2.0", "gpt-image-2-c", "gpt-image2-vip", "Nano Banana 2", "nanobanan新", "仅生成提示词，不直接生图"];
```

- [ ] **Step 4: Run the selector contract and verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/content-production-contract.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 5: Commit the selector change**

```powershell
git add -- tests/content-production-contract.test.ts types/image.ts app/content/page.tsx
git diff --cached --check
git commit -m "feat: expose APIYI gpt-image2-vip provider"
```

### Task 2: Implement API易 text-to-image requests and result parsing

**Files:**
- Create: `tests/apiyi-image.test.ts`
- Create: `lib/adapters/apiyi-image.ts`

- [ ] **Step 1: Write failing generation, size, count, response, and configuration tests**

Create `tests/apiyi-image.test.ts` with this setup and tests:

```ts
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
```

- [ ] **Step 2: Run the adapter test and verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/apiyi-image.test.ts
```

Expected: FAIL with `Cannot find module '../lib/adapters/apiyi-image'`.

- [ ] **Step 3: Create the minimal generation adapter**

Create `lib/adapters/apiyi-image.ts`. Use the same bounded parsing and billing boundaries as `openlux-image.ts`, with these public types and constants:

```ts
import { logImageProviderResponse } from "@/lib/adapters/image-response-diagnostics";
import { MainAppBillingError, reserveMainAppCredits } from "@/lib/main-app-billing";

type ApiyiInput = {
  provider?: string;
  prompt?: string;
  size?: string;
  count?: number;
  sourceImageUrls?: string[];
};

type ApiyiConfig = {
  apiKey: string;
  generationUrl: string;
  editUrl: string;
  model: string;
};

const MAX_IMAGES_PER_RUN = 10;
const MAX_PARALLEL_IMAGE_REQUESTS = Math.max(1, Math.min(10, Number(process.env.OPENAI_IMAGE_PARALLEL_REQUESTS) || 4));
const MAX_RESPONSE_DEPTH = 6;
export const APIYI_IMAGE_TIMEOUT_MS = 360_000;

export function isApiyiImageProvider(provider: string) {
  return provider === "gpt-image2-vip";
}
```

Implement call-time configuration so tests can safely change environment variables:

```ts
function apiyiConfig(): ApiyiConfig {
  const apiKey = process.env.APIYI_IMAGE_API_KEY?.trim() || "";
  if (!apiKey) throw new Error("gpt-image2-vip 配置缺失：APIYI_IMAGE_API_KEY");
  return {
    apiKey,
    generationUrl: process.env.APIYI_IMAGE_URL?.trim() || "https://api.apiyi.com/v1/images/generations",
    editUrl: process.env.APIYI_IMAGE_EDIT_URL?.trim() || "https://api.apiyi.com/v1/images/edits",
    model: process.env.APIYI_IMAGE_MODEL?.trim() || "gpt-image-2-vip"
  };
}

function imageSizeFromRatio(ratio = "1:1") {
  return ({
    "1:1": "2048x2048",
    "3:4": "1536x2048",
    "4:3": "2048x1536",
    "9:16": "1152x2048",
    "16:9": "2048x1152"
  } as Record<string, string>)[ratio.trim().toLowerCase()] || "2048x2048";
}
```

Implement a depth-limited result parser that accepts only image-shaped fields and prefixes raw Base64 as PNG:

```ts
const RESPONSE_CONTAINER_KEYS = new Set([
  "content", "data", "image", "images", "message", "output", "outputs",
  "resource_urls", "resourceurls", "result", "results"
]);
const IMAGE_URL_KEYS = new Set(["url", "imageurl", "image_url"]);
const IMAGE_BASE64_KEYS = new Set(["b64_json", "base64", "image_base64", "image_data"]);

function extractImageUrls(input: unknown) {
  const urls: string[] = [];
  function visit(value: unknown, key: string, depth: number) {
    if (depth > MAX_RESPONSE_DEPTH || value === null || value === undefined) return;
    const normalizedKey = key.toLowerCase();
    if (typeof value === "string") {
      if (IMAGE_BASE64_KEYS.has(normalizedKey)) {
        if (value.startsWith("data:image/")) urls.push(value);
        else if (value) urls.push(`data:image/png;base64,${value}`);
        return;
      }
      if (
        (IMAGE_URL_KEYS.has(normalizedKey) || RESPONSE_CONTAINER_KEYS.has(normalizedKey))
        && (/^https?:\/\//i.test(value) || value.startsWith("data:image/"))
      ) urls.push(value);
      return;
    }
    if (Array.isArray(value)) {
      if (RESPONSE_CONTAINER_KEYS.has(normalizedKey)) {
        value.forEach((item) => visit(item, normalizedKey, depth + 1));
      }
      return;
    }
    if (typeof value !== "object") return;
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const childNormalizedKey = childKey.toLowerCase();
      if (
        RESPONSE_CONTAINER_KEYS.has(childNormalizedKey)
        || IMAGE_URL_KEYS.has(childNormalizedKey)
        || IMAGE_BASE64_KEYS.has(childNormalizedKey)
      ) visit(childValue, childNormalizedKey, depth + 1);
    }
  }
  visit(input, "data", 0);
  return [...new Set(urls)];
}

function providerError(data: unknown, fallback: string) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  for (const key of ["msg", "message", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value === "object") {
      const message = (value as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return fallback;
}

function assertApiyiResponse(response: Response, data: unknown, operation: "generate" | "edit", endpoint: string) {
  logImageProviderResponse({
    provider: "gpt-image2-vip",
    operation,
    endpoint,
    status: response.status,
    response: data
  });
  if (!response.ok || (data && typeof data === "object" && (data as Record<string, unknown>).success === false)) {
    throw new Error(`gpt-image2-vip 生成失败：${providerError(data, `HTTP ${response.status}`)}`);
  }
  if (!extractImageUrls(data).length) {
    throw new Error("gpt-image2-vip 生成失败：API易未返回图片数据。");
  }
}
```

Implement text generation without `n` or `quality`:

```ts
async function requestGeneration(config: ApiyiConfig, prompt: string, size: string) {
  const response = await fetch(config.generationUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      size,
      response_format: "b64_json"
    }),
    signal: AbortSignal.timeout(APIYI_IMAGE_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  assertApiyiResponse(response, data, "generate", config.generationUrl);
  return data;
}
```

Implement concurrency with stable result ordering:

```ts
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number) {
  const results: T[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  });
  await Promise.all(workers);
  return results;
}
```

Then implement the public function:

```ts
export async function generateWithApiyi(input: unknown) {
  const body = input && typeof input === "object" ? input as ApiyiInput : {};
  const config = apiyiConfig();
  const prompt = body.prompt?.trim() || "";
  const requestedCount = Math.max(1, Math.min(MAX_IMAGES_PER_RUN, Number(body.count) || 1));
  const size = imageSizeFromRatio(body.size);
  if (body.sourceImageUrls?.length) throw new Error("gpt-image2-vip 图生图尚未接入。");

  const tasks = Array.from({ length: requestedCount }, () => async () => {
    const billing = await reserveMainAppCredits({
      operation: "image-generate",
      providerId: "apiyi",
      model: config.model,
      media: true
    });
    try {
      const data = await requestGeneration(config, prompt, size);
      await billing.settleMedia();
      return data;
    } catch (error) {
      if (error instanceof MainAppBillingError) throw error;
      await billing.release();
      throw error;
    }
  });

  const results = await runWithConcurrency(tasks, MAX_PARALLEL_IMAGE_REQUESTS);
  const images = results.flatMap(extractImageUrls).slice(0, requestedCount).map((url, index) => ({
    id: `apiyi_${Date.now()}_${index}`,
    url,
    provider: "gpt-image2-vip" as const
  }));
  if (!images.length) throw new Error("gpt-image2-vip 生成失败：API易未返回图片数据。");
  return { provider: "gpt-image2-vip" as const, model: config.model, input: body, images };
}
```

- [ ] **Step 4: Run the adapter tests and verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/apiyi-image.test.ts
```

Expected: 8 tests pass, including three independent upstream calls for `count: 3`.

- [ ] **Step 5: Commit text-to-image support**

```powershell
git add -- tests/apiyi-image.test.ts lib/adapters/apiyi-image.ts
git diff --cached --check
git commit -m "feat: add APIYI text to image adapter"
```

### Task 3: Add ordered single-image and multi-image editing

**Files:**
- Modify: `tests/apiyi-image.test.ts`
- Modify: `lib/adapters/apiyi-image.ts`

- [ ] **Step 1: Add failing multipart edit tests**

Append tests that prove repeated `image` fields, ordering, supported data URLs, and absence of `image.items`:

```ts
test("uploads ordered references as repeated image fields", async () => {
  let editForm: FormData | undefined;
  await withProvider(async (url, init) => {
    assert.equal(String(url), PROVIDER_ENV.APIYI_IMAGE_EDIT_URL);
    editForm = init?.body as FormData;
    return Response.json({ data: [{ b64_json: "ZWRpdGVk" }] });
  }, async () => {
    const result = await generateWithApiyi({
      provider: "gpt-image2-vip",
      prompt: "把图1的人物放进图2的场景",
      size: "1:1",
      sourceImageUrls: [
        "data:image/png;base64,Zmlyc3Q=",
        "data:image/webp;base64,c2Vjb25k"
      ]
    });
    assert.equal(editForm?.get("model"), "gpt-image-2-vip");
    assert.equal(editForm?.get("prompt"), "把图1的人物放进图2的场景");
    assert.equal(editForm?.get("size"), "2048x2048");
    assert.equal(editForm?.get("response_format"), "b64_json");
    assert.equal(editForm?.getAll("image").length, 2);
    assert.equal(editForm?.get("image.items"), null);
    assert.equal((editForm?.getAll("image")[0] as File).type, "image/png");
    assert.equal((editForm?.getAll("image")[1] as File).type, "image/webp");
    assert.equal(result.images[0].url, "data:image/png;base64,ZWRpdGVk");
  });
});

test("downloads a public reference before uploading it", async () => {
  let editForm: FormData | undefined;
  await withProvider(async (url, init) => {
    if (String(url) === "https://img.test/reference.jpg") {
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { "Content-Type": "image/jpeg" }
      });
    }
    editForm = init?.body as FormData;
    return Response.json({ data: [{ url: "https://img.test/edited.png" }] });
  }, async () => {
    await generateWithApiyi({
      prompt: "换背景",
      sourceImageUrls: ["https://img.test/reference.jpg"]
    });
    assert.equal((editForm?.get("image") as File).type, "image/jpeg");
  });
});
```

- [ ] **Step 2: Run the adapter test and verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/apiyi-image.test.ts
```

Expected: the two new tests fail with `gpt-image2-vip 图生图尚未接入。`.

- [ ] **Step 3: Implement reference conversion and multipart editing**

Add a strict data URL parser and remote downloader:

```ts
function parseDataUrl(url: string) {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return { mime, ext, buffer: Buffer.from(match[2], "base64") };
}

async function imageUrlToBlob(url: string, index: number) {
  const parsed = parseDataUrl(url);
  if (parsed) {
    return {
      blob: new Blob([parsed.buffer], { type: parsed.mime }),
      fileName: `reference-${index + 1}.${parsed.ext}`
    };
  }
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(APIYI_IMAGE_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`参考图下载失败：HTTP ${response.status}`);
  const contentType = (response.headers.get("Content-Type") || "image/jpeg").split(";", 1)[0];
  if (!/^image\/(?:jpeg|png|webp)$/i.test(contentType)) throw new Error("参考图下载失败：响应不是支持的图片格式。");
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  return {
    blob: new Blob([await response.arrayBuffer()], { type: contentType }),
    fileName: `reference-${index + 1}.${ext}`
  };
}
```

Add the edit request:

```ts
async function requestEdit(config: ApiyiConfig, prompt: string, size: string, sourceImageUrls: string[]) {
  const form = new FormData();
  form.append("model", config.model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("response_format", "b64_json");
  const references = await Promise.all(sourceImageUrls.map(imageUrlToBlob));
  references.forEach(({ blob, fileName }) => form.append("image", blob, fileName));
  const response = await fetch(config.editUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: form,
    signal: AbortSignal.timeout(APIYI_IMAGE_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  assertApiyiResponse(response, data, "edit", config.editUrl);
  return data;
}
```

Replace the temporary edit rejection inside each task with:

```ts
const data = sourceImageUrls.length
  ? await requestEdit(config, prompt, size, sourceImageUrls)
  : await requestGeneration(config, prompt, size);
```

Define `const sourceImageUrls = body.sourceImageUrls ?? [];` before task construction.

- [ ] **Step 4: Run all adapter tests and verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/apiyi-image.test.ts
```

Expected: 10 tests pass; multipart contains two ordered `image` entries and no `image.items`.

- [ ] **Step 5: Commit image editing support**

```powershell
git add -- tests/apiyi-image.test.ts lib/adapters/apiyi-image.ts
git diff --cached --check
git commit -m "feat: add APIYI image editing"
```

### Task 4: Route API易 jobs without changing existing providers

**Files:**
- Modify: `tests/image-generation-job-route.test.ts:82-101,552-587`
- Modify: `app/api/image/generate/route.ts:1-5,38-49,70-127`

- [ ] **Step 1: Add failing route tests and environment helper**

Add this helper near `useOpenluxProvider`:

```ts
function useApiyiProvider(t: TestContext) {
  const values = {
    APIYI_IMAGE_API_KEY: "test-apiyi-key",
    APIYI_IMAGE_URL: "https://apiyi.test/v1/images/generations",
    APIYI_IMAGE_EDIT_URL: "https://apiyi.test/v1/images/edits",
    APIYI_IMAGE_MODEL: "gpt-image-2-vip"
  } as const;
  const keys = Object.keys(values);
  const previous: Record<string, string | undefined> = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
```

Add route tests after the OpenLux route test:

```ts
test("routes gpt-image2-vip through APIYI and keeps local references for edits", async (t) => {
  useApiyiProvider(t);
  const previousFetch = globalThis.fetch;
  let editForm: FormData | undefined;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://apiyi.test/v1/images/edits");
    editForm = init?.body as FormData;
    return Response.json({ data: [{ b64_json: "YWJj" }] });
  };
  t.after(() => { globalThis.fetch = previousFetch; });

  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "gpt-image2-vip",
      prompt: "只换背景",
      size: "3:4",
      sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo="]
    })
  }));
  const created = await response.json();
  assert.equal(response.status, 202);
  const job = await waitForJob(created.data.jobId);
  assert.equal(job.status, "completed");
  assert.equal(editForm?.get("model"), "gpt-image-2-vip");
  assert.equal(editForm?.getAll("image").length, 1);
});

test("rejects private remote references before APIYI edits", async (t) => {
  useApiyiProvider(t);
  const response = await POST(new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "gpt-image2-vip",
      prompt: "只换背景",
      sourceImageUrls: ["http://127.0.0.1/internal-image.png"]
    })
  }));
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.match(payload.message, /gpt-image2-vip 参考图仅支持公开 HTTPS/);
});
```

- [ ] **Step 2: Run the route tests and verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/image-generation-job-route.test.ts
```

Expected: API易 requests are incorrectly routed to the existing Image 2.0 adapter, and the private-reference request is not rejected with the API易 message.

- [ ] **Step 3: Add exact API易 dispatch and provider-aware reference validation**

Import the adapter:

```ts
import { generateWithApiyi, isApiyiImageProvider } from "@/lib/adapters/apiyi-image";
```

Exclude API易 from the Image 2.0 temporary-reference path:

```ts
function usesImage2References(provider: string) {
  return !provider.includes("Nano")
    && !provider.includes("仅生成提示词")
    && !isOpenluxImageProvider(provider)
    && !isApiyiImageProvider(provider)
    && process.env.IMAGE_MODEL_PROVIDER !== "nano-banana"
    && process.env.IMAGE_MODEL_PROVIDER !== "mock"
    && process.env.IMAGE_MODEL_PROVIDER !== "yunwu";
}
```

Rename `validateYunwuReferenceUrls` to a provider-aware helper while keeping the existing Yunwu message unchanged through its label:

```ts
function validateDirectReferenceUrls(urls: string[], providerLabel: string) {
  urls.forEach((source) => {
    if (source.startsWith("data:image/")) return;
    try {
      const url = new URL(source);
      if (url.protocol !== "https:" || isPrivateReferenceHost(url.hostname)) {
        throw new ImageReferenceInputError(`${providerLabel} 参考图仅支持公开 HTTPS 图片地址或本地图片数据。`, 400);
      }
    } catch (error) {
      if (error instanceof ImageReferenceInputError) throw error;
      throw new ImageReferenceInputError(`${providerLabel} 参考图地址无效。`, 400);
    }
  });
}
```

Replace the pre-job validation block with this exact provider-aware form:

```ts
const directProviderLabel = directYunwu
  ? "Yunwu"
  : isOpenluxImageProvider(provider)
    ? "gpt-image-2-c"
    : isApiyiImageProvider(provider)
      ? "gpt-image2-vip"
      : "";
if (usesImage2References(provider) || directProviderLabel) {
  const sourceImageUrls = imageSourceUrls(body);
  if (directProviderLabel) validateDirectReferenceUrls(sourceImageUrls, directProviderLabel);
  if (usesImage2References(provider) && sourceImageUrls.length) {
    const published = publishImageReferences(sourceImageUrls, publicRequestOrigin(request));
    referenceTokens = published.tokens;
    jobBody = {
      ...(body as Record<string, unknown>),
      sourceImageUrls: published.urls
    };
  }
}
```

Dispatch API易 before OpenLux:

```ts
const generated = isNanobananaNew(provider)
  ? await generateWithNanobananaNew(jobBody)
  : isApiyiImageProvider(provider)
    ? await generateWithApiyi(jobBody)
    : isOpenluxImageProvider(provider)
      ? await generateWithOpenlux(jobBody)
      : provider.includes("Nano") || process.env.IMAGE_MODEL_PROVIDER === "nano-banana"
        ? await generateWithNanoBanana(jobBody)
        : await generateImage(jobBody);
```

- [ ] **Step 4: Run route and adapter tests and verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/apiyi-image.test.ts tests/image-generation-job-route.test.ts
```

Expected: all tests pass; existing Yunwu and OpenLux route tests remain green.

- [ ] **Step 5: Commit route integration**

```powershell
git add -- app/api/image/generate/route.ts tests/image-generation-job-route.test.ts
git diff --cached --check
git commit -m "feat: route APIYI image jobs"
```

### Task 5: Document and install server-only API易 configuration

**Files:**
- Modify: `tests/content-production-contract.test.ts`
- Modify: `.env.example`
- Modify ignored: `.env.local`
- Modify ignored: `D:\图文生成工作台\.env.local`

- [ ] **Step 1: Add a failing public-configuration contract**

At the top of `tests/content-production-contract.test.ts`, read the example environment file:

```ts
const envExampleSource = readFileSync(".env.example", "utf8");
```

Add:

```ts
test("documents server-only APIYI image configuration", () => {
  for (const name of [
    "APIYI_IMAGE_API_KEY=",
    "APIYI_IMAGE_URL=https://api.apiyi.com/v1/images/generations",
    "APIYI_IMAGE_EDIT_URL=https://api.apiyi.com/v1/images/edits",
    "APIYI_IMAGE_MODEL=gpt-image-2-vip"
  ]) {
    assert.equal(envExampleSource.includes(name), true, name);
  }
  assert.equal(source.includes("APIYI_IMAGE_API_KEY"), false);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/content-production-contract.test.ts
```

Expected: FAIL because `.env.example` does not yet document API易.

- [ ] **Step 3: Add non-secret example configuration**

Add this block after the OpenLux image configuration:

```dotenv
APIYI_IMAGE_API_KEY=
APIYI_IMAGE_URL=https://api.apiyi.com/v1/images/generations
APIYI_IMAGE_EDIT_URL=https://api.apiyi.com/v1/images/edits
APIYI_IMAGE_MODEL=gpt-image-2-vip
```

- [ ] **Step 4: Write the supplied key only to ignored local configuration**

Use `apply_patch` to append the same four variable names to both ignored `.env.local` files. Set `APIYI_IMAGE_API_KEY` to the key supplied in the conversation and use the three non-secret defaults above. Do not print either file. If any variable already exists, replace its value instead of creating duplicates.

Verify ignore status and uniqueness without printing values:

```powershell
git check-ignore -q .env.local
$names = 'APIYI_IMAGE_API_KEY','APIYI_IMAGE_URL','APIYI_IMAGE_EDIT_URL','APIYI_IMAGE_MODEL'
$lines = Get-Content -LiteralPath '.env.local'
$names | ForEach-Object {
  if (@($lines | Where-Object { $_ -match "^$([regex]::Escape($_))=" }).Count -ne 1) {
    throw "Expected exactly one local value for $_"
  }
}
```

Read the configured key into a PowerShell variable and confirm no tracked file contains it; do not output the variable:

```powershell
$configuredKey = (($lines | Where-Object { $_ -match '^APIYI_IMAGE_API_KEY=' }) -split '=', 2)[1]
if (-not $configuredKey) { throw 'APIYI_IMAGE_API_KEY is empty.' }
$leaks = @(git grep -lF -- $configuredKey)
if ($leaks.Count) { throw "APIYI key leaked into tracked files: $($leaks -join ', ')" }
```

- [ ] **Step 5: Run the configuration contract and verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/content-production-contract.test.ts
```

Expected: all contract tests pass, while `git status --short` does not list `.env.local`.

- [ ] **Step 6: Commit only the public configuration contract**

```powershell
git add -- .env.example tests/content-production-contract.test.ts
git diff --cached --check
git commit -m "docs: configure APIYI image provider"
```

### Task 6: Verify repository behavior and run two paid real probes

**Files:**
- Verify: all files changed in Tasks 1-5
- Temporary output: none; probe responses stay in memory

- [ ] **Step 1: Run focused tests**

```powershell
npm.cmd exec -- tsx --test tests/apiyi-image.test.ts tests/image-generation-job-route.test.ts tests/content-production-contract.test.ts tests/main-app-billing.test.ts
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run the complete test suite**

```powershell
npm.cmd test
```

Expected: the baseline 341 tests plus the new API易 tests pass with zero failures. The packaging tests may regenerate `public/downloads/xhs-browser-extension-0.1.33.zip`; if so, verify it is the only unrelated difference and restore only that generated file to `HEAD` before continuing.

- [ ] **Step 3: Run the production build**

```powershell
npm.cmd run build
```

Expected: Next.js production build exits with code 0 and reports no TypeScript error.

- [ ] **Step 4: Run a text-to-image probe followed by an image-edit probe**

This command loads ignored `.env.local`, forces local no-op billing, sends exactly two paid upstream requests, keeps image data in memory, and prints only safe metadata:

```powershell
npm.cmd exec -- tsx -e "import { loadEnvConfig } from '@next/env'; import { generateWithApiyi } from './lib/adapters/apiyi-image'; loadEnvConfig(process.cwd()); process.env.DISABLE_SSO='true'; void (async () => { const generated = await generateWithApiyi({ provider: 'gpt-image2-vip', prompt: '白色陶瓷杯放在浅灰桌面，柔和自然光，简洁产品摄影', size: '1:1', count: 1 }); const edited = await generateWithApiyi({ provider: 'gpt-image2-vip', prompt: '保持杯子主体不变，把背景改成黄昏海边', size: '1:1', count: 1, sourceImageUrls: [generated.images[0].url] }); const safe = (value: typeof generated) => ({ provider: value.provider, model: value.model, images: value.images.length, response: value.images[0].url.startsWith('data:image/') ? 'data-url' : 'url' }); console.log(JSON.stringify({ generated: safe(generated), edited: safe(edited) })); })();"
```

Expected after the synchronous calls complete: one JSON line showing `provider: "gpt-image2-vip"`, `model: "gpt-image-2-vip"`, `images: 1` for both `generated` and `edited`. Do not print the actual returned URL or Base64.

- [ ] **Step 5: Run final hygiene and secret checks**

```powershell
git diff --check
git status --short
$localLines = Get-Content -LiteralPath '.env.local'
$configuredKey = (($localLines | Where-Object { $_ -match '^APIYI_IMAGE_API_KEY=' }) -split '=', 2)[1]
if (-not $configuredKey) { throw 'APIYI key is missing.' }
$leaks = @(git grep -lF -- $configuredKey)
if ($leaks.Count) { throw "APIYI key leaked into tracked files: $($leaks -join ', ')" }
```

Expected: no whitespace errors, no unrelated tracked changes, and no tracked secret matches.

- [ ] **Step 6: Record final verification evidence**

Capture in the handoff:

- focused test pass count;
- complete test pass/fail totals;
- production build exit code;
- safe metadata from both real probes;
- final changed-file list;
- confirmation that `.env.local` is ignored and the key is absent from tracked files.

Do not claim completion until every item above has fresh command output.
