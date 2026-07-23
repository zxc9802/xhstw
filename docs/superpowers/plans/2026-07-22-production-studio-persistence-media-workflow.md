# Production Studio Persistence and Media Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the approved image-production, local-export, finished-library, account-management, and neutral-branding behaviors work after HTTPS deployment on the same computer and browser.

**Architecture:** Keep structured state in versioned `localStorage` records and binary images in the existing IndexedDB image store. Put deterministic state transitions and browser directory writing behind small tested utilities, then wire the existing Next.js client pages to those utilities without restructuring unrelated workflows.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.7, IndexedDB, File System Access API, Node `tsx --test`.

---

### Task 1: Add tested workflow and versioned-storage helpers

**Files:**
- Create: `lib/utils/production-workflow.ts`
- Create: `lib/utils/local-state.ts`
- Create: `tests/production-workflow.test.ts`
- Create: `tests/local-state.test.ts`

- [ ] **Step 1: Write failing workflow tests**

Create tests that import the wished-for functions and assert these exact behaviors:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  addKeywordValues,
  removeKeywordValue,
  reorderAssignedImages,
  selectExportTargets,
  withoutSelectedKeywords
} from "../lib/utils/production-workflow";

test("keyword additions persist while deleted defaults remain hidden", () => {
  const added = addKeywordValues({ customKeywords: [], hiddenKeywords: ["防晒"] }, ["防晒", "通勤"]);
  assert.deepEqual(added, { customKeywords: ["防晒", "通勤"], hiddenKeywords: [] });
  assert.deepEqual(removeKeywordValue(added, "通勤"), { customKeywords: ["防晒"], hiddenKeywords: ["通勤"] });
});

test("new work keeps copy fields but starts with no selected keywords", () => {
  assert.deepEqual(withoutSelectedKeywords({ id: "A1", title: "标题", tags: ["防晒"] }), { id: "A1", title: "标题", tags: [] });
});

test("selected images preserve a user-defined horizontal order", () => {
  assert.deepEqual(reorderAssignedImages({ 0: ["a", "b", "c"] }, 0, "c", "a"), { 0: ["c", "a", "b"] });
});

test("exports selected items when present and otherwise visible items", () => {
  const visible = [{ id: "visible" }];
  assert.deepEqual(selectExportTargets([{ id: "selected" }], visible), [{ id: "selected" }]);
  assert.deepEqual(selectExportTargets([], visible), visible);
});
```

- [ ] **Step 2: Run the workflow test and verify RED**

Run: `npx.cmd tsx --test tests/production-workflow.test.ts`

Expected: FAIL because `lib/utils/production-workflow.ts` does not exist.

- [ ] **Step 3: Implement the minimal workflow helpers**

Implement immutable functions with these signatures:

```ts
export type KeywordLibraryState = { customKeywords: string[]; hiddenKeywords: string[] };

export function addKeywordValues(state: KeywordLibraryState, incoming: string[]): KeywordLibraryState;
export function removeKeywordValue(state: KeywordLibraryState, keyword: string): KeywordLibraryState;
export function withoutSelectedKeywords<T extends { tags: string[] }>(item: T): T;
export function reorderAssignedImages(assignments: Record<number, string[]>, workIndex: number, sourceUrl: string, targetUrl: string): Record<number, string[]>;
export function selectExportTargets<T>(selected: T[], visible: T[]): T[];
```

`reorderAssignedImages` removes the source URL and inserts it immediately before the target URL. Unknown URLs return the original logical order.

- [ ] **Step 4: Write failing versioned-storage tests**

Use an in-memory `StorageLike` fake and assert valid round trips, version mismatch fallback, and malformed JSON fallback:

```ts
import { loadVersionedState, saveVersionedState, type StorageLike } from "../lib/utils/local-state";

