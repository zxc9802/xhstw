# GPT Image Local Job Polling Implementation Plan

> **DEPRECATED** — This plan was superseded on 2026-07-20. The project switched to **synchronous image generation with browser-side IndexedDB history** instead of a server-side job store, because a process-local store cannot survive Cloudflare Workers' stateless execution model.
> 
> See the current implementation:
> - `app/api/image/generate/route.ts` returns the provider result directly.
> - `lib/utils/image-generation-history.ts` persists generated images in the browser.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `gpt-image-2` for reference-image edits while returning a project-generated job ID and polling its local status.

**Architecture:** A process-local job store creates a UUID, starts an un-awaited Node promise, and records `queued`, `processing`, `completed`, or `failed`. The image generation route returns `202` immediately for Image 2.0 requests with reference images, and the content page polls a job-status route until the stored provider result is available. The provider request receives a five-minute abort timeout.

**Tech Stack:** Next.js route handlers, React client polling, TypeScript, Node test runner through `tsx`.

---

### Task 1: Lock the local job-store contract with tests

**Files:**
- Create: `tests/image-generation-job-store.test.ts`
- Create: `lib/adapters/image-generation-job-store.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("completes a queued job with the image result", async () => {
  const job = createImageGenerationJob({ prompt: "test" });
  await runImageGenerationJob(job.id, async () => ({ images: [{ url: "https://example.test/image.png" }] }));
  assert.equal(getImageGenerationJob(job.id)?.status, "completed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- tests/image-generation-job-store.test.ts`

Expected: FAIL because `image-generation-job-store` does not exist.

- [ ] **Step 3: Implement the minimal in-memory store**

Create queued jobs with `crypto.randomUUID()`, claim each job once, and write success or failure back to the stored snapshot.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm.cmd test -- tests/image-generation-job-store.test.ts`

Expected: PASS.

### Task 2: Add asynchronous image routes and client polling

**Files:**
- Modify: `app/api/image/generate/route.ts`
- Create: `app/api/image/generate/[jobId]/route.ts`
- Modify: `app/content/page.tsx`

- [ ] **Step 1: Route Image 2.0 reference-image requests through the job store**

Return `{ ok: true, jobId, job }` with HTTP 202, scheduling `generateImage` without awaiting it. Keep every existing synchronous provider path unchanged.

- [ ] **Step 2: Add a status GET route**

Return the local task snapshot by ID; return 404 for an unknown task.

- [ ] **Step 3: Poll jobs in the content page**

On a 202 response, request `/api/image/generate/{jobId}` every three seconds, use the completed job result as the existing image response, and surface failed jobs through the existing page error handling.

### Task 3: Set the provider request deadline and verify

**Files:**
- Modify: `lib/adapters/openai-image.ts`
- Test: `tests/image-generation-job-store.test.ts`

- [ ] **Step 1: Add a five-minute abort deadline to each Yunwu Image 2.0 fetch**

Wrap edit and generation requests with a shared helper that aborts after 300,000 ms and clears its timer after the fetch settles.

- [ ] **Step 2: Run verification**

Run: `npm.cmd test`; `npm.cmd exec tsc -- --noEmit`

Expected: all tests pass and TypeScript exits with code 0.
