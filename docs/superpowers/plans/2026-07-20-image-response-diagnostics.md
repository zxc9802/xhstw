# Image Response Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely expose the external image provider's real response schema for one reference-image request, so the later jobId polling implementation can use its actual contract.

**Architecture:** A small server-only diagnostics helper reduces arbitrary provider responses to a bounded, redacted JSON summary. Both image adapters call it immediately after parsing the upstream response; it writes nothing unless `IMAGE_RESPONSE_DEBUG=true`. The browser API response remains unchanged.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Node.js 24 built-in test runner executed through `tsx`.

---

## File structure

- Create: `lib/adapters/image-response-diagnostics.ts` — pure response redaction and opt-in server log helper.
- Create: `tests/image-response-diagnostics.test.ts` — tests redaction behavior with a real TypeScript module.
- Modify: `package.json` — add the `tsx` development dependency and `test` script.
- Modify: `lib/adapters/openai-image.ts` — record parsed success and error payload shapes for the generations and edits upstream calls.
- Modify: `lib/adapters/nano-banana.ts` — record parsed Chat Completions response shapes for reference-image Nano Banana calls.
- Modify: `.env.example` — document the disabled-by-default diagnostic switch without inserting secrets.

### Task 1: Establish a runnable TypeScript test command

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the test command and test runner dependency**

Add this script and development dependency, preserving existing package versions and formatting:

```json
{
  "scripts": {
    "test": "tsx --test tests/**/*.test.ts"
  },
  "devDependencies": {
    "tsx": "^4.20.0"
  }
}
```

- [ ] **Step 2: Install the lockfile-resolved dependency**

Run:

```powershell
npm.cmd install
```

Expected: `tsx` is available at `node_modules/.bin/tsx.cmd`; the only dependency-file changes are `package.json` and `package-lock.json`.

### Task 2: Test and implement bounded response redaction

**Files:**
- Create: `tests/image-response-diagnostics.test.ts`
- Create: `lib/adapters/image-response-diagnostics.ts`

- [ ] **Step 1: Write a failing test for a diagnostic summary**

Create `tests/image-response-diagnostics.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { summarizeImageProviderResponse } from "../lib/adapters/image-response-diagnostics";

test("redacts image payloads and credential-shaped fields without losing job metadata", () => {
  const result = summarizeImageProviderResponse({
    task_id: "job_123",
    status: "processing",
    authorization: "Bearer should-not-appear",
    image: "data:image/jpeg;base64,ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    nested: { api_key: "secret", output: "x".repeat(300) }
  });

  assert.deepEqual(result, {
    task_id: "job_123",
    status: "processing",
    authorization: "[redacted]",
    image: { type: "data-url", length: 49 },
    nested: { api_key: "[redacted]", output: { type: "string", length: 300, preview: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" } }
  });
});

test("keeps an endpoint path but removes its query string", () => {
  const result = summarizeImageProviderResponse({ ok: true }, "https://provider.example/v1/tasks/abc?access_token=secret");
  assert.deepEqual(result, {
    endpoint: "https://provider.example/v1/tasks/abc",
    response: { ok: true }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails because the module does not exist**

Run:

```powershell
npm.cmd test
```

Expected: FAIL with a module-resolution error for `image-response-diagnostics`; no production diagnostics module exists yet.

- [ ] **Step 3: Implement the minimal pure diagnostics helper**

Create `lib/adapters/image-response-diagnostics.ts`:

```ts
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 5;
const MAX_STRING_PREVIEW = 64;
const SENSITIVE_KEY = /authorization|api[_-]?key|token|secret|password/i;

function endpointWithoutQuery(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split("?")[0];
  }
}

function summarize(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return { type: "data-url", length: value.length };
    if (value.length > MAX_STRING_PREVIEW) return { type: "string", length: value.length, preview: value.slice(0, MAX_STRING_PREVIEW) };
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarize(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : summarize(item, depth + 1)]));
  }
  return value;
}

export function summarizeImageProviderResponse(response: unknown, endpoint?: string) {
  const summary = summarize(response, 0);
  return endpoint ? { endpoint: endpointWithoutQuery(endpoint), response: summary } : summary;
}

