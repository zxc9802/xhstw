# GPT Image 2 OpenAPI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing OpenAI-compatible Image 2.0 calls with the project-scoped `/openApi/generate` JSON API without changing the page or asynchronous job contract.

**Architecture:** Keep `lib/adapters/openai-image.ts` as the single Image 2.0 adapter, but replace its OpenAI generation/edit transports with one JSON request function. Resolve credentials at call time, submit one request per requested image under the existing concurrency cap, parse only image-shaped response fields, and reject reference-image requests before any network call.

**Tech Stack:** TypeScript, Next.js route handlers, native `fetch`, Node test runner through `tsx`.

---

### Task 1: Lock the new provider contract with failing tests

**Files:**
- Create: `tests/openapi-image.test.ts`
- Test: `tests/openapi-image.test.ts`

- [ ] **Step 1: Write the request-contract test**

Create a test that sets the five `GPT_IMAGE2_*` configuration variables, replaces `globalThis.fetch`, calls `generateImage({ prompt: "橘猫", size: "3:4", count: 1 })`, and asserts that the request uses:

```ts
assert.equal(url, "http://provider.test/openApi/generate");
assert.deepEqual(options.headers, {
  Accept: "application/json",
  "Content-Type": "application/json",
  projectCode: "project-code",
  "X-Access-Key": "access-key",
  "X-Secret-Key": "secret-key"
});
assert.deepEqual(JSON.parse(String(options.body)), {
  modelId: "gpt-image2-low",
  abilityType: "IMAGE",
  prompt: expectedPrompt,
  payload: { params: { resolution: "1K", scale: "3:4" } }
});
```

Return this representative success payload from the fetch stub:

```ts
Response.json({ success: true, data: { images: [{ url: "https://img.test/cat.jpg" }] } })
```

Assert that the public result still contains `provider: "Image 2.0"`, `model: "gpt-image2-low"`, and one normalized image URL.

- [ ] **Step 2: Write failure and safety tests**

Add separate tests that prove:

```ts
// HTTP 200 business failure
Response.json({ success: false, msg: "IP 不在白名单" })
// generateImage rejects with the provider message.

// Reference image request
generateImage({ prompt: "换背景", sourceImageUrls: ["https://img.test/source.jpg"] })
// rejects before fetch is called.

// Two requested images
generateImage({ prompt: "橘猫", count: 2 })
// calls fetch exactly twice and returns both URLs without an extra retry.
```

Also cover URL fields and base64 fields inside the approved response containers so the parser does not treat `sid`, `msg`, or other arbitrary strings as images.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/openapi-image.test.ts
```

Expected: FAIL because the old adapter sends Bearer-authenticated OpenAI fields such as `model`, `size`, and `n`, and does not reject reference images under the new contract.

- [ ] **Step 4: Commit the failing contract test**

```powershell
git add -- tests/openapi-image.test.ts
git commit -m "test: define gpt image2 openapi contract"
```

### Task 2: Replace the Image 2.0 transport

**Files:**
- Modify: `lib/adapters/openai-image.ts`
- Test: `tests/openapi-image.test.ts`

- [ ] **Step 1: Add runtime configuration and scale mapping**

Replace the static OpenAI/Yunwu constants with a call-time resolver:

```ts
function image2Config() {
  return {
    apiUrl: process.env.GPT_IMAGE2_API_URL || "http://14.103.147.238:19220/openApi/generate",
    projectCode: process.env.GPT_IMAGE2_PROJECT_CODE || "",
    accessKey: process.env.GPT_IMAGE2_ACCESS_KEY || "",
    secretKey: process.env.GPT_IMAGE2_SECRET_KEY || "",
    modelId: process.env.GPT_IMAGE2_MODEL_ID || "gpt-image2-low",
    resolution: process.env.GPT_IMAGE2_RESOLUTION || "1K"
  };
}

export function imageScaleFromSize(size = "1:1") {
  const scales: Record<string, string> = {
    "1024x1024": "1:1",
    "1024x1536": "3:4",
    "1536x1024": "4:3",
    "1024x1792": "9:16",
    "1792x1024": "16:9"
  };
  const value = size.trim().toLowerCase();
  return ["1:1", "3:4", "4:3", "9:16", "16:9"].includes(value) ? value : scales[value] || "1:1";
}
```

- [ ] **Step 2: Implement bounded image extraction**

Replace the OpenAI-only array parser with a bounded recursive parser that:

- accepts `http://`, `https://`, and `data:image/` strings only when they occur as image values;
- converts `b64_json` and `base64` strings into `data:image/jpeg;base64,...`;
- descends only through `data`, `images`, `result`, `results`, `output`, `outputs`, `url`, `imageUrl`, and `image_url`;
- stops after a small fixed depth and deduplicates URLs.

