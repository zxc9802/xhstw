# nanobanan新聚合生图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `nanobanan新` image provider that submits `gemini-3.1-flash-image-preview` jobs to the configured aggregation API, polls them to completion, and appears in every existing image-provider selector.

**Architecture:** Keep the existing image job API as the browser-facing asynchronous boundary. Add a focused server-only aggregation adapter, route only the exact `nanobanan新` provider to it, and reuse the existing temporary reference publisher so local images become URLs accepted by `payload.resources`.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Node.js `fetch`, Node test runner through `tsx --test`.

---

## File Structure

- Create `lib/adapters/nanobanana-new.ts`: aggregation configuration, request construction, submission, polling, response parsing, and normalized image results.
- Create `tests/nanobanana-new.test.ts`: adapter request, polling, error, and timeout behavior.
- Modify `types/image.ts`: add the new provider literal.
- Modify `app/content/page.tsx`: add the new provider to the shared selector array.
- Modify `app/api/image/generate/route.ts`: publish references and dispatch the new provider to its adapter.
- Modify `tests/content-production-contract.test.ts`: assert the shared provider list contains the option.
- Modify `tests/image-generation-job-route.test.ts`: assert route dispatch and temporary-reference cleanup.
- Modify `.env.example`: document non-secret aggregation configuration.
- Modify `.env.local`: add the supplied real aggregation configuration without committing the file.

### Task 1: Frontend Provider Contract

**Files:**
- Modify: `types/image.ts`
- Modify: `app/content/page.tsx`
- Modify: `tests/content-production-contract.test.ts`

- [ ] **Step 1: Write the failing frontend contract test**

Add a source assertion that verifies both the provider type and the shared option list contain the exact display value:

```ts
const imageTypeSource = readFileSync("types/image.ts", "utf8");

test("all image provider selectors expose nanobanan新", () => {
  assert.equal(imageTypeSource.includes('"nanobanan新"'), true);
  assert.match(
    source,
    /const imageProviders: ImageProvider\[\] = \[[^\]]*"nanobanan新"/
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm.cmd test -- tests/content-production-contract.test.ts
```

Expected: FAIL because neither source file contains `nanobanan新`.

- [ ] **Step 3: Add the minimal provider type and option**

Update the union type:

```ts
export type ImageProvider =
  | "Image 2.0"
  | "GPT Image"
  | "Nano Banana 2"
  | "nanobanan新"
  | "仅生成提示词，不直接生图";
```

Insert `"nanobanan新"` in the existing `imageProviders` array. Do not duplicate selector markup: both current selectors already map over this shared array.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/content-production-contract.test.ts
```

Expected: all tests in the file PASS.

- [ ] **Step 5: Commit the frontend contract**

```powershell
git add -- types/image.ts app/content/page.tsx tests/content-production-contract.test.ts
git commit -m "feat: expose nanobanana aggregation option"
```

### Task 2: Aggregation Adapter

**Files:**
- Create: `lib/adapters/nanobanana-new.ts`
- Create: `tests/nanobanana-new.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create tests that set these isolated environment values:

```ts
const PROVIDER_ENV = {
  IMAGE_AGGREGATION_API_BASE_URL: "https://aggregation.test",
  IMAGE_AGGREGATION_PROJECT_CODE: "project-code",
  IMAGE_AGGREGATION_ACCESS_KEY: "access-key",
  IMAGE_AGGREGATION_SECRET_KEY: "secret-key",
  NANOBANANA_NEW_MODEL_ID: "gemini-3.1-flash-image-preview",
  NANOBANANA_NEW_POLL_INTERVAL_MS: "0",
  NANOBANANA_NEW_POLL_MAX_ATTEMPTS: "3"
} as const;
```

Cover these behaviors with one test each:

1. Submit to `/openApi/generate` with the three authentication headers and the exact model, prompt, scale, resolution, and `payload.resources`.
2. Poll `/openApi/queryResult` with `{ taskId, abilityType: "IMAGE" }` and return the final image URL.
3. Reject a provider response with `success: false`.
4. Reject a successful submit response without a task ID or immediate image.
5. Reject a terminal failed query with its provider message.
6. Reject after the configured poll limit.
7. Reject a terminal successful result with no image URL.

The successful request assertion must include:

```ts
assert.deepEqual(JSON.parse(String(submitInit?.body)), {
  modelId: "gemini-3.1-flash-image-preview",
  abilityType: "IMAGE",
  prompt: "只替换背景",
  payload: {
    resources: ["https://app.test/reference/source.png"],
    params: { resolution: "1K", scale: "3:4" }
  }
});
```

- [ ] **Step 2: Run the adapter tests and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/nanobanana-new.test.ts
```

Expected: FAIL with module-not-found for `lib/adapters/nanobanana-new`.

- [ ] **Step 3: Implement the minimal adapter**

Create `generateWithNanobananaNew(input: unknown)` with:

```ts
type NanobananaNewInput = {
  prompt?: string;
  size?: string;
  count?: number;
  sourceImageUrls?: string[];
};
```

Configuration rules:

```ts
const baseUrl = stripTrailingSlash(required("IMAGE_AGGREGATION_API_BASE_URL"));
const modelId = process.env.NANOBANANA_NEW_MODEL_ID || "gemini-3.1-flash-image-preview";
```

Submit headers:

```ts
{
  Accept: "application/json",
  "Content-Type": "application/json",
  projectCode,
  "X-Access-Key": accessKey,
  "X-Secret-Key": secretKey
}
```

Submit body:

```ts
{
  modelId,
  abilityType: "IMAGE",
  prompt,
  payload: {
    ...(sourceImageUrls.length ? { resources: sourceImageUrls } : {}),
    params: {
      resolution: "1K",
      scale: imageScaleFromSize(input.size)
    }
  }
}
```

Run one task per requested image, capped at 10. Accept an immediate image response; otherwise require a task ID and poll. Normalize returned images to:

```ts
{
  provider: "nanobanan新",
  model: modelId,
  input: body,
  images: [{ id: `nanobanana_new_${Date.now()}_${index}`, url, provider: "nanobanan新" }]
}
```

Use `AbortSignal.timeout(5 * 60 * 1000)` for every provider request and `logImageProviderResponse` for bounded redacted diagnostics.

- [ ] **Step 4: Run the adapter tests and verify GREEN**

Run:

```powershell
npx.cmd tsx --test tests/nanobanana-new.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit the adapter**

