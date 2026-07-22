# GPT Image 2 Yunwu Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retry the current GPT Image 2 aggregate provider three times after the first failure, then fall back to the former Yunwu `gpt-image-2` generation or edit endpoint for both text-to-image and image-to-image requests.

**Architecture:** Keep provider orchestration in `lib/adapters/openai-image.ts`. Each requested image runs independently: the aggregate provider gets at most four complete attempts, reference URLs are sent through `payload.resources`, and one Yunwu request runs only after all four aggregate attempts fail. The existing page, background job, proxy, persistence, and concurrency contracts remain unchanged.

**Tech Stack:** Next.js 15 route-side TypeScript, native `fetch`/`FormData`/`Blob`, Node test runner through `tsx`.

---

## File structure

- Modify `lib/adapters/openai-image.ts`: validate aggregate output, retry aggregate calls, submit reference resources, and restore Yunwu generation/edit helpers.
- Modify `tests/openapi-image.test.ts`: specify retry, aggregate image-to-image, Yunwu generation/edit fallback, empty output, and combined failure behavior.
- Modify `.env.example`: document the restored Yunwu image endpoint/model variables without adding credentials.

No new production module is needed because both providers implement the same existing `Image 2.0` adapter responsibility.

### Task 1: Retry the aggregate provider and submit reference resources

**Files:**
- Modify: `tests/openapi-image.test.ts:19-118`
- Modify: `lib/adapters/openai-image.ts:270-350`

- [ ] **Step 1: Replace the obsolete reference-image rejection test and add a fourth-attempt success test**

Replace `rejects reference-image input before making a provider request` with:

```ts
test("sends reference images to the project OpenAPI resources field", async () => {
  let requestBody: Record<string, unknown> | undefined;
  await withProvider(async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      success: true,
      data: { images: [{ url: "https://img.test/edited.jpg" }] }
    });
  }, async () => {
    const result = await generateImage({
      prompt: "只换背景",
      sourceImageUrls: ["https://img.test/source.jpg"]
    });

    assert.deepEqual(requestBody?.payload, {
      resources: ["https://img.test/source.jpg"],
      params: { resolution: "1K", scale: "1:1" }
    });
    assert.equal(result.images?.[0]?.url, "https://img.test/edited.jpg");
  });
});

test("retries the project OpenAPI three times after the first failure", async () => {
  let calls = 0;
  await withProvider(async () => {
    calls += 1;
    if (calls < 4) return Response.json({ success: false, msg: `失败 ${calls}` });
    return Response.json({
      success: true,
      data: { images: [{ url: "https://img.test/fourth-attempt.jpg" }] }
    });
  }, async () => {
    const result = await generateImage({ prompt: "橘猫", count: 1 });
    assert.equal(calls, 4);
    assert.equal(result.images?.[0]?.url, "https://img.test/fourth-attempt.jpg");
  });
});
```

- [ ] **Step 2: Run the two focused tests and verify they fail on the current implementation**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern "reference images|retries the project" tests/openapi-image.test.ts
```

Expected: FAIL because reference images are rejected before `fetch`, and provider errors are not retried.

- [ ] **Step 3: Add aggregate retry and reference-resource request construction**

Add beside the existing constants:

```ts
const PRIMARY_IMAGE_ATTEMPTS = 4;
```

Replace `requestImage` with the following shape so an empty synchronous response is a failure instead of a successful empty result:

```ts
async function requestImage(
  config: Image2Config,
  prompt: string,
  scale: string,
  sourceImageUrls: string[]
) {
  const payload: Record<string, unknown> = {
    params: {
      resolution: config.resolution,
      scale
    }
  };
  if (sourceImageUrls.length) payload.resources = sourceImageUrls;

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: providerHeaders(config),
    body: JSON.stringify({
      modelId: config.modelId,
      abilityType: "IMAGE",
      prompt,
      payload
    }),
    signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
  });

  const data = await response.json().catch(() => ({}));
  assertProviderResponse(response, data, "generate", config.apiUrl);
  if (extractImageUrls(data).length) return data;

  const taskId = extractTaskId(data);
  if (taskId) return queryImageTask(config, taskId);
  throw new Error("Image 2.0 生成失败：响应未返回图片或 taskId。");
}

