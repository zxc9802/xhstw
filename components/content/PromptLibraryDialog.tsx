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
          <div>
            <h2 className="text-base font-semibold text-ink">提示词库 · 填入 P{targetPage}</h2>
            <p className="mt-1 text-sm text-muted">保存在当前浏览器，可供所有 P 页面共用。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-slate-100">关闭</button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <span className="sr-only">搜索名称或提示词内容</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称或提示词内容"
                className="h-9 w-full rounded-md border border-line pl-9 pr-3 text-sm outline-none focus:border-orange-300"
              />
            </label>
            <Button type="button" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={startCreate}>新增提示词</Button>
          </div>

          {formOpen ? (
            <div className="space-y-3 rounded-lg border border-orange-200 bg-orange-50/50 p-4">
              <label className="block text-sm font-medium text-ink">
                名称（选填）
                <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-9 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300" />
              </label>
              <label className="block text-sm font-medium text-ink">
                提示词内容
                <textarea
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setError("");
                  }}
                  className="mt-2 min-h-32 w-full rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300"
                />
              </label>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={resetForm}>取消</Button>
                <Button type="button" variant="primary" onClick={saveItem}>{editingId ? "保存修改" : "保存提示词"}</Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            {visibleItems.map((item) => (
              <article key={item.id} className="rounded-lg border border-line p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-medium text-ink">{item.name || "未命名提示词"}</h3>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted">{item.content}</p>
                  </div>
                  <button type="button" title="删除" aria-label="删除" onClick={() => removeItem(item)} className="shrink-0 rounded-md p-2 text-muted hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" onClick={() => startEdit(item)}>编辑</Button>
                  <Button type="button" variant="success" onClick={() => onUse(item)}>使用</Button>
                </div>
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