test("versioned state round trips through browser-like storage", () => {
  const values = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }
  };
  saveVersionedState(storage, "draft", 1, { title: "保留" });
  assert.deepEqual(loadVersionedState(storage, "draft", 1, { title: "默认" }), { title: "保留" });
  assert.deepEqual(loadVersionedState(storage, "draft", 2, { title: "默认" }), { title: "默认" });
  values.set("draft", "not-json");
  assert.deepEqual(loadVersionedState(storage, "draft", 1, { title: "默认" }), { title: "默认" });
});
```

- [ ] **Step 5: Run the storage test and verify RED**

Run: `npx.cmd tsx --test tests/local-state.test.ts`

Expected: FAIL because `lib/utils/local-state.ts` does not exist.

- [ ] **Step 6: Implement and verify both helper suites**

Implement:

```ts
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function loadVersionedState<T>(storage: StorageLike, key: string, version: number, fallback: T): T {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "null") as { version?: number; data?: T } | null;
    return parsed?.version === version && parsed.data !== undefined ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function saveVersionedState<T>(storage: StorageLike, key: string, version: number, data: T) {
  storage.setItem(key, JSON.stringify({ version, data }));
}
```

Run: `npx.cmd tsx --test tests/production-workflow.test.ts tests/local-state.test.ts`

Expected: all tests PASS.

- [ ] **Step 7: Commit helper behavior**

```powershell
git add -- lib/utils/production-workflow.ts lib/utils/local-state.ts tests/production-workflow.test.ts tests/local-state.test.ts
git commit -m "test: define persistent production workflow behavior"
```

### Task 2: Add tested real browser-directory writing

**Files:**
- Create: `lib/utils/browser-file-export.ts`
- Create: `tests/browser-file-export.test.ts`

- [ ] **Step 1: Write the failing directory-writer test**

Create fake directory, file, and writable handles that record filenames and blobs. Assert `writeBlobFiles()` writes successful files, continues after one failure, and returns `{ saved, failed }`. Also assert `safeFileName('作品: A/B?') === '作品_ A_B_'` and MIME extension inference for PNG, JPEG, and WebP.

- [ ] **Step 2: Run the directory-writer test and verify RED**

Run: `npx.cmd tsx --test tests/browser-file-export.test.ts`

Expected: FAIL because `lib/utils/browser-file-export.ts` does not exist.

- [ ] **Step 3: Implement the minimal writer**

Implement these public types and functions:

```ts
export type WritableFileLike = { createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> };
export type WritableDirectoryLike = {
  name: string;
  getFileHandle(name: string, options: { create: true }): Promise<WritableFileLike>;
  getDirectoryHandle?(name: string, options: { create: true }): Promise<WritableDirectoryLike>;
};
export type BlobFile = { name: string; blob: Blob };

export function safeFileName(value: string): string;
export function imageExtension(blob: Blob): "png" | "jpg" | "webp" | "gif";
export async function writeBlobFiles(directory: WritableDirectoryLike, files: BlobFile[]): Promise<{ saved: number; failed: number; errors: string[] }>;
```

Use `getFileHandle(name, { create: true })`, then `createWritable()`, `write(blob)`, and `close()` for every file. Catch per-file errors so later files still run.

- [ ] **Step 4: Verify and commit directory writing**

Run: `npx.cmd tsx --test tests/browser-file-export.test.ts`

Expected: all tests PASS.

```powershell
git add -- lib/utils/browser-file-export.ts tests/browser-file-export.test.ts
git commit -m "feat: add browser directory image writer"
```

### Task 3: Persist keywords and the image-production draft, and remove default prompts

**Files:**
- Modify: `app/content/page.tsx`
- Modify: `lib/utils/image-store.ts`
- Create: `tests/content-production-contract.test.ts`

- [ ] **Step 1: Write failing source-contract tests**

Read `app/content/page.tsx` as UTF-8 and assert it contains versioned keys for keyword state and image draft, uses `withoutSelectedKeywords` when selecting or adding a work, and does not contain either prompt fallback:

```ts
assert.equal(source.includes("planPromptMap[item.page] ?? item.prompt"), false);
assert.equal(source.includes("planPromptMap[page] || plan.prompt"), false);
```

Also assert the initial page prompt text is `""` rather than the current demonstration sentence.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npx.cmd tsx --test tests/content-production-contract.test.ts`

Expected: FAIL on missing persistence keys and existing prompt fallbacks.

- [ ] **Step 3: Wire persistent keyword state**

Add constants such as:

```ts
const KEYWORD_LIBRARY_STORAGE_KEY = "content-production-studio.keyword-library";
const IMAGE_DRAFT_STORAGE_KEY = "content-production-studio.image-draft";
const LOCAL_STATE_VERSION = 1;
```

Hydrate `customKeywords` and `hiddenKeywords` once with `loadVersionedState`, then save every later change with `saveVersionedState`. Use the tested workflow helpers in `addCustomKeyword`, `deleteKeywordFromLibrary`, initial selected drafts, candidate selection, and new-work creation so new work starts with `tags: []`.

- [ ] **Step 4: Persist binary source images and the image draft**

Export a small `persistImageFile(file, scope)` wrapper from `lib/utils/image-store.ts` that stores a supplied `File`/`Blob` directly and returns a `cps-image://` reference. Replace local `blob:`-only upload state with stored refs and resolve those refs for display. Hydrate and save the editable image-generation state only after the first read completes.

Persist image step, selected works, account/type, image plans/order, active page, per-page prompt/size/count/provider maps, and stable source-image refs. Do not persist modal, loading, preview, or drag state.