export function logImageProviderResponse(input: { provider: string; operation: string; endpoint: string; status: number; response: unknown }) {
  if (process.env.IMAGE_RESPONSE_DEBUG !== "true") return;
  console.info("[image/provider-response]", JSON.stringify({
    provider: input.provider,
    operation: input.operation,
    status: input.status,
    ...summarizeImageProviderResponse(input.response, input.endpoint)
  }));
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
npm.cmd test
```

Expected: two passing tests; Base64 image data, credential-shaped keys, and URL query strings are absent from the output.

### Task 3: Instrument both image-provider adapters

**Files:**
- Modify: `lib/adapters/openai-image.ts`
- Modify: `lib/adapters/nano-banana.ts`

- [ ] **Step 1: Add response logging to Image 2.0 generation and edit calls**

At the top of `lib/adapters/openai-image.ts`, add:

```ts
import { logImageProviderResponse } from "@/lib/adapters/image-response-diagnostics";
```

Immediately after each `const data = await response.json().catch(() => ({}));` in `generateImageEdit` and `generateImageBatch`, add respectively:

```ts
logImageProviderResponse({
  provider: "Image 2.0",
  operation: "edit",
  endpoint: YUNWU_IMAGE_EDIT_URL,
  status: response.status,
  response: data
});
```

and:

```ts
logImageProviderResponse({
  provider: "Image 2.0",
  operation: "generate",
  endpoint: YUNWU_IMAGE_URL,
  status: response.status,
  response: data
});
```

- [ ] **Step 2: Add response logging to Nano Banana calls**

At the top of `lib/adapters/nano-banana.ts`, add:

```ts
import { logImageProviderResponse } from "@/lib/adapters/image-response-diagnostics";
```

Immediately after its `const data = await response.json().catch(() => ({}));`, add:

```ts
logImageProviderResponse({
  provider: "Nano Banana 2",
  operation: "generate",
  endpoint: YUNWU_CHAT_URL,
  status: response.status,
  response: data
});
```

- [ ] **Step 3: Type-check and run the test suite**

Run:

```powershell
npm.cmd test
npm.cmd exec tsc -- --noEmit
```

Expected: all diagnostics tests pass and TypeScript exits with status 0.

### Task 4: Document and capture one real reference-image response

**Files:**
- Modify: `.env.example`
- Read: `logs/` output from the temporary local server

- [ ] **Step 1: Document the disabled-by-default switch**

Append this comment and variable to `.env.example`:

```text
# Set to true only while diagnosing an external image-provider response. Logs a redacted, size-bounded response shape.
IMAGE_RESPONSE_DEBUG=false
```

- [ ] **Step 2: Run a fresh local server with diagnostics enabled**

In a dedicated PowerShell process, set the environment only for that process and start the app:

```powershell
$env:IMAGE_RESPONSE_DEBUG = "true"
npm.cmd run dev
```

Expected: normal application startup; no diagnostic line appears until a real image request reaches an external provider.

- [ ] **Step 3: Submit one real reference-image generation request**

Use the content page's reference-image generation flow with a non-sensitive image and prompt. Wait for the initial API request to return, then capture the single `[image/provider-response]` log line.

Expected: the log contains only the provider, operation, HTTP status, endpoint path, and a redacted response body shape. It must reveal either direct `images`/`data` output or a task identifier and status fields.

- [ ] **Step 4: Remove the diagnostic environment variable and assess the captured contract**

Stop the temporary process or start the next server without `IMAGE_RESPONSE_DEBUG`. Record the captured field names in the follow-up job-polling design; do not place full provider responses, Base64 data, or credentials in source control.

### Task 5: Final verification

**Files:**
- Read: changed files and build output

- [ ] **Step 1: Check the narrow diff**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors when the directory is later placed under Git. In the current non-Git directory, record that the command cannot run.

- [ ] **Step 2: Run production build**

Run:

```powershell
npm.cmd run build
```

Expected: the Next.js production build exits with status 0.

- [ ] **Step 3: Confirm the diagnostic remains opt-in**

Run one local image request without `IMAGE_RESPONSE_DEBUG=true` and verify no `[image/provider-response]` line is emitted.
