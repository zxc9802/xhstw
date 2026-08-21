# Hybrid Content Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show browser-stored legacy content beside current-member COS content while keeping every future save COS-only.

**Architecture:** Add a small pure adapter that parses the old localStorage payload into a common library item and merges it with normalized COS rows, preferring COS on duplicate IDs. The content-library page performs a read-only legacy load, resolves old IndexedDB image references, and gates deletion to COS rows only.

**Tech Stack:** TypeScript, React 19, Next.js 15, browser localStorage/IndexedDB read APIs, Node test runner with `tsx`.

---

### Task 1: Legacy content adapter

**Files:**
- Create: `lib/content-storage/library-items.ts`
- Create: `tests/content-storage-library-items.test.ts`

- [ ] **Step 1: Write the failing adapter tests**

Add tests that call `parseLegacyContentItems()` with a serialized old content row, assert its media URLs and `source: "browser"`, and call `mergeContentLibraryItems()` with duplicate COS/browser IDs to assert the COS row wins. Also assert malformed JSON returns an empty list.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/content-storage-library-items.test.ts
```

Expected: FAIL because `lib/content-storage/library-items.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure adapter**

Define `ContentLibraryItem`, `LEGACY_FINISHED_CONTENT_STORAGE_KEY`, `cloudContentItem()`, `parseLegacyContentItems()`, and `mergeContentLibraryItems()`. Parsing accepts only array/object rows with string IDs, normalizes optional fields, gathers old `mediaUrls` plus page images, and never mutates browser storage.

- [ ] **Step 4: Run the adapter tests and verify GREEN**

Run the Step 2 command. Expected: all adapter tests pass.

### Task 2: Read-only legacy display in the content library

**Files:**
- Modify: `app/content-library/page.tsx`
- Modify: `tests/content-library-contract.test.ts`

- [ ] **Step 1: Write the failing page contract test**

Require the page to read `LEGACY_FINISHED_CONTENT_STORAGE_KEY`, use `resolveImageRefs`, merge via `mergeContentLibraryItems`, and show `浏览器旧内容`. Keep assertions that the page contains no `localStorage.setItem`, `localStorage.removeItem`, `localStorage.clear`, or `persistImageFile`.

- [ ] **Step 2: Run the page test and verify RED**

```powershell
npm.cmd exec -- tsx --test tests/content-library-contract.test.ts
```

Expected: FAIL because the page does not yet load legacy rows.

- [ ] **Step 3: Implement the minimal page integration**

Normalize COS rows through `cloudContentItem()`, parse the legacy key once per reload, resolve legacy `cps-image://` references with `resolveImageRefs`, then merge. Render the source badge on browser rows, hide both delete buttons for browser rows, keep copy/preview/export available, and update the page description/count to cover both sources.

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
npm.cmd exec -- tsx --test tests/content-storage-library-items.test.ts tests/content-library-contract.test.ts tests/content-storage-*.test.ts
```

Expected: all focused tests pass.

### Task 3: Verify and publish the change locally

**Files:**
- Modify only files listed in Tasks 1-2.

- [ ] **Step 1: Run the full suite**

Run `npm.cmd test` with the inherited PowerShell module path temporarily removed, then restore the generated browser-extension ZIP from `HEAD` so the user's unrelated local ZIP remains outside this commit. Expected: all tests pass.

- [ ] **Step 2: Run the production build**

```powershell
npm.cmd run build
```

Expected: optimized production build completes successfully.

- [ ] **Step 3: Check and commit only intended files**

Run `git diff --check`, stage the two implementation files and two test files with explicit paths, and commit with:

```powershell
git commit -m "fix: show legacy browser content with COS library"
```

The existing modified `public/downloads/xhs-browser-extension-0.1.12.zip` must remain uncommitted and unchanged.
