# P Page Prompt Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-local, searchable prompt library that every image-generation P page can open and use to replace that page's prompt.

**Architecture:** Keep prompt-library validation and collection operations in a small pure utility module, render management UI in a dedicated controlled dialog, and let `app/content/page.tsx` own persistence plus the target P-page assignment. Reuse the repository's versioned local-state helpers and existing feedback area so no backend or account synchronization is introduced.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Node test runner through `tsx`.

---

## File map

- Create `lib/utils/prompt-library.ts`: prompt item types, validation, search, CRUD, and stored-data sanitization.
- Create `tests/prompt-library.test.ts`: behavior tests for every exported prompt-library utility.
- Create `components/content/PromptLibraryDialog.tsx`: centered search and CRUD dialog.
- Modify `tests/content-production-contract.test.ts`: source contracts for the dialog and P-page wiring.
- Modify `app/content/page.tsx`: browser persistence, current P target, entry button, replacement confirmation, and dialog mounting.

### Task 1: Prompt-library data model and pure operations

**Files:**
- Create: `tests/prompt-library.test.ts`
- Create: `lib/utils/prompt-library.ts`

- [ ] **Step 1: Write the failing utility tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  createPromptLibraryItem,
  deletePromptLibraryItem,
  normalizePromptLibraryInput,
  sanitizePromptLibraryItems,
  searchPromptLibrary,
  updatePromptLibraryItem
} from "../lib/utils/prompt-library";

test("prompt input accepts an empty name but requires nonblank content", () => {
  assert.deepEqual(normalizePromptLibraryInput("  ", "  真实产品摄影  "), {
    name: "",
    content: "真实产品摄影"
  });
  assert.equal(normalizePromptLibraryInput("封面", "   "), null);
});

test("prompt search matches trimmed keywords against name and content without English case sensitivity", () => {
  const items = [
    createPromptLibraryItem({ name: "Hero Shot", content: "白色背景产品图" }, "one", "2026-09-01T00:00:00.000Z"),
    createPromptLibraryItem({ name: "详情页", content: "Close-up of the bottle" }, "two", "2026-09-01T00:01:00.000Z")
  ];

  assert.deepEqual(searchPromptLibrary(items, "  hero ").map((item) => item.id), ["one"]);
  assert.deepEqual(searchPromptLibrary(items, " close-UP ").map((item) => item.id), ["two"]);
  assert.deepEqual(searchPromptLibrary(items, "  "), items);
});

test("prompt items can be created, edited, and deleted without changing their creation time", () => {
  const created = createPromptLibraryItem({ name: "封面", content: "旧提示词" }, "one", "2026-09-01T00:00:00.000Z");
  const updated = updatePromptLibraryItem([created], "one", { name: "", content: "新提示词" }, "2026-09-01T00:02:00.000Z");

  assert.deepEqual(updated[0], {
    id: "one",
    name: "",
    content: "新提示词",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:02:00.000Z"
  });
  assert.deepEqual(deletePromptLibraryItem(updated, "one"), []);
});

