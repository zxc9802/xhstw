"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, ImagePlus, Trash2, Type, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  clearLibrary2Body,
  deleteLibrary2Image,
  deleteLibrary2Item,
  library2MediaUrl,
  listLibrary2Items,
  saveLibrary2Item
} from "@/lib/content-library-2/client";
import { buildLibrary2GenerationHref } from "@/lib/content-library-2/generation";
import { CONTENT_IMAGE_TYPES } from "@/lib/content-storage/contracts";
import { LIBRARY2_PLATFORMS, type Library2Item, type Library2Platform } from "@/lib/content-library-2/contracts";
import { cn } from "@/lib/utils/cn";

function dateText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export default function ContentLibrary2Page() {
  const [items, setItems] = useState<Library2Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [platform, setPlatform] = useState<Library2Platform>("小红书");
  const [sourceUrl, setSourceUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [filter, setFilter] = useState("全部平台");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await listLibrary2Items());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "爆款选题库2加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visibleItems = useMemo(
    () => items.filter((item) => filter === "全部平台" || item.platform === filter),
    [filter, items]
  );

  function replaceItem(next: Library2Item) {
    setItems((current) => current.map((item) => item.id === next.id ? next : item));
  }

  async function uploadLocal() {
    setBusyKey("upload");
    setNotice("");
    try {
      if (!files.length && !title.trim() && !body.trim()) throw new Error("请至少填写文案或选择图片");
      const saved = await saveLibrary2Item({ title, body, platform, sourceUrl }, files);
      setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setTitle("");
      setBody("");
      setSourceUrl("");
      setFiles([]);
      setNotice("已保存到爆款选题库2");
    } catch (uploadError) {
      setNotice(uploadError instanceof Error ? uploadError.message : "上传失败");
    } finally {
      setBusyKey("");
    }
  }

  async function removeImage(item: Library2Item, fileId: string) {
    if (!window.confirm("确定删除这张图片吗？文案和其他图片会保留。")) return;
    setBusyKey(`${item.id}:${fileId}`);
    setNotice("");
    try {
      replaceItem(await deleteLibrary2Image(item.id, fileId));
      setNotice("已删除这张图片");
    } catch (deleteError) {
      setNotice(deleteError instanceof Error ? deleteError.message : "删除图片失败");
    } finally {
      setBusyKey("");
    }
  }

  async function removeBody(item: Library2Item) {
    if (!item.body) return;
    if (!window.confirm("确定删除这条文案吗？图片会保留。")) return;
    setBusyKey(`${item.id}:body`);
    setNotice("");
    try {
      replaceItem(await clearLibrary2Body(item.id));
      setNotice("已删除文案");
    } catch (deleteError) {
      setNotice(deleteError instanceof Error ? deleteError.message : "删除文案失败");
    } finally {
      setBusyKey("");
    }
  }

  async function removeItem(item: Library2Item) {
    if (!window.confirm(`确定删除整条“${item.title}”吗？图片和文案会一起删除。`)) return;
    setBusyKey(item.id);
    setNotice("");
    try {
      await deleteLibrary2Item(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setNotice("整条图文已删除");
    } catch (deleteError) {
      setNotice(deleteError instanceof Error ? deleteError.message : "删除失败");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="爆款选题库2"
        description="插件抓到的图文先保存在本机 outputs/content-storage。每条都可以像选题库一样点「爆款裂变」，把标题、正文和图片带进图文生产做仿写。"
      />

      <Card>
        <CardHeader title="本页补传" subtitle="没有打开平台页时，也可以在这里直接放入图片和文案。" />
        <CardBody className="grid gap-3 md:grid-cols-2">
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题" className="h-10 rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" />
          <select value={platform} onChange={(event) => setPlatform(event.target.value as Library2Platform)} className="h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300">
            {LIBRARY2_PLATFORMS.map((option) => <option key={option}>{option}</option>)}
          </select>
          <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="来源链接（可选）" className="h-10 rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300 md:col-span-2" />
          <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="文案" rows={5} className="rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-orange-300 md:col-span-2" />
          <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line text-sm text-muted hover:border-orange-300 hover:text-orange-700">
            <ImagePlus className="h-4 w-4" />
            {files.length ? `已选 ${files.length} 张图` : "选择图片"}
            <input
              type="file"
              accept={[...CONTENT_IMAGE_TYPES.keys()].join(",")}
              multiple
              className="hidden"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          <Button variant="primary" icon={<Upload className="h-4 w-4" />} disabled={busyKey === "upload"} onClick={() => void uploadLocal()}>
            {busyKey === "upload" ? "上传中…" : "保存到爆款选题库2"}
          </Button>
        </CardBody>
      </Card>

      {notice ? <p className={cn("rounded-lg border px-4 py-3 text-sm", notice.includes("失败") ? "border-red-200 bg-red-50 text-red-700" : "border-orange-100 bg-orange-50 text-orange-800")}>{notice}</p> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700"><p>{error}</p><Button className="mt-3" onClick={() => void reload()}>重新加载</Button></div> : null}

      <Card>
        <CardHeader
          title={`已收录 ${visibleItems.length} 条`}
          subtitle="内容库1不会出现这些条目。点爆款裂变会进入图文生产，删除图片或文案只影响当前这一条。"
          action={
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className="h-9 rounded-md border border-line bg-white px-2 text-sm">
              {["全部平台", ...LIBRARY2_PLATFORMS].map((option) => <option key={option}>{option}</option>)}
            </select>
          }
        />
        <CardBody>
          {loading ? (
            <div className="grid h-48 place-items-center text-sm text-muted">正在读取爆款选题库2…</div>
          ) : !visibleItems.length ? (
            <div className="grid h-64 place-items-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-muted">
              <div className="max-w-md text-center leading-6">
                还没有手动上传的图文。打开小红书、抖音或 TikTok 的图文详情，点页面底部的「上传到爆款选题库2」。请先在本中台保持登录，插件才会取得上传授权。
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleItems.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-lg border border-line bg-white">
                  <div className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted">{item.platform} · {dateText(item.updatedAt)}</p>
                        <h3 className="mt-1 text-base font-semibold leading-6 text-ink">{item.title}</h3>
                      </div>
                      <span className="shrink-0 rounded-full bg-orange-50 px-2 py-1 text-[11px] text-orange-700">爆款选题库2</span>
                    </div>
                    {item.sourceUrl ? (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-orange-700 hover:underline">
                        <ExternalLink className="h-3.5 w-3.5" />
                        打开原页
                      </a>
                    ) : null}
                    <div className="rounded-md border border-line bg-slate-50 p-3">
                      {item.body
                        ? <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-ink">{item.body}</p>
                        : <p className="text-xs text-muted">文案已删除</p>}
                      <div className="mt-3 flex justify-end">
                        <Button variant="danger" icon={<Type className="h-4 w-4" />} disabled={!item.body || busyKey === `${item.id}:body`} onClick={() => void removeBody(item)}>
                          删除文案
                        </Button>
                      </div>
                    </div>
                  </div>
                  {item.images.length ? (
                    <div className="grid grid-cols-3 gap-1 border-t border-line bg-slate-50 p-2">
                      {item.images.map((image, index) => {
                        const url = library2MediaUrl(item.id, image.fileId);
                        return (
                          <div key={image.fileId} className="relative overflow-hidden rounded-md bg-white">
                            <button type="button" onClick={() => setPreviewUrl(url)} className="block w-full">
                              <img src={url} alt={`${item.title} ${index + 1}`} className="aspect-[3/4] w-full object-cover" />
                            </button>
                            <button
                              type="button"
                              title="删除图片"
                              disabled={busyKey === `${item.id}:${image.fileId}`}
                              onClick={() => void removeImage(item, image.fileId)}
                              className="absolute right-1 top-1 rounded bg-white/95 px-1.5 py-1 text-[11px] text-red-700 shadow-sm ring-1 ring-red-100"
                            >
                              删除图片
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="border-t border-line bg-slate-50 px-4 py-6 text-center text-xs text-muted">图片已全部删除</div>
                  )}
                  <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
                    <Link
                      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-orange-500 px-3 text-sm font-medium text-white shadow-sm transition hover:bg-orange-600"
                      href={buildLibrary2GenerationHref(item)}
                    >
                      爆款裂变
                    </Link>
                    <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} disabled={busyKey === item.id} onClick={() => void removeItem(item)}>
                      {busyKey === item.id ? "删除中…" : "删除整条"}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {previewUrl ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/70 p-6" onClick={() => setPreviewUrl("")}>
          <img src={previewUrl} alt="预览" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      ) : null}
    </div>
  );
}