async function requestCurrentImageWithRetries(
  config: Image2Config,
  prompt: string,
  scale: string,
  sourceImageUrls: string[]
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < PRIMARY_IMAGE_ATTEMPTS; attempt += 1) {
    try {
      return await requestImage(config, prompt, scale, sourceImageUrls);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
```

Remove the pre-request reference-image rejection. Add the reference-image instruction to `prompt`:

```ts
body.sourceImageUrls?.length
  ? "已随请求传入参考图。请严格按用户提示处理参考图关系，只修改指定对象，其他构图、背景、文字位置、光线和风格尽量保持不变。"
  : ""
```

Build tasks with the new helper:

```ts
const sourceImageUrls = body.sourceImageUrls ?? [];
const tasks = Array.from(
  { length: requestedCount },
  () => () => requestCurrentImageWithRetries(config, prompt, scale, sourceImageUrls)
);
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern "reference images|retries the project" tests/openapi-image.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit the aggregate retry and reference-resource behavior**

```powershell
git add -- tests/openapi-image.test.ts lib/adapters/openai-image.ts
git diff --cached --check
git commit -m "feat: retry aggregate image requests"
```

### Task 2: Restore Yunwu text-to-image fallback

**Files:**
- Modify: `tests/openapi-image.test.ts:6-45`
- Modify: `tests/openapi-image.test.ts` after the aggregate retry tests
- Modify: `lib/adapters/openai-image.ts:12-70`
- Modify: `lib/adapters/openai-image.ts` between aggregate request helpers and `runWithConcurrency`

- [ ] **Step 1: Extend test environment cleanup and add a text-to-image fallback test**

Extend `ENV_KEYS` with:

```ts
"YUNWU_IMAGE_URL",
"YUNWU_IMAGE_EDIT_URL",
"OPENAI_IMAGE_MODEL",
"OPENAI_IMAGE_FORMAT"
```

Add:

```ts
test("falls back to Yunwu generation after four project OpenAPI failures", async () => {
  let primaryCalls = 0;
  let yunwuInit: RequestInit | undefined;

  await withProvider(async (url, init) => {
    if (String(url) === "http://provider.test/openApi/generate") {
      primaryCalls += 1;
      return Response.json({ success: false, msg: "当前接口失败" });
    }
    assert.equal(String(url), "https://yunwu.test/v1/images/generations");
    yunwuInit = init;
    return Response.json({ data: [{ url: "https://img.test/yunwu.jpg" }] });
  }, async () => {
    process.env.YUNWU_API_KEY = "test-yunwu-key";
    process.env.YUNWU_IMAGE_URL = "https://yunwu.test/v1/images/generations";
    const result = await generateImage({ prompt: "橘猫", size: "3:4", count: 1 });

    assert.equal(primaryCalls, 4);
    assert.equal((yunwuInit?.headers as Record<string, string>).Authorization, "Bearer test-yunwu-key");
    const yunwuBody = JSON.parse(String(yunwuInit?.body));
    assert.equal(yunwuBody.model, "gpt-image-2");
    assert.match(yunwuBody.prompt, /橘猫/);
    assert.equal(yunwuBody.n, 1);
    assert.equal(yunwuBody.size, "1024x1536");
    assert.equal(yunwuBody.quality, "high");
    assert.equal(yunwuBody.format, "jpeg");
    assert.equal(result.images?.[0]?.url, "https://img.test/yunwu.jpg");
    assert.equal(result.images?.[0]?.provider, "Image 2.0 (Yunwu fallback)");
  });
});
```

- [ ] **Step 2: Run the fallback test and verify it fails**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern "falls back to Yunwu generation" tests/openapi-image.test.ts
```

Expected: FAIL because the adapter throws the fourth aggregate error and never requests Yunwu.

- [ ] **Step 3: Add Yunwu configuration, size mapping, response validation, and generation request**

Add:

```ts
type YunwuImageConfig = {
  apiKey: string;
  generationUrl: string;
  editUrl: string;
  model: string;
  format: string;
};

type ImageRequestResult = {
  data: unknown;
  provider: "Image 2.0" | "Image 2.0 (Yunwu fallback)";
  model: string;
};

function yunwuImageConfig(): YunwuImageConfig {
  const generationUrl = process.env.YUNWU_IMAGE_URL || "https://yunwu.ai/v1/images/generations";
  return {
    apiKey: process.env.YUNWU_API_KEY || "",
    generationUrl,
    editUrl: process.env.YUNWU_IMAGE_EDIT_URL || generationUrl.replace(/\/generations\/?$/, "/edits"),
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    format: process.env.OPENAI_IMAGE_FORMAT || "jpeg"
  };
}

function imageSizeFromRatio(ratio = "1:1") {
  const value = ratio.trim().toLowerCase();
  return ({
    "1:1": "1024x1024",
    "3:4": "1024x1536",
    "4:3": "1536x1024",
    "9:16": "1024x1792",
    "16:9": "1792x1024"
  } as Record<string, string>)[value] || (/^\d+x\d+$/.test(value) ? value : "1024x1024");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function requestYunwuGeneration(config: YunwuImageConfig, prompt: string, size: string) {
  if (!config.apiKey) throw new Error("未配置 YUNWU_API_KEY");
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
      n: 1,
      size,
      quality: "high",
      format: config.format
    }),
    signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  logImageProviderResponse({
    provider: "Image 2.0 (Yunwu fallback)",
    operation: "generate",
    endpoint: config.generationUrl,
    status: response.status,
    response: data
  });
  if (!response.ok || (data && typeof data === "object" && (data as Record<string, unknown>).success === false)) {
    throw new Error(`Yunwu Image 2.0 生成失败：${providerError(data, `HTTP ${response.status}`)}`);
  }
  if (!extractImageUrls(data).length) throw new Error("Yunwu Image 2.0 生成失败：响应未返回图片。");
  return data;
}
```

Add a provider orchestrator:

```ts
async function requestImageWithFallback(
  config: Image2Config,
  yunwuConfig: YunwuImageConfig,
  body: ImageInput,
  prompt: string,
  scale: string
): Promise<ImageRequestResult> {
  const sourceImageUrls = body.sourceImageUrls ?? [];
  try {
    return {
      data: await requestCurrentImageWithRetries(config, prompt, scale, sourceImageUrls),
      provider: "Image 2.0",
      model: config.modelId
    };
  } catch (primaryError) {
    try {
      return {
        data: await requestYunwuGeneration(yunwuConfig, prompt, imageSizeFromRatio(body.size)),
        provider: "Image 2.0 (Yunwu fallback)",
        model: yunwuConfig.model
      };
    } catch (fallbackError) {
      throw new Error(
        `Image 2.0 当前接口重试 3 次后仍失败：${errorMessage(primaryError)}；Yunwu 兜底失败：${errorMessage(fallbackError)}`
      );
    }
  }
}
```

In `generateImage`, create `const yunwuConfig = yunwuImageConfig()`, use `requestImageWithFallback` for every task, and preserve per-image provider metadata:

```ts
const yunwuConfig = yunwuImageConfig();
const tasks = Array.from(
  { length: requestedCount },
  () => () => requestImageWithFallback(config, yunwuConfig, body, prompt, scale)
);
const results = await runWithConcurrency(tasks, MAX_PARALLEL_IMAGE_REQUESTS);
const images = results.flatMap((result) => extractImageUrls(result.data).map((url) => ({
  url,
  provider: result.provider
}))).slice(0, requestedCount).map((image, index) => ({
  id: `image2_${Date.now()}_${index}`,
  ...image
}));
```

- [ ] **Step 4: Run the generation fallback test and verify it passes**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern "falls back to Yunwu generation" tests/openapi-image.test.ts
```

Expected: 1 test passes; the fetch sequence is four aggregate calls followed by one Yunwu generation call.

- [ ] **Step 5: Commit the Yunwu generation fallback**

```powershell
git add -- tests/openapi-image.test.ts lib/adapters/openai-image.ts
git diff --cached --check
git commit -m "feat: fall back to Yunwu image generation"
```

### Task 3: Add Yunwu image-edit fallback

**Files:**
- Modify: `tests/openapi-image.test.ts` after the Yunwu generation fallback test
- Modify: `lib/adapters/openai-image.ts` beside the Yunwu generation helper

- [ ] **Step 1: Add a failing test for reference-image fallback**

```ts
test("falls back to Yunwu edits after four project OpenAPI image-edit failures", async () => {
  let primaryCalls = 0;
  let editForm: FormData | undefined;

  await withProvider(async (url, init) => {
    if (String(url) === "http://provider.test/openApi/generate") {
      primaryCalls += 1;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.payload.resources, ["data:image/png;base64,aGVsbG8="]);
      return Response.json({ success: false, msg: "当前图生图失败" });
    }
    assert.equal(String(url), "https://yunwu.test/v1/images/edits");
    editForm = init?.body as FormData;
    return Response.json({ data: [{ url: "https://img.test/yunwu-edit.jpg" }] });
  }, async () => {
    process.env.YUNWU_API_KEY = "test-yunwu-key";
    process.env.YUNWU_IMAGE_URL = "https://yunwu.test/v1/images/generations";
    process.env.YUNWU_IMAGE_EDIT_URL = "https://yunwu.test/v1/images/edits";

    const result = await generateImage({
      prompt: "背景不变，只换人物",
      sourceImageUrls: ["data:image/png;base64,aGVsbG8="],
      count: 1
    });

    assert.equal(primaryCalls, 4);
    assert.equal(editForm?.get("model"), "gpt-image-2");
    assert.match(String(editForm?.get("prompt")), /背景不变，只换人物/);
    assert.equal(editForm?.get("n"), "1");
    assert.equal(editForm?.get("size"), "1024x1024");
    assert.equal(editForm?.getAll("image").length, 1);
    assert.equal(result.images?.[0]?.url, "https://img.test/yunwu-edit.jpg");
    assert.equal(result.images?.[0]?.provider, "Image 2.0 (Yunwu fallback)");
  });
});
```

- [ ] **Step 2: Run the edit fallback test and verify it fails**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern "falls back to Yunwu edits" tests/openapi-image.test.ts
```

Expected: FAIL because fallback still calls the Yunwu generation endpoint with JSON.

- [ ] **Step 3: Restore data-URL/file conversion and the Yunwu edit request**

Add:

```ts
function parseDataUrl(url: string) {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
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

  const response = await fetch(url);
  if (!response.ok) throw new Error(`参考图下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  return {
    blob: new Blob([arrayBuffer], { type: contentType }),
    fileName: `reference-${index + 1}.${ext}`
  };
}

async function requestYunwuEdit(
  config: YunwuImageConfig,
  prompt: string,
  size: string,
  sourceImageUrls: string[]
) {
  if (!config.apiKey) throw new Error("未配置 YUNWU_API_KEY");
  const form = new FormData();
  form.append("model", config.model);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", size);
  form.append("quality", "high");

  const images = await Promise.all(sourceImageUrls.map(imageUrlToBlob));
  images.forEach(({ blob, fileName }) => form.append("image", blob, fileName));

  const response = await fetch(config.editUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: form,
    signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({}));
  logImageProviderResponse({
    provider: "Image 2.0 (Yunwu fallback)",
    operation: "edit",
    endpoint: config.editUrl,
    status: response.status,
    response: data
  });
  if (!response.ok || (data && typeof data === "object" && (data as Record<string, unknown>).success === false)) {
    throw new Error(`Yunwu Image 2.0 编辑失败：${providerError(data, `HTTP ${response.status}`)}`);
  }
  if (!extractImageUrls(data).length) throw new Error("Yunwu Image 2.0 编辑失败：响应未返回图片。");
  return data;
}
```

Dispatch the fallback by request type inside `requestImageWithFallback`:

```ts
const fallbackData = sourceImageUrls.length
  ? await requestYunwuEdit(yunwuConfig, prompt, imageSizeFromRatio(body.size), sourceImageUrls)
  : await requestYunwuGeneration(yunwuConfig, prompt, imageSizeFromRatio(body.size));
return {
  data: fallbackData,
  provider: "Image 2.0 (Yunwu fallback)",
  model: yunwuConfig.model
};
```

- [ ] **Step 4: Run the edit fallback test and verify it passes**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern "falls back to Yunwu edits" tests/openapi-image.test.ts
```

Expected: 1 test passes; four aggregate requests precede one multipart Yunwu edit request.

- [ ] **Step 5: Commit the Yunwu edit fallback**

```powershell
git add -- tests/openapi-image.test.ts lib/adapters/openai-image.ts
git diff --cached --check
git commit -m "feat: fall back to Yunwu image edits"
```

### Task 4: Cover empty results, combined failures, and existing polling regressions

**Files:**
- Modify: `tests/openapi-image.test.ts:87-101`
- Modify: `tests/openapi-image.test.ts:222-271`

- [ ] **Step 1: Add empty-response and combined-provider failure tests**

```ts
test("treats an empty aggregate response as a failed attempt", async () => {
  let calls = 0;
  await withProvider(async () => {
    calls += 1;
    if (calls < 4) return Response.json({ success: true, data: {} });
    return Response.json({ success: true, data: { images: [{ url: "https://img.test/recovered.jpg" }] } });
  }, async () => {
    const result = await generateImage({ prompt: "橘猫", count: 1 });
    assert.equal(calls, 4);
    assert.equal(result.images?.[0]?.url, "https://img.test/recovered.jpg");
  });
});

test("reports both provider failures when Yunwu fallback also fails", async () => {
  let calls = 0;
  await withProvider(async (url) => {
    calls += 1;
    if (String(url) === "http://provider.test/openApi/generate") {
      return Response.json({ success: false, msg: "当前接口拒绝" });
    }
    return Response.json({ error: { message: "Yunwu 拒绝" } }, { status: 500 });
  }, async () => {
    process.env.YUNWU_API_KEY = "test-yunwu-key";
    process.env.YUNWU_IMAGE_URL = "https://yunwu.test/v1/images/generations";
    await assert.rejects(
      generateImage({ prompt: "橘猫", count: 1 }),
      /当前接口重试 3 次后仍失败.*当前接口拒绝.*Yunwu 兜底失败.*Yunwu 拒绝/
    );
    assert.equal(calls, 5);
  });
});
```

- [ ] **Step 2: Update existing asynchronous failure mocks for four complete attempts**

For `surfaces the provider message when an asynchronous image task fails`, branch by URL so every aggregate attempt creates and polls its own failed task:

```ts
let generateCalls = 0;
let queryCalls = 0;
await withProvider(async (url) => {
  if (String(url).endsWith("/generate")) {
    generateCalls += 1;
    return Response.json({
      success: true,
      data: { result: { taskId: `failed-task-${generateCalls}`, content: null, resourceUrls: null } }
    });
  }
  queryCalls += 1;
  return Response.json({
    success: true,
    data: { result: { taskId: `failed-task-${queryCalls}`, status: 3, message: "内容审核未通过" } }
  });
}, async () => {
  await assert.rejects(generateImage({ prompt: "橘猫", count: 1 }), /内容审核未通过/);
  assert.equal(generateCalls, 4);
  assert.equal(queryCalls, 4);
});
```

For `stops polling after the configured number of pending responses`, return one new task from each `/generate` request and a pending status from each `/queryResult` request, then assert:

```ts
assert.equal(generateCalls, 4);
assert.equal(queryCalls, 12);
```

This proves a poll timeout retries the complete generation exactly three times.

- [ ] **Step 3: Run the entire adapter test file**

Run:

```powershell
npx.cmd tsx --test tests/openapi-image.test.ts
```

Expected: every OpenAPI image adapter test passes; no test performs a real network request.

- [ ] **Step 4: Commit the failure and regression coverage**

```powershell
git add -- tests/openapi-image.test.ts
git diff --cached --check
git commit -m "test: cover image provider fallback failures"
```

### Task 5: Document configuration and run full verification

**Files:**
- Modify: `.env.example:14-31`
- Verify: `lib/adapters/openai-image.ts`
- Verify: `tests/openapi-image.test.ts`

- [ ] **Step 1: Restore Yunwu image variables in `.env.example`**

Add these blank/default values in the image-model section, next to the existing `YUNWU_API_KEY` entry:

```dotenv
YUNWU_IMAGE_URL=https://yunwu.ai/v1/images/generations
YUNWU_IMAGE_EDIT_URL=https://yunwu.ai/v1/images/edits
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_FORMAT=jpeg
```

Do not add a real `YUNWU_API_KEY` value.

- [ ] **Step 2: Run the complete test suite**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 3: Run TypeScript validation**

Run:

```powershell
npx.cmd tsc --noEmit
```

Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 4: Run whitespace and production-build checks**

Run:

```powershell
git diff --check
npm.cmd run build
```

Expected: `git diff --check` prints nothing and the Next.js production build exits successfully.

- [ ] **Step 5: Review the final diff against the approved design**

Run:

```powershell
git diff --stat HEAD~4
git diff HEAD~4 -- .env.example lib/adapters/openai-image.ts tests/openapi-image.test.ts
```

Expected: only the three approved implementation files changed after the design/plan commits; no credential value appears in the diff.

- [ ] **Step 6: Commit the environment documentation**

```powershell
git add -- .env.example
git diff --cached --check
git commit -m "docs: document Yunwu image fallback config"
```