test("stored prompt data keeps only valid complete items", () => {
  assert.deepEqual(sanitizePromptLibraryItems([
    { id: "one", name: "", content: "保留", createdAt: "a", updatedAt: "b" },
    { id: "two", name: "坏数据", content: "", createdAt: "a", updatedAt: "b" },
    null
  ]), [
    { id: "one", name: "", content: "保留", createdAt: "a", updatedAt: "b" }
  ]);
  assert.deepEqual(sanitizePromptLibraryItems({}), []);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd exec -- tsx --test tests/prompt-library.test.ts`

Expected: FAIL because `lib/utils/prompt-library.ts` does not exist.

- [ ] **Step 3: Add the minimal pure implementation**

```ts
export type PromptLibraryItem = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptLibraryInput = Pick<PromptLibraryItem, "name" | "content">;

export function normalizePromptLibraryInput(name: string, content: string): PromptLibraryInput | null {
  const normalizedContent = content.trim();
  if (!normalizedContent) return null;
  return { name: name.trim(), content: normalizedContent };
}

export function createPromptLibraryItem(input: PromptLibraryInput, id: string, now: string): PromptLibraryItem {
  return { id, ...input, createdAt: now, updatedAt: now };
}

export function updatePromptLibraryItem(
  items: PromptLibraryItem[],
  id: string,
  input: PromptLibraryInput,
  now: string
) {
  return items.map((item) => item.id === id ? { ...item, ...input, updatedAt: now } : item);
}

export function deletePromptLibraryItem(items: PromptLibraryItem[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function searchPromptLibrary(items: PromptLibraryItem[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((item) => `${item.name}\n${item.content}`.toLocaleLowerCase().includes(normalizedQuery));
}

export function sanitizePromptLibraryItems(value: unknown): PromptLibraryItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PromptLibraryItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<PromptLibraryItem>;
    return typeof candidate.id === "string"
      && typeof candidate.name === "string"
      && typeof candidate.content === "string"
      && Boolean(candidate.content.trim())
      && typeof candidate.createdAt === "string"
      && typeof candidate.updatedAt === "string";
  });
}
```

- [ ] **Step 4: Run the utility tests and verify GREEN**

Run: `npm.cmd exec -- tsx --test tests/prompt-library.test.ts`

Expected: 4 tests pass, 0 fail.

- [ ] **Step 5: Commit the utility slice**

```powershell
git add -- lib/utils/prompt-library.ts tests/prompt-library.test.ts
git diff --cached --check
git commit -m "feat: add prompt library data operations"
```

### Task 2: Centered prompt-library dialog

**Files:**
- Modify: `tests/content-production-contract.test.ts`
- Create: `components/content/PromptLibraryDialog.tsx`

- [ ] **Step 1: Add a failing dialog contract test**

Add `existsSync` to the existing `node:fs` import, load the component conditionally, and add this test so a missing file produces assertion failures rather than a module-load error:

```ts
import { existsSync, readFileSync } from "node:fs";

const promptLibraryDialogPath = "components/content/PromptLibraryDialog.tsx";
const promptLibraryDialogSource = existsSync(promptLibraryDialogPath)
  ? readFileSync(promptLibraryDialogPath, "utf8")
  : "";

test("prompt library dialog provides search and complete local CRUD controls", () => {
  assert.equal(promptLibraryDialogSource.includes("提示词库 · 填入 P"), true);
  assert.equal(promptLibraryDialogSource.includes("搜索名称或提示词内容"), true);
  assert.equal(promptLibraryDialogSource.includes("名称（选填）"), true);
  assert.equal(promptLibraryDialogSource.includes("提示词内容"), true);
  assert.equal(promptLibraryDialogSource.includes("未命名提示词"), true);
  assert.equal(promptLibraryDialogSource.includes("window.confirm"), true);
  assert.equal(promptLibraryDialogSource.includes("使用"), true);
  assert.equal(promptLibraryDialogSource.includes("编辑"), true);
  assert.equal(promptLibraryDialogSource.includes("删除"), true);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm.cmd exec -- tsx --test tests/content-production-contract.test.ts`

Expected: the new dialog contract fails because the component source is absent.

- [ ] **Step 3: Create the controlled dialog component**

Implement `PromptLibraryDialog` with this public interface and behavior:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  createPromptLibraryItem,
  deletePromptLibraryItem,
  normalizePromptLibraryInput,
  searchPromptLibrary,
  updatePromptLibraryItem,
  type PromptLibraryItem
} from "@/lib/utils/prompt-library";

type PromptLibraryDialogProps = {
  open: boolean;
  targetPage: number | null;
  items: PromptLibraryItem[];
  onClose: () => void;
  onItemsChange: (items: PromptLibraryItem[]) => void;
  onUse: (item: PromptLibraryItem) => void;
};

export function PromptLibraryDialog({ open, targetPage, items, onClose, onItemsChange, onUse }: PromptLibraryDialogProps) {
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const visibleItems = useMemo(() => searchPromptLibrary(items, query), [items, query]);

  const resetForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setName("");
    setContent("");
    setError("");
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    resetForm();
  }, [open, targetPage]);

  if (!open || targetPage === null) return null;

  const startCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const startEdit = (item: PromptLibraryItem) => {
    setFormOpen(true);
    setEditingId(item.id);
    setName(item.name);
    setContent(item.content);
    setError("");
  };

  const saveItem = () => {
    const input = normalizePromptLibraryInput(name, content);
    if (!input) {
      setError("请输入提示词内容");
      return;
    }
    const now = new Date().toISOString();
    const nextItems = editingId
      ? updatePromptLibraryItem(items, editingId, input, now)
      : [createPromptLibraryItem(input, crypto.randomUUID(), now), ...items];
    onItemsChange(nextItems);
    resetForm();
  };

  const removeItem = (item: PromptLibraryItem) => {
    if (!window.confirm(`确认删除“${item.name || "未命名提示词"}”吗？`)) return;
    onItemsChange(deletePromptLibraryItem(items, item.id));
    if (editingId === item.id) resetForm();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={`提示词库 · 填入 P${targetPage}`}>
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div><h2 className="text-base font-semibold text-ink">提示词库 · 填入 P{targetPage}</h2><p className="mt-1 text-sm text-muted">保存在当前浏览器，可供所有 P 页面共用。</p></div>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-slate-100">关闭</button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><span className="sr-only">搜索名称或提示词内容</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或提示词内容" className="h-9 w-full rounded-md border border-line pl-9 pr-3 text-sm outline-none focus:border-orange-300" /></label>
            <Button type="button" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={startCreate}>新增提示词</Button>
          </div>
          {formOpen ? (
            <div className="space-y-3 rounded-lg border border-orange-200 bg-orange-50/50 p-4">
              <label className="block text-sm font-medium text-ink">名称（选填）<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-9 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300" /></label>
              <label className="block text-sm font-medium text-ink">提示词内容<textarea value={content} onChange={(event) => { setContent(event.target.value); setError(""); }} className="mt-2 min-h-32 w-full rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></label>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex justify-end gap-2"><Button type="button" onClick={resetForm}>取消</Button><Button type="button" variant="primary" onClick={saveItem}>{editingId ? "保存修改" : "保存提示词"}</Button></div>
            </div>
          ) : null}
          <div className="space-y-3">
            {visibleItems.map((item) => (
              <article key={item.id} className="rounded-lg border border-line p-4">
                <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="font-medium text-ink">{item.name || "未命名提示词"}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{item.content}</p></div><button type="button" title="删除" aria-label="删除" onClick={() => removeItem(item)} className="shrink-0 rounded-md p-2 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></div>
                <div className="mt-3 flex justify-end gap-2"><Button type="button" onClick={() => startEdit(item)}>编辑</Button><Button type="button" variant="success" onClick={() => onUse(item)}>使用</Button></div>
              </article>
            ))}
            {!items.length ? <div className="rounded-lg border border-dashed border-line py-12 text-center text-sm text-muted">还没有保存的提示词，点击“新增提示词”开始创建。</div> : null}
            {items.length && !visibleItems.length ? <div className="rounded-lg border border-dashed border-line py-12 text-center text-sm text-muted">没有匹配的提示词。</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the contract and utility tests and verify GREEN**

Run: `npm.cmd exec -- tsx --test tests/content-production-contract.test.ts tests/prompt-library.test.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Commit the dialog slice**

```powershell
git add -- components/content/PromptLibraryDialog.tsx tests/content-production-contract.test.ts
git diff --cached --check
git commit -m "feat: add prompt library dialog"
```

### Task 3: Wire every P page to browser persistence and replacement confirmation

**Files:**
- Modify: `tests/content-production-contract.test.ts`
- Modify: `app/content/page.tsx`

- [ ] **Step 1: Add a failing page-integration contract**

```ts
test("every image P page can open and use the shared browser prompt library", () => {
  assert.equal(source.includes("content-production-studio.prompt-library"), true);
  assert.equal(source.includes("sanitizePromptLibraryItems"), true);
  assert.equal(source.includes("<PromptLibraryDialog"), true);
  assert.equal(source.includes("setPromptLibraryTargetPage(item.page)"), true);
  assert.equal(source.includes("提示词库"), true);
  assert.equal(source.includes("if (currentPrompt.trim() && !window.confirm"), true);
  assert.equal(source.includes("[targetPage]: item.content"), true);
  assert.equal(source.includes("提示词库无法写入浏览器本地存储"), true);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm.cmd exec -- tsx --test tests/content-production-contract.test.ts`

Expected: the new P-page integration contract fails because persistence and dialog wiring are absent.

- [ ] **Step 3: Add imports, constants, state, hydration, and persistence**

Add:

```tsx
import { PromptLibraryDialog } from "@/components/content/PromptLibraryDialog";
import { sanitizePromptLibraryItems, type PromptLibraryItem } from "@/lib/utils/prompt-library";

const PROMPT_LIBRARY_STORAGE_KEY = "content-production-studio.prompt-library";
```

Next to the image-plan state add:

```tsx
const [promptLibraryItems, setPromptLibraryItems] = useState<PromptLibraryItem[]>([]);
const [promptLibraryHydrated, setPromptLibraryHydrated] = useState(false);
const [promptLibraryTargetPage, setPromptLibraryTargetPage] = useState<number | null>(null);
```

In the existing initial browser-state effect add:

```tsx
const storedPromptLibrary = loadVersionedState<unknown>(
  window.localStorage,
  PROMPT_LIBRARY_STORAGE_KEY,
  LOCAL_STATE_VERSION,
  []
);
setPromptLibraryItems(sanitizePromptLibraryItems(storedPromptLibrary));
setPromptLibraryHydrated(true);
```

Add a separate persistence effect:

```tsx
useEffect(() => {
  if (!promptLibraryHydrated) return;
  if (!saveVersionedState(window.localStorage, PROMPT_LIBRARY_STORAGE_KEY, LOCAL_STATE_VERSION, promptLibraryItems)) {
    setFeedback("提示词库无法写入浏览器本地存储，请检查浏览器存储空间或隐私设置。");
  }
}, [promptLibraryHydrated, promptLibraryItems]);
```

- [ ] **Step 4: Add target-P replacement behavior and the entry in the mapped P block**

Add the handler before the JSX return:

```tsx
const usePromptLibraryItem = (item: PromptLibraryItem) => {
  const targetPage = promptLibraryTargetPage;
  if (targetPage === null) return;
  const currentPrompt = planPromptMap[targetPage] ?? "";
  if (currentPrompt.trim() && !window.confirm(`P${targetPage} 当前已有提示词，确认替换吗？`)) return;
  setPlanPromptMap((prompts) => ({ ...prompts, [targetPage]: item.content }));
  setPromptLibraryTargetPage(null);
};
```

Replace the current wrapping prompt `<label>` with an explicit label and button so clicking the library button does not focus the textarea:

```tsx
<div>
  <div className="flex items-center justify-between gap-3">
    <label htmlFor={`image-plan-prompt-${item.page}`} className="text-sm font-medium text-ink">提示词</label>
    <Button type="button" className="h-7 px-2.5 text-xs" onClick={() => setPromptLibraryTargetPage(item.page)}>提示词库</Button>
  </div>
  <textarea id={`image-plan-prompt-${item.page}`} value={planPromptMap[item.page] ?? ""} onChange={(event) => setPlanPromptMap((items) => ({ ...items, [item.page]: event.target.value }))} className="mt-2 min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" />
</div>
```

Mount the dialog once near the other page-level dialogs:

```tsx
<PromptLibraryDialog
  open={promptLibraryTargetPage !== null}
  targetPage={promptLibraryTargetPage}
  items={promptLibraryItems}
  onClose={() => setPromptLibraryTargetPage(null)}
  onItemsChange={setPromptLibraryItems}
  onUse={usePromptLibraryItem}
/>
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm.cmd exec -- tsx --test tests/content-production-contract.test.ts tests/prompt-library.test.ts tests/local-state.test.ts`

Expected: all selected tests pass.

- [ ] **Step 6: Run TypeScript production compilation**

Run: `$env:NEXT_DIST_DIR='.next-build-prompt-library'; npm.cmd run build`

Expected: exit code 0 with all routes compiled.

- [ ] **Step 7: Commit the P-page integration slice**

```powershell
git add -- app/content/page.tsx tests/content-production-contract.test.ts
git diff --cached --check
git commit -m "feat: connect prompt library to image pages"
```

### Task 4: Full regression and visual verification

**Files:**
- Verify only; do not modify unrelated files.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm.cmd test`

Expected: 0 failed tests.

- [ ] **Step 2: Run a fresh production build**

Run: `$env:NEXT_DIST_DIR='.next-build-prompt-library-final'; npm.cmd run build`

Expected: exit code 0.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff HEAD~3 --check; git diff HEAD~3 --stat; git status --short`

Expected: no whitespace errors; only the planned source, tests, and documentation are committed. Existing unrelated untracked build/download artifacts remain untouched.

- [ ] **Step 4: Verify the interaction in the browser**

Run the app with `npm.cmd run dev`, open the image-generation step, and verify:

1. P1 and a newly added P2 each show the “提示词库” button.
2. The dialog title reflects the P page that opened it.
3. An unnamed prompt can be saved and found by content search.
4. A named prompt can be found by name search and edited.
5. Deletion asks for confirmation.
6. Using a prompt fills an empty target immediately.
7. Using a prompt on a nonempty target asks before replacement; cancel preserves the old prompt.
8. Refreshing the page preserves the library.

- [ ] **Step 5: Report evidence**

Report focused test counts, full-suite test counts, build exit status, and the browser behaviors observed. Do not claim completion if any check is missing or failing.
