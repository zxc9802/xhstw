# Feishu Sync Platform Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TikTok, Instagram, and Facebook to the content library platform selector while keeping those choices scoped to the existing Feishu sync request.

**Architecture:** Define a dedicated Feishu sync platform list beside the existing platform constants, then consume only that list in the content library card selector. Keep the global `platforms` list unchanged so no other page gains multi-platform behavior.

**Tech Stack:** Next.js 15, React 19, TypeScript, Node test runner through `tsx`

---

### Task 1: Add and consume Feishu sync platform options

**Files:**
- Create: `tests/feishu-sync-platform-options.test.ts`
- Modify: `lib/constants/platforms.ts:1-5`
- Modify: `app/content-library/page.tsx:3-14,176-177`

- [x] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { feishuSyncPlatformOptions, platforms } from "../lib/constants/platforms";

test("offers all supported Feishu sync platforms without expanding global platforms", () => {
  assert.deepEqual(feishuSyncPlatformOptions, ["小红书", "TikTok", "Instagram", "Facebook"]);
  assert.deepEqual(platforms, ["小红书"]);
});
```

- [x] **Step 2: Run the test to verify it fails for the missing export**

Run: `.\node_modules\.bin\tsx.cmd --test tests\feishu-sync-platform-options.test.ts`

Expected: FAIL because `feishuSyncPlatformOptions` is not exported by `lib/constants/platforms.ts`.

- [x] **Step 3: Add the dedicated platform list**

Append to `lib/constants/platforms.ts`:

```ts
export const feishuSyncPlatformOptions = ["小红书", "TikTok", "Instagram", "Facebook"];
```

- [x] **Step 4: Run the focused test to verify it passes**

Run: `.\node_modules\.bin\tsx.cmd --test tests\feishu-sync-platform-options.test.ts`

Expected: PASS with one passing test.

- [x] **Step 5: Wire the content library selector to the dedicated list**

Add this import to `app/content-library/page.tsx`:

```ts
import { feishuSyncPlatformOptions } from "@/lib/constants/platforms";
```

Replace the page-local platform list:

```ts
const publishPlatformOptions = feishuSyncPlatformOptions;
```

Do not modify `syncContentToFeishu`; it already passes the selected value as `platform` to `/api/feishu/sync-content`.

- [x] **Step 6: Run focused and full verification**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test tests\feishu-sync-platform-options.test.ts
npm.cmd test
npm.cmd run build
```

Expected: the focused test passes, the complete test suite passes, and the production build completes successfully.

- [x] **Step 7: Review and commit the implementation**

Run:

```powershell
git diff --check
git diff -- lib/constants/platforms.ts app/content-library/page.tsx tests/feishu-sync-platform-options.test.ts
git add -- lib/constants/platforms.ts app/content-library/page.tsx tests/feishu-sync-platform-options.test.ts docs/superpowers/plans/2026-07-21-feishu-sync-platform-options.md
git diff --cached --check
git commit -m "feat: add Feishu sync platform options"
```

Expected: only the planned files are committed and the commit succeeds.
