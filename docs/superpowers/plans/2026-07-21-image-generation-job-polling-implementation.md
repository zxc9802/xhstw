# Image Generation Job Polling Implementation Plan

> **For Codex:** Execute this plan task by task. Keep the change limited to the image generation POST route, a new job status route/store, a small polling helper, and the existing single-plan image generation caller.

**Goal:** Return a local `jobId` from image generation immediately and poll short status requests until the original image result is ready, avoiding Cloudflare HTTP 524 on the long-running POST request.

**Architecture:** The existing synchronous provider calls continue running unchanged inside the Zeabur Node process. A `globalThis`-backed in-memory store tracks queued, processing, completed, and failed jobs. The POST route starts a background promise and returns HTTP 202; a new GET route exposes a snapshot. The client polls every three seconds for at most six minutes and then feeds the completed result into the existing image parsing path.

**Tech Stack:** Next.js 15 App Router, TypeScript, React 19, Node `crypto.randomUUID`, `tsx --test`.

---

### Task 1: Add the process-local image generation job store

**Files:**
- Create: `lib/adapters/image-generation-job-store.ts`
- Test: `tests/image-generation-job-store.test.ts`

**Step 1: Write failing lifecycle tests**

Cover these externally visible behaviors:

```ts
test("runs an image generation job to completion", async () => {
  const job = createImageGenerationJob();
  await runImageGenerationJob(job.id, async () => ({ images: ["data:image/png;base64,abc"] }));
  assert.deepEqual(getImageGenerationJob(job.id)?.result, { images: ["data:image/png;base64,abc"] });
});

test("records a safe error when generation fails", async () => {
  const job = createImageGenerationJob();
  await runImageGenerationJob(job.id, async () => { throw new Error("provider failed"); });
  assert.equal(getImageGenerationJob(job.id)?.status, "failed");
  assert.equal(getImageGenerationJob(job.id)?.error, "provider failed");
});

test("expires terminal jobs after thirty minutes", async () => {
  const job = createImageGenerationJob();
  await runImageGenerationJob(job.id, async () => ({ images: [] }));
  assert.equal(getImageGenerationJob(job.id, Date.now() + IMAGE_GENERATION_JOB_TTL_MS + 1), undefined);
});
```

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test tests\image-generation-job-store.test.ts
```

Expected: FAIL because the store module does not exist.

**Step 2: Implement the minimal store**

Create a typed store with:

```ts
export type ImageGenerationJobStatus = "queued" | "processing" | "completed" | "failed";

export type ImageGenerationJob = {
  id: string;
  status: ImageGenerationJobStatus;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
};

export const IMAGE_GENERATION_JOB_TTL_MS = 30 * 60 * 1000;

export function createImageGenerationJob(now = Date.now()): ImageGenerationJob;
export function getImageGenerationJob(id: string, now = Date.now()): ImageGenerationJob | undefined;
export async function runImageGenerationJob(id: string, task: () => Promise<unknown>): Promise<void>;
```

Implementation rules:

- Generate IDs with `randomUUID()`.
- Reuse one `Map` through a typed `globalThis.__imageGenerationJobs` property.
- Return copied snapshots so callers cannot mutate stored state.
- Change to `processing` before awaiting the provider.
- Catch every provider error, write `failed`, and do not rethrow.
- Only delete completed/failed records older than 30 minutes.

**Step 3: Run the focused tests**

```powershell
.\node_modules\.bin\tsx.cmd --test tests\image-generation-job-store.test.ts
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add lib/adapters/image-generation-job-store.ts tests/image-generation-job-store.test.ts
git commit -m "feat: add image generation job store"
```

### Task 2: Convert the generation API to POST-and-poll

**Files:**
- Modify: `app/api/image/generate/route.ts`
- Create: `app/api/image/generate/[jobId]/route.ts`
- Test: `tests/image-generation-job-route.test.ts`

**Step 1: Write failing route contract tests**

Test the route directly using mock generation mode:

```ts
test("POST returns 202 with a queued job id", async () => {
  process.env.IMAGE_MODEL_PROVIDER = "mock";
  const response = await POST(new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "Image 2.0", prompt: "test", count: 1 })
  }));
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.equal(payload.data.status, "queued");
  assert.match(payload.data.jobId, /^[0-9a-f-]{36}$/);
});

test("GET returns 404 for an unknown job", async () => {
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ jobId: "missing" })
  });
  assert.equal(response.status, 404);
});
```

Also poll the created job through GET until mock mode returns `completed`, proving the POST and GET routes share the same store.

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test tests\image-generation-job-route.test.ts
```

Expected: FAIL because POST is still synchronous and the GET route does not exist.

**Step 2: Change POST to return HTTP 202 immediately**

In `app/api/image/generate/route.ts`:

- Keep the current provider selection exactly as-is.
- Create a queued job.
- Start `void runImageGenerationJob(job.id, async () => { ... })`.
- Move the current provider call and image-count log inside that task.
- Return this response without awaiting the provider:

