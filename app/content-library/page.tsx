"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, ExternalLink, Eye, ImageIcon, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { deleteContentItem, listContentItems } from "@/lib/content-storage/client";
import {
  LEGACY_FINISHED_CONTENT_STORAGE_KEY,
  cloudContentItem,
  mergeContentLibraryItems,
  parseLegacyContentItems,
  type ContentLibraryItem
} from "@/lib/content-storage/library-items";
import {
  directoryPickerFailure,
  imageExtension,
  safeFileName,
  utf8TextBlob,
  writeBlobFiles,
  type BlobFile,
  type WritableDirectoryLike
} from "@/lib/utils/browser-file-export";
import { isStoredImageRef, resolveImageRefs } from "@/lib/utils/image-store";

function dateText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function statusClass(status: string) {
  if (status === "可发布") return "bg-emerald-50 text-emerald-700";
  if (status === "需复查") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

async function imageExportFiles(item: ContentLibraryItem, urls: string[]): Promise<BlobFile[]> {
  if (item.mediaKind !== "image") return [];
  const files: BlobFile[] = [];
  for (const [index, url] of urls.entries()) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`第 ${index + 1} 张图片读取失败`);
    const blob = await response.blob();
    files.push({ name: `${String(index + 1).padStart(2, "0")}.${imageExtension(blob)}`, blob });
  }
  return files;
}

