# Content Library Per-Item Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every COS and browser-legacy content row a permanent delete action in card, table, and detail views.

**Architecture:** Keep the existing member-scoped COS DELETE route unchanged. Add one pure legacy-storage deletion helper that preserves unrelated raw browser rows and returns IndexedDB image references, then make the content-library page branch by `item.source`, clean the relevant storage, and update all related React state only after the record deletion succeeds.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, browser `localStorage` and IndexedDB, Node test runner through `tsx`.

---

### Task 1: Delete one browser-legacy record without touching other rows

**Files:**
- Modify: `lib/content-storage/library-items.ts`
- Test: `tests/content-storage-library-items.test.ts`

- [ ] **Step 1: Write the failing pure-function test**

Add `deleteLegacyContentItem` to the test import and append:

```ts
test("deletes one legacy row while preserving other raw records and returning local image refs", () => {
  const raw = JSON.stringify([
    {
      id: "legacy-delete",
      title: "待删除",
      mediaUrls: ["cps-image://cover", "https://example.com/remote.jpg"],
      pages: [{ images: ["cps-image://page-2", "cps-image://cover"] }],
      customField: "保持原始结构"
    },
    { id: "legacy-keep", title: "保留", customField: { nested: true } }
  ]);

  const result = deleteLegacyContentItem(raw, "legacy-delete");

  assert.deepEqual(JSON.parse(result.serialized), [
    { id: "legacy-keep", title: "保留", customField: { nested: true } }
  ]);
  assert.deepEqual(result.imageRefs, ["cps-image://cover", "cps-image://page-2"]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/content-storage-library-items.test.ts
```

Expected: FAIL because `deleteLegacyContentItem` is not exported.

- [ ] **Step 3: Implement the minimal legacy deletion helper**

Add this export after `parseLegacyContentItems` in `lib/content-storage/library-items.ts`:

```ts
export function deleteLegacyContentItem(raw: string | null, contentId: string) {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(value)) throw new Error();
    const removed = value.filter((candidate) => candidate
      && typeof candidate === "object"
      && text((candidate as Record<string, unknown>).id) === contentId);
    if (!removed.length) throw new Error();
    const remaining = value.filter((candidate) => !(candidate
      && typeof candidate === "object"
      && text((candidate as Record<string, unknown>).id) === contentId));
    const imageRefs = [...new Set(removed.flatMap((candidate) =>
      legacyMediaUrls(candidate as Record<string, unknown>)
        .filter((url) => url.startsWith("cps-image://"))
    ))];
    return { serialized: JSON.stringify(remaining), imageRefs };
  } catch {
    throw new Error("浏览器旧内容删除失败");
  }
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/content-storage-library-items.test.ts
```

Expected: all tests in the file PASS.

- [ ] **Step 5: Commit the helper and its test**

```powershell
git add -- lib/content-storage/library-items.ts tests/content-storage-library-items.test.ts
git diff --cached --check
git commit -m "feat: delete browser legacy content"
```

### Task 2: Add delete actions to every content view

**Files:**
- Modify: `app/content-library/page.tsx`
- Modify: `tests/content-library-contract.test.ts`

- [ ] **Step 1: Replace the obsolete page contract with a failing deletion contract**

Replace the test named `resolves legacy IndexedDB images and deletes only COS rows` with:

```ts
test("deletes COS and browser rows from cards, table rows, and details", () => {
  assert.equal(source.includes("resolveImageRefs"), true);
  assert.equal(source.includes("deleteContentItem"), true);
  assert.equal(source.includes("deleteLegacyContentItem"), true);
  assert.equal(source.includes("deleteImageRef"), true);
  assert.equal(source.includes("window.localStorage.setItem(LEGACY_FINISHED_CONTENT_STORAGE_KEY"), true);
  assert.equal(source.includes('item.source === "cos" ? <Button variant="danger"'), false);
  assert.equal(source.match(/void removeItem\(/g)?.length, 3);
  assert.equal(source.includes('title="删除内容"'), true);
  assert.equal(source.includes("浏览器旧内容"), true);
});
```

Update the first contract test so it no longer forbids the one intentional legacy deletion write:

```ts
assert.equal(source.includes("window.localStorage.setItem(FINISHED_CONTENT_STORAGE_KEY"), false);
assert.equal(source.includes("localStorage.removeItem"), false);
assert.equal(source.includes("localStorage.clear"), false);
```