- [ ] **Step 5: Remove all P-page prompt defaults**

Initialize `imagePromptText` as `""`; render textarea values from `planPromptMap[page] ?? ""`; send `planPromptMap[page] ?? ""` to `/api/image/generate`; and store finished prompts with the same empty fallback. Preserve a user-entered prompt restored from the draft.

- [ ] **Step 6: Verify and commit draft behavior**

Run:

```powershell
npx.cmd tsx --test tests/content-production-contract.test.ts tests/production-workflow.test.ts tests/local-state.test.ts
npx.cmd tsc --noEmit
```

Expected: tests and type checking PASS.

```powershell
git add -- app/content/page.tsx lib/utils/image-store.ts tests/content-production-contract.test.ts
git commit -m "feat: persist image production draft and keywords"
```

### Task 4: Save selected images locally and make finished-image selection manual and ordered

**Files:**
- Modify: `app/content/page.tsx`
- Modify: `tests/content-production-contract.test.ts`

- [ ] **Step 1: Extend the contract test and verify RED**

Assert the page now contains `localSaveSelectedUrls`, `writeBlobFiles`, `reorderAssignedImages`, a visible “上传图片” action in the finished preview, and a preview layer higher than the finished modal. Assert `openFinishedPreview` sets empty assignments and no longer calls `buildDefaultImageAssignments()`.

Run: `npx.cmd tsx --test tests/content-production-contract.test.ts`

Expected: FAIL because the UI is not wired.

- [ ] **Step 2: Implement selected-image local saving**

Replace the mock save handler with a dialog that shows all generated images and checkboxes. Default to no selection. Call `showDirectoryPicker()` directly from the choose-folder button, retain the returned handle in React state, resolve each selected image URL/ref to a `Blob`, name it `P{page}_{index}.{ext}`, and pass it to `writeBlobFiles()`.

If `showDirectoryPicker` is unavailable, download only selected images through temporary `<a download>` elements. Never claim success when the picker was cancelled or no files were written.

- [ ] **Step 3: Remove automatic finished assignments and preserve manual order**

Delete `buildDefaultImageAssignments`. `openFinishedPreview()` sets `{}`. `saveFinishedContent()` uses current assignments without fallback. Build `workImages` by mapping the assignment URL array to the matching pool image, not by filtering and sorting `generatedImages`.

Make selected thumbnails draggable and call `reorderAssignedImages(assignments, workIndex, sourceUrl, targetUrl)` on drop.

- [ ] **Step 4: Add per-work local upload and fix image zoom stacking**

Place “上传图片” beside each work's “全部” filter. Persist each uploaded file to IndexedDB, add the resolved preview to `generatedImages` with provider `本地上传`, and append its stable URL/reference to only that work's assignment array. Use a preview overlay such as `z-[80]` while finished and material modals remain `z-50`.

- [ ] **Step 5: Verify and commit image selection behavior**

Run:

```powershell
npx.cmd tsx --test tests/content-production-contract.test.ts tests/browser-file-export.test.ts tests/production-workflow.test.ts
npx.cmd tsc --noEmit
```

Expected: tests and type checking PASS.

```powershell
git add -- app/content/page.tsx tests/content-production-contract.test.ts
git commit -m "feat: add manual ordered image packaging and local save"
```

### Task 5: Export real finished-library images and add top-level zoom

**Files:**
- Modify: `app/content-library/page.tsx`
- Create: `tests/content-library-contract.test.ts`

- [ ] **Step 1: Write failing library-contract tests**

Read the page source and assert:

- the visible label is “导出到本地文件夹” and not “导入本地文件夹”;
- `selectExportTargets` and `writeBlobFiles` are used;
- the old “当前为本地 mock 导出” text is absent;
- card and detail images call one shared preview setter;
- a top-level image preview overlay exists above drawers.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npx.cmd tsx --test tests/content-library-contract.test.ts`

Expected: FAIL on the old label and mock exporter.

- [ ] **Step 3: Replace the mock folder exporter**

Use `selectExportTargets(selectedItems, folderItems)`. Ask for a directory handle on click. For each target with real media, create a sanitized per-title subdirectory, resolve stored refs, convert the resolved URLs to blobs, and call `writeBlobFiles()` with `01.ext`, `02.ext`, and so on. Skip works without real images and include skipped counts in feedback.

Use selected targets for the header export action and preserve existing manifest-only row actions unless they explicitly invoke the real image-folder exporter.

- [ ] **Step 4: Add shared image zoom**

Add `previewImageUrl` state. Wrap card thumbnails and detail-drawer thumbnails in buttons that invoke the setter. Render a `z-[80]` backdrop near the page root so it remains above the `z-50` drawer.

- [ ] **Step 5: Verify and commit library export**

Run:

```powershell
npx.cmd tsx --test tests/content-library-contract.test.ts tests/browser-file-export.test.ts tests/production-workflow.test.ts
npx.cmd tsc --noEmit
```

Expected: tests and type checking PASS.

```powershell
git add -- app/content-library/page.tsx tests/content-library-contract.test.ts
git commit -m "feat: export finished images and add library zoom"
```

### Task 6: Persist accounts, upload avatars, and delete accounts

**Files:**
- Modify: `app/accounts/page.tsx`
- Create: `tests/accounts-contract.test.ts`

- [ ] **Step 1: Write failing account-contract tests**

Read `app/accounts/page.tsx` and assert it contains a versioned account storage key, an `accept="image/*"` file input in the edit modal, IndexedDB image persistence, visible “编辑” and “删除” actions, and `window.confirm` before removal.

- [ ] **Step 2: Run the account contract and verify RED**

Run: `npx.cmd tsx --test tests/accounts-contract.test.ts`

Expected: FAIL because accounts are memory-only and deletion/upload are absent.

- [ ] **Step 3: Persist account rows**

Hydrate account rows once from versioned `localStorage`, using existing mock accounts only as the first-run fallback. Gate the save effect until hydration completes. Existing add and edit handlers continue to update `accountRows`, which then persists automatically.

- [ ] **Step 4: Add avatar upload and deletion**

Pass an async avatar handler into `EditAccountModal`. Reject non-image files, store the file with `persistImageFile`, resolve it for immediate preview, and save the stable reference on the account. Add a danger “删除” button next to “编辑”; call `window.confirm`, then filter and persist the account row on confirmation.

- [ ] **Step 5: Verify and commit account behavior**

Run:

```powershell
npx.cmd tsx --test tests/accounts-contract.test.ts tests/local-state.test.ts
npx.cmd tsc --noEmit
```

Expected: tests and type checking PASS.

```powershell
git add -- app/accounts/page.tsx tests/accounts-contract.test.ts
git commit -m "feat: persist account avatars and deletion"
```

### Task 7: Neutralize product branding without removing platform fields

**Files:**
- Modify: `app/layout.tsx`
- Modify: `components/layout/AppShell.tsx`
- Modify: `app/content/page.tsx`
- Modify: `app/topics/page.tsx`
- Create: `tests/branding-contract.test.ts`

- [ ] **Step 1: Write the failing branding contract**

Read the four UI source files and assert old product phrases are absent:

```ts
for (const phrase of ["小红书图文生产状态", "小红书图文生产", "Xiaohongshu Image Studio"]) {
  assert.equal(uiSource.includes(phrase), false);
}
assert.equal(uiSource.includes("图文生产中台"), true);
assert.equal(uiSource.includes("图文生产状态"), true);
```

Assert `app/topics/page.tsx` renders “选题列表” rather than a title assembled as `${platform} 选题列表`. Do not scan or alter platform data, filters, account fields, or adapter prompts.

- [ ] **Step 2: Run the branding contract and verify RED**

Run: `npx.cmd tsx --test tests/branding-contract.test.ts`

Expected: FAIL on the old branding strings.

- [ ] **Step 3: Apply the exact visible-text replacements**

Change metadata, sidebar brand, status cards, image-production page header, and topic list heading. Use “Content Production Studio” as the neutral English subtitle if the subtitle remains.

- [ ] **Step 4: Verify and commit branding**

Run:

```powershell
npx.cmd tsx --test tests/branding-contract.test.ts
npx.cmd tsc --noEmit
```

Expected: tests and type checking PASS.

```powershell
git add -- app/layout.tsx components/layout/AppShell.tsx app/content/page.tsx app/topics/page.tsx tests/branding-contract.test.ts
git commit -m "chore: rename product to production studio"
```

### Task 8: Run full verification and inspect the final scope

**Files:**
- Verify all files changed in Tasks 1-7

- [ ] **Step 1: Run all tests**

Run: `npm.cmd test`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run type checking and the production build**

Run:

```powershell
npx.cmd tsc --noEmit
npm.cmd run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Inspect scope and whitespace**

Run:

```powershell
git diff --check main...HEAD
git status --short
git diff --stat main...HEAD
git log --oneline main..HEAD
```

Expected: no whitespace errors, no changes under `扩展/`, and only planned application, utility, test, and documentation files differ.

- [ ] **Step 4: Review every acceptance criterion**

Re-read `docs/superpowers/specs/2026-07-22-production-studio-persistence-media-workflow-design.md` and map each of its ten acceptance criteria to the passing tests, type/build evidence, or a clearly stated manual browser check that still remains.