function downloadFallback(item: ContentLibraryItem, files: BlobFile[]) {
  for (const file of files) {
    const url = URL.createObjectURL(file.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(item.title)}_${file.name}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}

export default function ContentLibraryPage() {
  const [items, setItems] = useState<ContentLibraryItem[]>([]);
  const [resolvedBrowserImages, setResolvedBrowserImages] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<ContentLibraryItem | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [exportingId, setExportingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    let browserItems: ContentLibraryItem[] = [];
    let browserNotice = "";
    try {
      const raw = window.localStorage.getItem(LEGACY_FINISHED_CONTENT_STORAGE_KEY);
      browserItems = parseLegacyContentItems(raw);
      if (raw && raw.trim() !== "[]" && !browserItems.length) browserNotice = "浏览器旧内容格式无法读取";
    } catch {
      browserNotice = "浏览器旧内容读取失败";
    }

    const resolvedRows = await Promise.all(browserItems.map(async (item) => {
      const resolved = await resolveImageRefs(item.imageUrls).catch(() => item.imageUrls.filter((url) => !isStoredImageRef(url)));
      return [item.id, resolved] as const;
    }));
    setResolvedBrowserImages(Object.fromEntries(resolvedRows));

    let cloudItems: ContentLibraryItem[] = [];
    try {
      cloudItems = (await listContentItems()).map(cloudContentItem);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "云端内容加载失败");
    } finally {
      setItems(mergeContentLibraryItems(cloudItems, browserItems));
      if (browserNotice) setNotice(browserNotice);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => () => {
    Object.values(resolvedBrowserImages).flat().forEach((url) => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    });
  }, [resolvedBrowserImages]);

  const visibleItems = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => [item.title, item.body, item.account, ...item.tags].some((value) => value.toLowerCase().includes(query)));
  }, [items, keyword]);

  const displayImageUrls = (item: ContentLibraryItem) => item.source === "browser"
    ? resolvedBrowserImages[item.id] ?? item.imageUrls.filter((url) => !isStoredImageRef(url))
    : item.imageUrls;

  async function copyContent(item: ContentLibraryItem) {
    await navigator.clipboard.writeText(`标题：${item.title}\n\n文案：\n${item.body}`);
    setNotice("标题和文案已复制");
  }

  async function chooseLocalExportFolder(item: ContentLibraryItem) {
    setExportingId(item.id);
    setNotice("");
    try {
      const files: BlobFile[] = [
        {
          name: "标题和文案.txt",
          blob: utf8TextBlob(`标题：${item.title}\n\n文案：\n${item.body}`)
        },
        ...(await imageExportFiles(item, displayImageUrls(item)))
      ];
      const pickerWindow = window as Window & { showDirectoryPicker?: () => Promise<WritableDirectoryLike> };
      if (!pickerWindow.showDirectoryPicker) {
        downloadFallback(item, files);
        setNotice("已开始下载");
        return;
      }
      const root = await pickerWindow.showDirectoryPicker();
      const directory = root.getDirectoryHandle
        ? await root.getDirectoryHandle(safeFileName(item.title), { create: true })
        : root;
      const result = await writeBlobFiles(directory, files);
      if (result.failed) throw new Error(result.errors.join("；"));
      setNotice(`已导出 ${result.saved} 个文件到本地`);
    } catch (exportError) {
      const failure = directoryPickerFailure(exportError);
      if (failure !== "cancelled") setNotice(exportError instanceof Error ? exportError.message : "导出失败");
    } finally {
      setExportingId("");
    }
  }

  async function removeItem(item: ContentLibraryItem) {
    if (item.source !== "cos") return;
    if (!window.confirm(`确定删除“${item.title}”吗？COS 中的文字和图片会一起删除。`)) return;
    setDeletingId(item.id);
    setNotice("");
    try {
      await deleteContentItem(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      if (selected?.id === item.id) setSelected(null);
      setNotice("内容已删除");
    } catch (deleteError) {
      setNotice(deleteError instanceof Error ? deleteError.message : "删除失败");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="内容库"
        description="同时显示当前浏览器的旧内容和当前登录成员保存到腾讯云 COS 的内容；新增内容只存 COS。"
        action={
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => void reload()} disabled={loading}>
            刷新
          </Button>
        }
      />

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索标题、文案、账号或标签"
            className="h-10 w-full max-w-md rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300"
          />
          <div className="text-sm text-muted">共 {visibleItems.length} 条内容</div>
        </CardBody>
      </Card>

      {notice ? <div className="rounded-md border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-800">{notice}</div> : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          <p>{error}</p>
          <Button className="mt-3" onClick={() => void reload()}>重新加载</Button>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-line bg-white p-10 text-center text-sm text-muted">正在读取内容库…</div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white p-12 text-center">
          <ImageIcon className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 font-medium text-ink">还没有保存的内容</p>
          <p className="mt-1 text-sm text-muted">在内容生产页确认成品后，它会出现在这里。</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => {
            const images = displayImageUrls(item);
            return (
              <Card key={item.id} className="overflow-hidden">
                <button
                  type="button"
                  className="relative block aspect-[16/10] w-full overflow-hidden bg-slate-100 text-left"
                  onClick={() => images[0] ? setPreviewImageUrl(images[0]) : setSelected(item)}
                >
                  {images[0] ? (
                    <img src={images[0]} alt={item.title} className="h-full w-full object-cover transition hover:scale-[1.02]" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted">{item.mediaKind === "video" ? "视频内容" : "纯文字内容"}</div>
                  )}
                </button>
                <CardBody className="space-y-4">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="line-clamp-2 font-semibold text-ink">{item.title || "未命名内容"}</h2>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`rounded-full px-2.5 py-1 text-xs ${statusClass(item.status)}`}>{item.status}</span>
                        {item.source === "browser" ? <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700">浏览器旧内容</span> : null}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{item.summary || item.body}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span>{item.account || "未指定账号"}</span>
                    <span>{item.mediaKind === "image" ? `${images.length} 张图` : `${item.videoUrls.length} 个视频`}</span>
                    <span>{dateText(item.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                    <Button icon={<Eye className="h-4 w-4" />} onClick={() => setSelected(item)}>详情</Button>
                    <Button icon={<Download className="h-4 w-4" />} onClick={() => void chooseLocalExportFolder(item)} disabled={exportingId === item.id}>
                      {exportingId === item.id ? "导出中…" : "导出到本地"}
                    </Button>
                    {item.source === "cos" ? (
                      <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => void removeItem(item)} disabled={deletingId === item.id}>
                        删除
                      </Button>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={() => setSelected(null)}>
          <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-5 py-4">
              <h2 className="font-semibold text-ink">内容详情</h2>
              <button type="button" onClick={() => setSelected(null)} className="rounded p-1 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-5 p-5">
              <div>
                <h3 className="text-xl font-semibold text-ink">{selected.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{selected.body}</p>
              </div>
              {displayImageUrls(selected).length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {displayImageUrls(selected).map((url) => (
                    <button key={url} type="button" onClick={() => setPreviewImageUrl(url)} className="overflow-hidden rounded-lg bg-slate-100">
                      <img src={url} alt={selected.title} className="aspect-square h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
              {selected.videoUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-blue-700 hover:bg-blue-50">
                  <ExternalLink className="h-4 w-4" />打开视频
                </a>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button icon={<Copy className="h-4 w-4" />} onClick={() => void copyContent(selected)}>复制标题和文案</Button>
                <Button icon={<Download className="h-4 w-4" />} onClick={() => void chooseLocalExportFolder(selected)}>导出到本地</Button>
                {selected.source === "cos" ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => void removeItem(selected)}>删除云端内容</Button> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {previewImageUrl ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreviewImageUrl("")}>
          <button type="button" aria-label="关闭预览" className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X className="h-6 w-6" /></button>
          <img src={previewImageUrl} alt="图片预览" className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  );
}