- [ ] **Step 2: Run the page contract and verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/content-library-contract.test.ts
```

Expected: FAIL because browser deletion imports, table/detail actions, and the legacy `localStorage` update do not exist.

- [ ] **Step 3: Import the two browser deletion functions**

In `app/content-library/page.tsx`, add `deleteLegacyContentItem` to the `library-items` import and add `deleteImageRef` to the `image-store` import:

```ts
import {
  LEGACY_FINISHED_CONTENT_STORAGE_KEY,
  cloudContentItem,
  deleteLegacyContentItem,
  editableContentDraft,
  legacyContentDraft,
  mergeContentLibraryItems,
  parseLegacyContentItems,
  type ContentLibraryItem
} from "@/lib/content-storage/library-items";
import { deleteImageRef, imageRefToUploadUrl, isStoredImageRef, resolveImageRefs } from "@/lib/utils/image-store";
```

- [ ] **Step 4: Replace `removeItem` with a source-aware permanent deletion flow**

Use this implementation:

```ts
async function removeItem(item: ContentLibraryItem) {
  const storedData = item.source === "cos"
    ? "COS 中的文字和图片"
    : "浏览器中的旧记录和本地图片";
  if (!window.confirm(`确定删除“${item.title}”吗？${storedData}会一起删除，且无法恢复。`)) return;
  setDeletingId(item.id);
  setNotice("");
  try {
    if (item.source === "cos") {
      await deleteContentItem(item.id);
    } else {
      const deletion = deleteLegacyContentItem(
        window.localStorage.getItem(LEGACY_FINISHED_CONTENT_STORAGE_KEY),
        item.id
      );
      window.localStorage.setItem(LEGACY_FINISHED_CONTENT_STORAGE_KEY, deletion.serialized);
      await Promise.allSettled(deletion.imageRefs.map((url) => deleteImageRef(url)));
      setResolvedBrowserImages((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setSelected((current) => current?.id === item.id ? null : current);
    setEditingItem((current) => current?.id === item.id ? null : current);
    setSelectedIds((current) => current.filter((id) => id !== item.id));
    setPublishPlatformMap((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id)));
    setPublishAccountMap((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id)));
    setNotice("内容已删除");
  } catch (deleteError) {
    setNotice(deleteError instanceof Error ? deleteError.message : "删除失败");
  } finally {
    setDeletingId("");
  }
}
```

- [ ] **Step 5: Expose and disable the three delete actions**

Make the card action unconditional:

```tsx
<Button
  variant="danger"
  icon={<Trash2 className="h-4 w-4" />}
  onClick={() => void removeItem(item)}
  disabled={deletingId === item.id}
>
  {deletingId === item.id ? "删除中…" : "删除"}
</Button>
```

Add the table action:

```tsx
<IconAction
  title="删除内容"
  icon={<Trash2 className="h-4 w-4" />}
  onClick={() => void removeItem(item)}
  disabled={deletingId === item.id}
/>
```

Add the detail action before “关闭”:

```tsx
<Button
  variant="danger"
  icon={<Trash2 className="h-4 w-4" />}
  onClick={() => void removeItem(selected)}
  disabled={deletingId === selected.id}
>
  {deletingId === selected.id ? "删除中…" : "删除"}
</Button>
```

Extend `IconAction` so its delete action can be disabled:

```tsx
function IconAction({
  title,
  icon,
  onClick,
  disabled = false
}: {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    disabled={disabled}
    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-muted transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
  >{icon}</button>;
}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/content-library-contract.test.ts tests/content-storage-library-items.test.ts tests/content-storage-service.test.ts tests/content-storage-routes.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit the page behavior**

```powershell
git add -- app/content-library/page.tsx tests/content-library-contract.test.ts
git diff --cached --check
git commit -m "feat: delete every content library item"
```

### Task 3: Verify and publish the complete feature

**Files:**
- Verify only: all tracked files in the feature branch

- [ ] **Step 1: Run the complete test suite with the correct Windows PowerShell module path**

```powershell
$env:PSModulePath='C:\Program Files\WindowsPowerShell\Modules;C:\WINDOWS\system32\WindowsPowerShell\v1.0\Modules'
npm.cmd test
```

Expected: 0 failed tests.

- [ ] **Step 2: Run the production build**

```powershell
npm.cmd run build
```

Expected: exit code 0 and `/content-library` plus the content-storage routes in the route table.

- [ ] **Step 3: Verify the final patch**

```powershell
git status --short
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: only the design, plan, deletion helper, content-library page, and corresponding tests differ from `origin/main`; `git diff --check` prints no errors.

- [ ] **Step 4: Push the verified commit chain to GitHub main**

```powershell
git fetch origin main
git rebase origin/main
git push origin HEAD:main
git ls-remote origin refs/heads/main
```

Expected: the remote `main` SHA equals local `HEAD`.

- [ ] **Step 5: Monitor the Zeabur check to completion**

```powershell
gh api repos/zxc9802/xhstw/commits/HEAD/check-runs --jq '.check_runs[] | {name, status, conclusion, details_url}'
```

Expected: the `Zeabur` check reports `status: completed` and `conclusion: success`.
