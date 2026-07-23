# GPT Image 2 Local Reference Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert locally uploaded `data:image/...` references into short-lived public URLs before sending `gpt-image2-low` image-to-image requests to the first-release OpenAPI provider.

**Architecture:** Add a process-global, expiring in-memory reference store and an unauthenticated tokenized GET route that serves validated image bytes. The existing image-generation POST route publishes only local Image 2.0 references, preserves existing HTTP(S) references in order, passes the normalized URLs into the current asynchronous job, and deletes temporary tokens when the job completes or fails.

**Tech Stack:** TypeScript, Next.js route handlers, native `fetch`, Node `crypto`, Node test runner through `tsx`.

---

### Task 1: Add the expiring image-reference store

**Files:**
- Create: `lib/adapters/image-reference-store.ts`
- Create: `tests/image-reference-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `tests/image-reference-store.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_REFERENCE_TTL_MS,
  MAX_IMAGE_REFERENCE_BYTES,
  ImageReferenceInputError,
  deleteImageReferences,
  getImageReference,
  publishImageReferences
} from "../lib/adapters/image-reference-store";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

test("publishes local data images while preserving public reference order", () => {
  const now = 1_000;
  const result = publishImageReferences(
    [PNG_DATA_URL, "https://img.test/existing.jpg"],
    "https://app.test",
    now
  );

  assert.equal(result.urls.length, 2);
  assert.match(result.urls[0], /^https:\/\/app\.test\/api\/image\/reference\/[0-9a-f-]{36}$/);
  assert.equal(result.urls[1], "https://img.test/existing.jpg");
  assert.equal(result.tokens.length, 1);

  const stored = getImageReference(result.tokens[0], now);
  assert.equal(stored?.contentType, "image/png");
  assert.deepEqual([...stored!.bytes], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(stored?.expiresAt, now + IMAGE_REFERENCE_TTL_MS);
});

test("deletes references explicitly and expires stale references", () => {
  const removed = publishImageReferences([PNG_DATA_URL], "https://app.test", 1_000);
  deleteImageReferences(removed.tokens);
  assert.equal(getImageReference(removed.tokens[0], 1_000), undefined);

  const expired = publishImageReferences([PNG_DATA_URL], "https://app.test", 2_000);
  assert.equal(
    getImageReference(expired.tokens[0], 2_000 + IMAGE_REFERENCE_TTL_MS + 1),
    undefined
  );
});

test("rejects malformed and unsupported local image data", () => {
  for (const source of [
    "blob:https://app.test/local",
    "data:image/gif;base64,R0lGODlh",
    "data:image/png;base64,***"
  ]) {
    assert.throws(
      () => publishImageReferences([source], "https://app.test"),
      (error) => error instanceof ImageReferenceInputError && error.status === 400
    );
  }
});

test("rejects a single image above the memory limit", () => {
  const oversized = Buffer.alloc(MAX_IMAGE_REFERENCE_BYTES + 1).toString("base64");
  assert.throws(
    () => publishImageReferences(
      [`data:image/jpeg;base64,${oversized}`],
      "https://app.test"
    ),
    (error) => error instanceof ImageReferenceInputError && error.status === 413
  );
});

test("rejects a request above the aggregate memory limit and removes partial writes", () => {
  const nearLimit = `data:image/jpeg;base64,${Buffer.alloc(MAX_IMAGE_REFERENCE_BYTES).toString("base64")}`;
  assert.throws(
    () => publishImageReferences(
      [nearLimit, nearLimit, nearLimit, nearLimit, PNG_DATA_URL],
      "https://app.test"
    ),
    (error) => error instanceof ImageReferenceInputError && error.status === 413
  );
});

test("requires a public HTTPS origin only when a local image must be published", () => {
  assert.throws(
    () => publishImageReferences([PNG_DATA_URL], "http://localhost:3000"),
    (error) => error instanceof ImageReferenceInputError && error.status === 400
  );
  assert.deepEqual(
    publishImageReferences(["https://img.test/existing.jpg"], "http://localhost:3000").urls,
    ["https://img.test/existing.jpg"]
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/image-reference-store.test.ts
```

Expected: FAIL with `Cannot find module '../lib/adapters/image-reference-store'`.

- [ ] **Step 3: Implement the minimal store**

Create `lib/adapters/image-reference-store.ts`:

```ts
import { randomUUID } from "node:crypto";

export const IMAGE_REFERENCE_TTL_MS = 30 * 60 * 1000;
export const MAX_IMAGE_REFERENCE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_REFERENCE_REQUEST_BYTES = 40 * 1024 * 1024;

type StoredImageReference = {
  token: string;
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  expiresAt: number;
};

const referenceGlobal = globalThis as typeof globalThis & {
  __imageReferences?: Map<string, StoredImageReference>;
};

const references = referenceGlobal.__imageReferences ?? new Map<string, StoredImageReference>();
referenceGlobal.__imageReferences = references;

export class ImageReferenceInputError extends Error {
  constructor(message: string, public readonly status: 400 | 413) {
    super(message);
    this.name = "ImageReferenceInputError";
  }
}

function cleanupExpiredReferences(now: number) {
  for (const [token, reference] of references) {
    if (reference.expiresAt <= now) references.delete(token);
  }
}

function normalizedPublicOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("unsafe");
    return parsed.origin;
  } catch {
    throw new ImageReferenceInputError("本地参考图需要可公开访问的 HTTPS 域名。", 400);
  }
}

function decodeDataImage(source: string) {
  const match = source.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) {
    throw new ImageReferenceInputError("本地参考图格式无效，仅支持 JPEG、PNG 和 WebP。", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  const canonical = bytes.toString("base64").replace(/=+$/, "");
  if (!bytes.length || canonical !== match[2].replace(/=+$/, "")) {
    throw new ImageReferenceInputError("本地参考图 base64 内容无效。", 400);
  }
  if (bytes.byteLength > MAX_IMAGE_REFERENCE_BYTES) {
    throw new ImageReferenceInputError("单张本地参考图不能超过 10 MB。", 413);
  }
  return {
    bytes: new Uint8Array(bytes),
    contentType: match[1] as StoredImageReference["contentType"]
  };
}

export function deleteImageReferences(tokens: string[]) {
  tokens.forEach((token) => references.delete(token));
}

export function publishImageReferences(sources: string[], origin: string, now = Date.now()) {
  cleanupExpiredReferences(now);
  const urls: string[] = [];
  const tokens: string[] = [];
  let totalBytes = 0;

  try {
    for (const source of sources) {
      if (/^https?:\/\//i.test(source)) {
        urls.push(source);
        continue;
      }
      if (!source.startsWith("data:image/")) {
        throw new ImageReferenceInputError("参考图必须是公网 URL 或本地图片数据。", 400);
      }

      const decoded = decodeDataImage(source);
      totalBytes += decoded.bytes.byteLength;
      if (totalBytes > MAX_IMAGE_REFERENCE_REQUEST_BYTES) {
        throw new ImageReferenceInputError("单次请求的本地参考图总大小不能超过 40 MB。", 413);
      }

      const publicOrigin = normalizedPublicOrigin(origin);
      const token = randomUUID();
      references.set(token, {
        token,
        ...decoded,
        expiresAt: now + IMAGE_REFERENCE_TTL_MS
      });
      tokens.push(token);
      urls.push(new URL(`/api/image/reference/${token}`, publicOrigin).toString());
    }
    return { urls, tokens };
  } catch (error) {
    deleteImageReferences(tokens);
    throw error;
  }
}

export function getImageReference(token: string, now = Date.now()) {
  cleanupExpiredReferences(now);
  const reference = references.get(token);
  return reference
    ? { ...reference, bytes: new Uint8Array(reference.bytes) }
    : undefined;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx.cmd tsx --test tests/image-reference-store.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit the store**

```powershell
git add -- lib/adapters/image-reference-store.ts tests/image-reference-store.test.ts
git commit -m "feat: add temporary image reference store"
```

### Task 2: Serve temporary references through a tokenized route

**Files:**
- Create: `app/api/image/reference/[token]/route.ts`
- Create: `tests/image-reference-route.test.ts`
- Test: `tests/image-reference-store.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/image-reference-route.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../app/api/image/reference/[token]/route";
import {
  IMAGE_REFERENCE_TTL_MS,
  publishImageReferences
} from "../lib/adapters/image-reference-store";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

test("streams a stored reference with image safety headers", async () => {
  const published = publishImageReferences([PNG_DATA_URL], "https://app.test");
  const response = await GET(new Request(published.urls[0]), {
    params: Promise.resolve({ token: published.tokens[0] })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [137, 80, 78, 71, 13, 10, 26, 10]
  );
});

test("returns 404 for unknown and expired tokens", async () => {
  const unknown = await GET(new Request("https://app.test/api/image/reference/missing"), {
    params: Promise.resolve({ token: "missing" })
  });
  assert.equal(unknown.status, 404);

  const published = publishImageReferences(
    [PNG_DATA_URL],
    "https://app.test",
    Date.now() - IMAGE_REFERENCE_TTL_MS - 1
  );
  const expired = await GET(new Request(published.urls[0]), {
    params: Promise.resolve({ token: published.tokens[0] })
  });
  assert.equal(expired.status, 404);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/image-reference-route.test.ts
```

Expected: FAIL with `Cannot find module '../app/api/image/reference/[token]/route'`.

- [ ] **Step 3: Implement the route**

Create `app/api/image/reference/[token]/route.ts`:

```ts
import { getImageReference } from "@/lib/adapters/image-reference-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const reference = getImageReference(token);
  if (!reference) {
    return Response.json({ ok: false, message: "参考图不存在或已过期。" }, { status: 404 });
  }

  return new Response(reference.bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": reference.contentType,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
```

- [ ] **Step 4: Run both reference test files and verify GREEN**

Run:

```powershell
npx.cmd tsx --test tests/image-reference-store.test.ts tests/image-reference-route.test.ts
```

Expected: 8 tests PASS.

- [ ] **Step 5: Commit the public route**

```powershell
git add -- app/api/image/reference/[token]/route.ts tests/image-reference-route.test.ts
git commit -m "feat: serve temporary image references"
```

### Task 3: Publish local Image 2.0 references before starting the job

**Files:**
- Modify: `app/api/image/generate/route.ts`
- Modify: `tests/image-generation-job-route.test.ts`
- Test: `tests/openapi-image.test.ts`

- [ ] **Step 1: Add failing generation-route integration tests**

In `tests/image-generation-job-route.test.ts`, import the reference route:

```ts
import { GET as GET_REFERENCE } from "../app/api/image/reference/[token]/route";
```

Add helpers that configure and restore the first-release provider:

```ts
const IMAGE2_ENV = {
  IMAGE_MODEL_PROVIDER: "openapi",
  GPT_IMAGE2_API_URL: "https://provider.test/openApi/generate",
  GPT_IMAGE2_QUERY_URL: "https://provider.test/openApi/queryResult",
  GPT_IMAGE2_PROJECT_CODE: "project-code",
  GPT_IMAGE2_ACCESS_KEY: "access-key",
  GPT_IMAGE2_SECRET_KEY: "secret-key",
  GPT_IMAGE2_MODEL_ID: "gpt-image2-low",
  GPT_IMAGE2_POLL_INTERVAL_MS: "0",
  GPT_IMAGE2_POLL_MAX_ATTEMPTS: "2"
} as const;

function useImage2Provider(t: TestContext) {
  const keys = [...Object.keys(IMAGE2_ENV), "YUNWU_API_KEY"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, IMAGE2_ENV);
  delete process.env.YUNWU_API_KEY;
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function waitForJob(jobId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await GET(new Request("https://app.test"), {
      params: Promise.resolve({ jobId })
    });
    const payload = await response.json();
    if (payload.data?.status === "completed" || payload.data?.status === "failed") {
      return payload.data as { status: string; error?: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("job did not finish");
}
```

Add the successful local-reference test:

```ts
test("publishes local Image 2.0 references and preserves public URLs in resources", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, any> | undefined;
  let temporaryToken = "";
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    const temporaryUrl = new URL(requestBody!.payload.resources[0]);
    temporaryToken = temporaryUrl.pathname.split("/").pop() || "";
    const reference = await GET_REFERENCE(new Request(temporaryUrl), {
      params: Promise.resolve({ token: temporaryToken })
    });
    assert.equal(reference.status, 200);
    assert.deepEqual(
      [...new Uint8Array(await reference.arrayBuffer())],
      [137, 80, 78, 71, 13, 10, 26, 10]
    );
    return Response.json({
      success: true,
      data: { images: [{ url: "https://img.test/generated.jpg" }] }
    });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://0.0.0.0:3000/api/image/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-Host": "xhstw.qycm.top",
      "X-Forwarded-Proto": "https"
    },
    body: JSON.stringify({
      provider: "Image 2.0",
      prompt: "只换背景",
      count: 1,
      sourceImageUrls: [
        "data:image/png;base64,iVBORw0KGgo=",
        "https://img.test/existing.jpg"
      ]
    })
  }));
  const created = await response.json();
  const job = await waitForJob(created.data.jobId);

  assert.equal(job.status, "completed");
  assert.match(
    requestBody!.payload.resources[0],
    /^https:\/\/xhstw\.qycm\.top\/api\/image\/reference\/[0-9a-f-]{36}$/
  );
  assert.equal(requestBody!.payload.resources[1], "https://img.test/existing.jpg");

  const cleaned = await GET_REFERENCE(new Request("https://xhstw.qycm.top"), {
    params: Promise.resolve({ token: temporaryToken })
  });
  assert.equal(cleaned.status, 404);
});
```

Add failure and input-validation tests:

```ts
test("cleans temporary references when Image 2.0 generation fails", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let temporaryToken = "";
  let fetchCalls = 0;
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    const body = JSON.parse(String(init?.body));
    temporaryToken = new URL(body.payload.resources[0]).pathname.split("/").pop() || "";
    return Response.json({ success: false, msg: "渠道失败" });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "Image 2.0",
      prompt: "只换背景",
      sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo="]
    })
  }));
  const created = await response.json();
  const job = await waitForJob(created.data.jobId);

  assert.equal(job.status, "failed");
  assert.equal(fetchCalls, 4);
  const cleaned = await GET_REFERENCE(new Request("https://app.test"), {
    params: Promise.resolve({ token: temporaryToken })
  });
  assert.equal(cleaned.status, 404);
});

test("rejects invalid local references before creating an image job", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response();
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "Image 2.0",
      sourceImageUrls: ["data:image/png;base64,***"]
    })
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(fetchCalls, 0);
});
```

- [ ] **Step 2: Run the focused route test and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/image-generation-job-route.test.ts
```

Expected: the new success test FAILS because `payload.resources[0]` is still a `data:image/...` value, and the invalid-input test returns `202` instead of `400`.

- [ ] **Step 3: Add request-origin and body-normalization helpers**

In `app/api/image/generate/route.ts`, add:

```ts
import {
  ImageReferenceInputError,
  deleteImageReferences,
  publishImageReferences
} from "@/lib/adapters/image-reference-store";

function publicRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  if (!forwardedHost || !/^(http|https)$/.test(forwardedProto || "")) return requestUrl.origin;
  try {
    return new URL(`${forwardedProto}://${forwardedHost}`).origin;
  } catch {
    return requestUrl.origin;
  }
}

function usesImage2References(provider: string) {
  return !provider.includes("Nano")
    && !provider.includes("仅生成提示词")
    && process.env.IMAGE_MODEL_PROVIDER !== "nano-banana"
    && process.env.IMAGE_MODEL_PROVIDER !== "mock";
}

function imageSourceUrls(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const value = (body as { sourceImageUrls?: unknown }).sourceImageUrls;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ImageReferenceInputError("参考图列表格式无效。", 400);
  }
  return value as string[];
}
```

- [ ] **Step 4: Publish before job creation and clean up in `finally`**

Replace the start of `POST` so it normalizes Image 2.0 references before creating the job:

```ts
export async function POST(request: Request) {
  const body = await readJson(request);
  const provider = body && typeof body === "object" && "provider" in body
    ? String((body as { provider?: unknown }).provider)
    : "";
  let jobBody = body;
  let referenceTokens: string[] = [];

  try {
    if (usesImage2References(provider)) {
      const sourceImageUrls = imageSourceUrls(body);
      if (sourceImageUrls.length) {
        const published = publishImageReferences(
          sourceImageUrls,
          publicRequestOrigin(request)
        );
        referenceTokens = published.tokens;
        jobBody = {
          ...(body as Record<string, unknown>),
          sourceImageUrls: published.urls
        };
      }
    }
  } catch (error) {
    if (error instanceof ImageReferenceInputError) {
      return Response.json(
        { ok: false, message: error.message },
        { status: error.status }
      );
    }
    throw error;
  }

  const job = createImageGenerationJob();

  void runImageGenerationJob(job.id, async () => {
    try {
      const result = provider.includes("Nano")
        || process.env.IMAGE_MODEL_PROVIDER === "nano-banana"
        ? await generateWithNanoBanana(jobBody)
        : await generateImage(jobBody);
      const imageCount = result
        && typeof result === "object"
        && "images" in result
        && Array.isArray((result as { images?: unknown }).images)
        ? (result as { images: unknown[] }).images.length
        : 0;
      console.log(`[image/generate] job=${job.id} provider=${provider || "default"} images=${imageCount}`);
      return result;
    } catch (error) {
      console.error(`[image/generate] job=${job.id}`, error);
      throw error;
    } finally {
      deleteImageReferences(referenceTokens);
    }
  });

  return Response.json(
    { ok: true, data: { jobId: job.id, status: job.status } },
    { status: 202 }
  );
}
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
npx.cmd tsx --test tests/image-reference-store.test.ts tests/image-reference-route.test.ts tests/image-generation-job-route.test.ts tests/openapi-image.test.ts
```

Expected: all focused tests PASS, including the existing assertion that first-release references are sent in `payload.resources`.

- [ ] **Step 6: Commit the Image 2.0 route integration**

```powershell
git add -- app/api/image/generate/route.ts tests/image-generation-job-route.test.ts
git commit -m "feat: publish local image2 references"
```

### Task 4: Verify the complete application

**Files:**
- Verify: `lib/adapters/image-reference-store.ts`
- Verify: `app/api/image/reference/[token]/route.ts`
- Verify: `app/api/image/generate/route.ts`
- Verify: `tests/image-reference-store.test.ts`
- Verify: `tests/image-reference-route.test.ts`
- Verify: `tests/image-generation-job-route.test.ts`

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
npm.cmd test
```

Expected: all existing and new tests PASS with no failed, cancelled, or skipped tests.

- [ ] **Step 2: Run the production build**

Run:

```powershell
npm.cmd run build
```

Expected: Next.js production build exits with code 0.

- [ ] **Step 3: Run TypeScript checking after the build**

Run:

```powershell
npx.cmd tsc --noEmit
```

Expected: exit code 0 with no TypeScript diagnostics. Run this after the build because the build recreates `.next/types`.

- [ ] **Step 4: Audit the final diff and credential boundary**

Run:

```powershell
git diff --check
git status --short
rg -n "GPT_IMAGE2_(ACCESS_KEY|SECRET_KEY)=.+" . --glob "!node_modules/**" --glob "!.next/**" --glob "!.git/**"
```

Expected:

- `git diff --check` prints nothing.
- `git status --short` contains only the intended feature files.
- the credential search finds no committed live credential values.

- [ ] **Step 5: Record the live-verification boundary**

Report separately:

- automated contract, route, cleanup, complete tests, build, and type checking results;
- no claim of a successful live first-release image-to-image run until Zeabur has the project credentials, an allowlisted outbound IP, and a fresh local-reference generation returns an image.