This keeps identifiers and error text out of the returned image list.

- [ ] **Step 3: Implement one provider request**

Add a request helper using the exact approved wire contract:

```ts
const response = await fetch(config.apiUrl, {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    projectCode: config.projectCode,
    "X-Access-Key": config.accessKey,
    "X-Secret-Key": config.secretKey
  },
  body: JSON.stringify({
    modelId: config.modelId,
    abilityType: "IMAGE",
    prompt,
    payload: { params: { resolution: config.resolution, scale } }
  }),
  signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
});
```

Parse JSON once, send it through `logImageProviderResponse`, reject non-2xx responses, and reject `success: false` responses using `msg`, `message`, or `error` without logging request headers.

- [ ] **Step 4: Replace generation and remove edit transport**

In `generateImage`:

1. Preserve prompt-only and mock-mode behavior.
2. Return mock images when any required project credential is missing.
3. Throw `Image 2.0 新接口暂不支持参考图编辑。` when `sourceImageUrls` is non-empty.
4. Build the existing realism-oriented prompt text.
5. Create exactly `requestedCount` request tasks, execute them with `runWithConcurrency`, and never retry a result that lacks a parsed image.
6. Normalize parsed URLs back to the existing `{ id, url, provider }` image objects.

Delete the old multipart edit request, Bearer authorization, reference-image download, `n`, `size`, `quality`, and `format` payload code.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
npx.cmd tsx --test tests/openapi-image.test.ts
```

Expected: all tests in `tests/openapi-image.test.ts` PASS, with exactly the asserted request count.

- [ ] **Step 6: Commit the adapter migration**

```powershell
git add -- lib/adapters/openai-image.ts tests/openapi-image.test.ts
git commit -m "feat: migrate image2 to project openapi"
```

### Task 3: Document configuration and verify the integrated application

**Files:**
- Modify: `.env.example`
- Test: `tests/openapi-image.test.ts`

- [ ] **Step 1: Replace old Image 2.0 environment examples**

Keep `IMAGE_MODEL_PROVIDER` and `OPENAI_IMAGE_PARALLEL_REQUESTS`, remove the obsolete `OPENAI_IMAGE_API_KEY`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `OPENAI_IMAGE_FORMAT`, `YUNWU_IMAGE_URL`, and `YUNWU_IMAGE_EDIT_URL` entries, and add:

```dotenv
GPT_IMAGE2_API_URL=http://14.103.147.238:19220/openApi/generate
GPT_IMAGE2_PROJECT_CODE=
GPT_IMAGE2_ACCESS_KEY=
GPT_IMAGE2_SECRET_KEY=
GPT_IMAGE2_MODEL_ID=gpt-image2-low
GPT_IMAGE2_RESOLUTION=1K
```

Do not place live credentials in `.env.example`, tests, source code, commits, or command output.

- [ ] **Step 2: Run the complete test suite**

Run:

```powershell
npm.cmd test
```

Expected: all existing and new tests PASS.

- [ ] **Step 3: Run production build and type checking sequentially**

Run:

```powershell
npm.cmd run build
npx.cmd tsc --noEmit
```

Expected: both commands exit successfully. Do not run them in parallel because the Next.js build recreates `.next/types`.

- [ ] **Step 4: Audit secrets and obsolete transport code**

Run searches that confirm live key values are absent, `Authorization: Bearer` is absent from `openai-image.ts`, and no old `YUNWU_IMAGE_*` or `OPENAI_IMAGE_API_KEY` reference remains in the adapter or `.env.example`.

- [ ] **Step 5: Commit configuration documentation**

```powershell
git add -- .env.example
git commit -m "docs: configure gpt image2 openapi"
```

- [ ] **Step 6: Record the live-verification boundary**

Report that the request contract and failure response were verified against the real endpoint, but successful image parsing remains pending because the current outbound IP is not on the provider whitelist. Do not claim a successful live image generation until a fresh request returns `success: true` with an image.