```powershell
git add -- lib/adapters/nanobanana-new.ts tests/nanobanana-new.test.ts
git commit -m "feat: add nanobanana aggregation adapter"
```

### Task 3: Image Job Route Integration

**Files:**
- Modify: `app/api/image/generate/route.ts`
- Modify: `tests/image-generation-job-route.test.ts`

- [ ] **Step 1: Write the failing route integration test**

Add an isolated aggregation environment helper and a fetch stub that:

- receives `/openApi/generate`;
- reads the first `payload.resources` URL while the temporary reference exists;
- returns `{ success: true, data: { taskId: "task-1" } }`;
- receives `/openApi/queryResult`;
- returns a succeeded payload with `https://img.test/nanobanana-new.jpg`.

POST:

```ts
{
  provider: "nanobanan新",
  prompt: "只替换背景",
  size: "9:16",
  sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo="]
}
```

Assert the job completes, the adapter used the aggregation endpoint, and the temporary reference returns 404 after completion.

- [ ] **Step 2: Run the route test and verify RED**

Run:

```powershell
npx.cmd tsx --test tests/image-generation-job-route.test.ts
```

Expected: the new test FAILS because the provider is currently routed to the existing non-aggregation adapter.

- [ ] **Step 3: Implement exact route dispatch and reference publication**

Import:

```ts
import { generateWithNanobananaNew } from "@/lib/adapters/nanobanana-new";
```

Add:

```ts
function isNanobananaNew(provider: string) {
  return provider === "nanobanan新";
}
```

Change reference routing so `nanobanan新` publishes local references through `publishImageReferences`. Dispatch in this order:

```ts
const result = isNanobananaNew(provider)
  ? await generateWithNanobananaNew(jobBody)
  : provider.includes("Nano") || process.env.IMAGE_MODEL_PROVIDER === "nano-banana"
    ? await generateWithNanoBanana(jobBody)
    : await generateImage(jobBody);
```

Keep the existing `finally` cleanup unchanged.

- [ ] **Step 4: Run adapter and route tests**

Run:

```powershell
npx.cmd tsx --test tests/nanobanana-new.test.ts tests/image-generation-job-route.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit route integration**

```powershell
git add -- app/api/image/generate/route.ts tests/image-generation-job-route.test.ts
git commit -m "feat: route nanobanana aggregation jobs"
```

### Task 4: Environment Configuration

**Files:**
- Modify: `.env.example`
- Modify locally only: `.env.local`

- [ ] **Step 1: Add safe configuration examples**

Add to `.env.example`:

```dotenv
IMAGE_AGGREGATION_API_BASE_URL=http://14.103.147.238:19220
IMAGE_AGGREGATION_PROJECT_CODE=
IMAGE_AGGREGATION_ACCESS_KEY=
IMAGE_AGGREGATION_SECRET_KEY=
NANOBANANA_NEW_MODEL_ID=gemini-3.1-flash-image-preview
NANOBANANA_NEW_POLL_INTERVAL_MS=3000
NANOBANANA_NEW_POLL_MAX_ATTEMPTS=100
```

- [ ] **Step 2: Configure the local environment**

Add the user-supplied aggregation endpoint and three credentials to `.env.local`, plus the non-sensitive model and polling defaults. Never print the credential values and never stage `.env.local`.

- [ ] **Step 3: Verify configuration shape without exposing secrets**

Run a PowerShell check that reports only `SET`, `EMPTY`, or `MISSING` for credential variables and prints only the non-secret model and poll values.

Expected: all four aggregation connection variables report `SET`; model and polling values match the design.

- [ ] **Step 4: Commit only the safe example**

```powershell
git add -- .env.example
git commit -m "docs: configure nanobanana aggregation environment"
```

### Task 5: Full Verification

**Files:**
- Verify all files changed by Tasks 1-4.

- [ ] **Step 1: Run the complete test suite**

```powershell
npm.cmd test
```

Expected: exit code 0 with zero failed tests.

- [ ] **Step 2: Run the production build**

```powershell
npm.cmd run build
```

Expected: exit code 0 and a successful Next.js production build.

- [ ] **Step 3: Check formatting and scope**

```powershell
git diff --check HEAD~4
git status --short
git log -5 --oneline
```

Expected: no whitespace errors; `.env.local` remains untracked or ignored; the pre-existing modified extension ZIP remains untouched; only intended commits and files appear.

- [ ] **Step 4: Review requirements against the design**

Confirm:

- `nanobanan新` appears in the shared provider list used by both selectors.
- only the exact new provider uses the aggregation adapter;
- references are public during the task and cleaned afterward;
- secrets remain server-only and uncommitted;
- existing providers remain unchanged.