```ts
return Response.json(
  { ok: true, data: { jobId: job.id, status: job.status } },
  { status: 202 }
);
```

Provider exceptions are recorded by the store instead of becoming a POST 500.

**Step 3: Add the job status GET route**

In `app/api/image/generate/[jobId]/route.ts`:

```ts
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = getImageGenerationJob(jobId);
  if (!job) {
    return Response.json(
      { ok: false, message: "图片生成任务不存在或已失效，可能是服务已重启，请重新生成。" },
      { status: 404 }
    );
  }
  return ok(job);
}
```

**Step 4: Run the focused route tests**

```powershell
.\node_modules\.bin\tsx.cmd --test tests\image-generation-job-route.test.ts
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add app/api/image/generate/route.ts app/api/image/generate/[jobId]/route.ts tests/image-generation-job-route.test.ts
git commit -m "feat: return image generation job ids"
```

### Task 3: Add a tested browser polling helper

**Files:**
- Create: `lib/utils/image-generation-job-client.ts`
- Test: `tests/image-generation-job-client.test.ts`

**Step 1: Write failing polling tests**

Use injected `fetcher`, `sleep`, and `now` functions so tests never wait in real time. Cover:

1. `queued -> processing -> completed` returns `job.result`.
2. `failed` throws the server's error message.
3. HTTP 404 throws the task-expired message.
4. Repeated pending states beyond `timeoutMs` throw a timeout message.

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test tests\image-generation-job-client.test.ts
```

Expected: FAIL because the polling helper does not exist.

**Step 2: Implement the polling helper**

Export:

```ts
type ImageGenerationPollOptions = {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export async function pollImageGenerationJob(jobId: string, options: ImageGenerationPollOptions = {}): Promise<unknown>;
```

Defaults:

- `fetcher = fetch`
- `intervalMs = 3000`
- `timeoutMs = 6 * 60 * 1000`
- sleep with `setTimeout`
- clock with `Date.now`

For each poll:

- GET `/api/image/generate/${encodeURIComponent(jobId)}` with `cache: "no-store"`.
- Stop immediately on non-OK responses, `payload.ok === false`, `failed`, `completed`, or unknown status.
- Continue only for `queued` and `processing`.
- Return the complete `result` unchanged.

**Step 3: Run the focused client tests**

```powershell
.\node_modules\.bin\tsx.cmd --test tests\image-generation-job-client.test.ts
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add lib/utils/image-generation-job-client.ts tests/image-generation-job-client.test.ts
git commit -m "feat: poll image generation jobs"
```

### Task 4: Wire polling into single-plan image generation

**Files:**
- Modify: `app/content/page.tsx`

**Step 1: Add the helper import**

```ts
import { pollImageGenerationJob } from "@/lib/utils/image-generation-job-client";
```

**Step 2: Preserve the synchronous fallback and handle HTTP 202**

After parsing the POST response:

```ts
if (!response.ok || data?.ok === false) {
  throw new Error(data?.message || data?.error || "图片接口返回异常");
}

let result = data?.data ?? data;
if (response.status === 202) {
  const jobId = typeof result?.jobId === "string" ? result.jobId : "";
  if (!jobId) throw new Error("图片接口未返回任务 ID");
  setFeedback(`P${page} 图片任务已提交，正在等待 ${provider} 生成结果。`);
  result = await pollImageGenerationJob(jobId);
}
```

Leave the existing URL extraction, history replacement, page status, and final feedback logic unchanged. The 200-response fallback supports rolling deployment or a local older backend.

**Step 3: Run all automated tests**

```powershell
npm.cmd test
```

Expected: all tests PASS.

**Step 4: Run the production build**

```powershell
npm.cmd run build
```

Expected: Next.js build and TypeScript checks PASS, including the dynamic GET route and client helper types.

**Step 5: Inspect the exact diff**

```powershell
git status --short
git diff --check
git diff HEAD -- app/api/image/generate/route.ts app/api/image/generate/[jobId]/route.ts lib/adapters/image-generation-job-store.ts lib/utils/image-generation-job-client.ts app/content/page.tsx tests/image-generation-job-store.test.ts tests/image-generation-job-route.test.ts tests/image-generation-job-client.test.ts
```

Verify every changed line traces to the Job ID polling requirement.

**Step 6: Commit**

```powershell
git add app/content/page.tsx
git commit -m "fix: poll long-running image generation"
```

### Task 5: Final verification and handoff

**Step 1: Re-run verification from the committed tree**

```powershell
npm.cmd test
npm.cmd run build
git status --short
git log --oneline -5
```

Expected: tests and build PASS; worktree is clean.

**Step 2: Report the evidence boundary**

Report separately:

- Confirmed locally: POST/GET task contract, lifecycle/error/expiry logic, client polling, full tests, production build.
- Requires deployment: a real four-image generation request through Cloudflare to confirm the live 524 is gone.
- Known selected limitation: restarting/redeploying the single Zeabur process loses in-flight in-memory jobs and the UI asks the user to retry.
