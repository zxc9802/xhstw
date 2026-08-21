"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Edit3, ExternalLink, Eye, FolderOpen, Grid2X2, ImageIcon, ListChecks, Plus, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { deleteContentItem, listContentItems, replaceContentDraft, saveContentDraft } from "@/lib/content-storage/client";
import { CONTENT_IMAGE_MAX_COUNT, CONTENT_IMAGE_TYPES } from "@/lib/content-storage/contracts";
import {
  LEGACY_FINISHED_CONTENT_STORAGE_KEY,
  cloudContentItem,
  editableContentDraft,
  legacyContentDraft,
  mergeContentLibraryItems,
  parseLegacyContentItems,
  type ContentLibraryItem
} from "@/lib/content-storage/library-items";
import { feishuSyncPlatformOptions } from "@/lib/constants/platforms";
import { accounts as productionAccounts } from "@/lib/mock/data";
import {
  directoryPickerFailure,
  imageExtension,
  safeFileName,
  utf8TextBlob,
  writeBlobFiles,
  type BlobFile,
  type WritableDirectoryLike
} from "@/lib/utils/browser-file-export";
import { cn } from "@/lib/utils/cn";
import { imageRefToUploadUrl, isStoredImageRef, resolveImageRefs } from "@/lib/utils/image-store";
import { reorderImageUrls } from "@/lib/utils/production-workflow";

type EditableImage = {
  id: string;
  url: string;
  blob?: Blob;
};

type EditValues = {
  title: string;
  body: string;
  tags: string[];
  images: EditableImage[];
};

type ViewMode = "cards" | "table";
type Filters = {
  platform: string;
  account: string;
  type: string;
  status: string;
  time: string;
  keyword: string;
};

const publishAccounts = productionAccounts.map((account) => ({ platform: account.platform, name: account.name }));

function accountsForPlatform(platform: string) {
  const names = publishAccounts.filter((account) => account.platform === platform).map((account) => account.name);
  return names.length ? names : [`${platform}待添加账号`];
}

function dateText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function isToday(value: string) {
  const date = new Date(value);
  const today = new Date();
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
}

function matchesTimeFilter(value: string, filter: string) {
  if (filter === "全部时间") return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  if (filter === "今天") return isToday(value);
  const days = filter === "近 7 天" ? 7 : 30;
  return date.getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function statusKey(status: string) {
  if (status === "可发布") return "publishable";
  if (status === "已保存本地") return "saved";
  if (status === "需复查") return "rework";
  if (status === "已归档") return "disabled";
  return "rejected";
}

function riskClass(level: ContentLibraryItem["lowFlowRisk"]) {
  if (level === "低") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (level === "中") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-red-50 text-red-700 ring-red-200";
}

function mediaCount(item: ContentLibraryItem, imageUrls: string[]) {
  return item.mediaKind === "image" ? `${imageUrls.length} 张图` : `${item.videoUrls.length} 个视频`;
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
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [filters, setFilters] = useState<Filters>({
    platform: "全部平台",
    account: "全部账号",
    type: "全部类型",
    status: "全部状态",
    time: "全部时间",
    keyword: ""
  });
  const [activeFolder, setActiveFolder] = useState("全部成品");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [publishPlatformMap, setPublishPlatformMap] = useState<Record<string, string>>({});
  const [publishAccountMap, setPublishAccountMap] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<ContentLibraryItem | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [exportingId, setExportingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [savingId, setSavingId] = useState("");
  const [syncingId, setSyncingId] = useState("");
  const [editingItem, setEditingItem] = useState<ContentLibraryItem | null>(null);
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

  const filteredItems = useMemo(() => items.filter((item) => {
    const query = filters.keyword.trim().toLowerCase();
    return (filters.platform === "全部平台" || item.platform === filters.platform)
      && (filters.account === "全部账号" || item.account === filters.account)
      && (filters.type === "全部类型" || item.type === filters.type)
      && (filters.status === "全部状态" || item.status === filters.status)
      && matchesTimeFilter(item.createdAt, filters.time)
      && (!query || [item.id, item.title, item.body, item.account, ...item.tags].some((value) => value.toLowerCase().includes(query)));
  }), [filters, items]);

  const folders = useMemo(() => [
    "全部成品",
    ...new Set(items.map((item) => item.account).filter(Boolean))
  ], [items]);
  const folderItems = useMemo(
    () => filteredItems.filter((item) => activeFolder === "全部成品" || item.account === activeFolder),
    [activeFolder, filteredItems]
  );
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const platformOptions = ["全部平台", ...new Set(items.map((item) => item.platform).filter(Boolean))];
  const accountOptions = ["全部账号", ...new Set(items.map((item) => item.account).filter(Boolean))];
  const typeOptions = ["全部类型", ...new Set(items.map((item) => item.type).filter(Boolean))];
  const statusOptions = ["全部状态", ...new Set(items.map((item) => item.status).filter(Boolean))];
  const stats = [
    ["全部成品", items.length, "bg-blue-50 text-blue-700"],
    ["今日新增", items.filter((item) => isToday(item.createdAt)).length, "bg-orange-50 text-orange-700"],
    ["可发布", items.filter((item) => item.status === "可发布").length, "bg-emerald-50 text-emerald-700"],
    ["已保存本地", items.filter((item) => item.source === "browser").length, "bg-violet-50 text-violet-700"],
    ["需复查", items.filter((item) => item.status === "需复查").length, "bg-red-50 text-red-700"],
    ["已归档", items.filter((item) => item.status === "已归档").length, "bg-slate-100 text-slate-700"]
  ] as const;

  const displayImageUrls = (item: ContentLibraryItem) => item.source === "browser"
    ? resolvedBrowserImages[item.id] ?? item.imageUrls.filter((url) => !isStoredImageRef(url))
    : item.imageUrls;

  const getPublishPlatform = (item: ContentLibraryItem) => publishPlatformMap[item.id]
    ?? (feishuSyncPlatformOptions.includes(item.platform) ? item.platform : "小红书");
  const getPublishAccount = (item: ContentLibraryItem) => {
    const platform = getPublishPlatform(item);
    const options = accountsForPlatform(platform);
    return publishAccountMap[item.id] ?? (options.includes(item.account) ? item.account : options[0]);
  };

  function openEditor(item: ContentLibraryItem) {
    setEditingItem({ ...item, imageUrls: displayImageUrls(item) });
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => {
      if (current) setSelectedIds([]);
      return !current;
    });
  }

  async function copyContent(item: ContentLibraryItem) {
    await navigator.clipboard.writeText(`标题：${item.title}\n\n文案：\n${item.body}`);
    setNotice("标题和文案已复制");
  }

  async function exportItemsToLocal(targets: ContentLibraryItem[], activeId = "batch") {
    setExportingId(activeId);
    setNotice("");
    try {
      const exports = await Promise.all(targets.map(async (item) => ({
        item,
        files: [
          {
            name: "标题和文案.txt",
            blob: utf8TextBlob(`标题：${item.title}\n\n文案：\n${item.body}`)
          },
          ...(await imageExportFiles(item, displayImageUrls(item)))
        ] satisfies BlobFile[]
      })));
      const pickerWindow = window as Window & { showDirectoryPicker?: () => Promise<WritableDirectoryLike> };
      if (!pickerWindow.showDirectoryPicker) {
        exports.forEach(({ item, files }) => downloadFallback(item, files));
        setNotice("已开始下载");
        return;
      }
      const root = await pickerWindow.showDirectoryPicker();
      let saved = 0;
      const errors: string[] = [];
      for (const { item, files } of exports) {
        const directory = root.getDirectoryHandle
          ? await root.getDirectoryHandle(`${safeFileName(item.title)}_${safeFileName(item.id)}`, { create: true })
          : root;
        const result = await writeBlobFiles(directory, files);
        saved += result.saved;
        errors.push(...result.errors);
      }
      if (errors.length) throw new Error(errors.join("；"));
      setNotice(`已导出 ${targets.length} 条成品、${saved} 个文件到本地`);
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

  async function saveEdit(item: ContentLibraryItem, values: EditValues) {
    setSavingId(item.id);
    setNotice("");
    try {
      const images: Blob[] = [];
      for (const [index, image] of values.images.entries()) {
        if (image.blob) {
          images.push(image.blob);
          continue;
        }
        const response = await fetch(image.url);
        if (!response.ok) throw new Error(`第 ${index + 1} 张原图片读取失败`);
        images.push(await response.blob());
      }
      const changes = {
        title: values.title,
        body: values.body,
        tags: values.tags
      };
      const saved = item.source === "cos" && item.manifest
        ? await replaceContentDraft(
          item.id,
          editableContentDraft(item.manifest, changes),
          images
        )
        : await saveContentDraft(
          legacyContentDraft(item, changes),
          images
        );
      const nextItem = cloudContentItem(saved);
      setItems((current) => item.source === "cos"
        ? current.map((candidate) => candidate.id === item.id ? nextItem : candidate)
        : [nextItem, ...current.filter((candidate) => candidate.id !== item.id)]
      );
      setSelected((current) => current?.id === item.id ? nextItem : current);
      setSelectedIds((current) => current.map((id) => id === item.id ? nextItem.id : id));
      setEditingItem(null);
      setNotice(item.source === "browser"
        ? `已迁移到 COS，并保存 ${images.length} 张图片的当前顺序`
        : `已保存修改，${images.length} 张图片的当前顺序已写入 COS`
      );
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "保存修改失败");
    } finally {
      setSavingId("");
    }
  }

  async function syncContentToFeishu(item: ContentLibraryItem, openAfterSync = true) {
    setSyncingId(item.id);
    setNotice(`正在按当前图片顺序同步“${item.title}”…`);
    try {
      const platform = getPublishPlatform(item);
      const accountName = getPublishAccount(item);
      const requestBody = item.source === "cos"
        ? { contentId: item.id, platform, accountName }
        : {
            platform,
            accountName,
            images: (await Promise.all(item.imageUrls.map((url) => imageRefToUploadUrl(url).catch(() => "")))).filter(Boolean),
            title: item.title,
            body: item.body,
            tags: item.tags
          };
      const response = await fetch("/api/feishu/sync-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = await response.json().catch(() => undefined) as {
        ok?: boolean;
        message?: string;
        data?: { baseUrl?: string; warnings?: string[] };
      } | undefined;
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || "飞书同步失败");
      if (openAfterSync && payload.data?.baseUrl) window.open(payload.data.baseUrl, "_blank", "noopener,noreferrer");
      const warnings = payload.data?.warnings?.filter(Boolean) ?? [];
      setNotice(warnings.length ? `已同步到飞书；${warnings.join("；")}` : "已按当前保存的图片顺序同步到飞书");
      return payload.data?.baseUrl ?? "";
    } catch (syncError) {
      setNotice(syncError instanceof Error ? syncError.message : "飞书同步失败");
      if (!openAfterSync) throw syncError;
      return "";
    } finally {
      setSyncingId("");
    }
  }

  async function chooseLocalExportFolder(item: ContentLibraryItem) {
    await exportItemsToLocal([item], item.id);
  }

  async function syncSelectedContentsToFeishu() {
    if (!selectedItems.length) {
      setNotice("请先点击“多选”，再勾选要同步的作品");
      return;
    }
    try {
      let baseUrl = "";
      for (const item of selectedItems) baseUrl = await syncContentToFeishu(item, false);
      if (baseUrl) window.open(baseUrl, "_blank", "noopener,noreferrer");
      setNotice(`已同步 ${selectedItems.length} 条成品到飞书`);
    } catch {
      // The individual sync call already exposes the exact error.
    }
  }

  async function exportSelectedOrVisible() {
    const targets = selectedItems.length ? selectedItems : folderItems;
    if (!targets.length) {
      setNotice("当前没有可导出的成品内容");
      return;
    }
    await exportItemsToLocal(targets);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="成品内容库"
        description="集中管理已通过审核、可发布、已保存本地和已归档的完整内容项目。"
        action={
          <div className="flex flex-wrap gap-2">
            <Button className={viewMode === "cards" ? "bg-orange-50 text-orange-700" : ""} icon={<Grid2X2 className="h-4 w-4" />} onClick={() => setViewMode("cards")}>卡片视图</Button>
            <Button className={viewMode === "table" ? "bg-orange-50 text-orange-700" : ""} icon={<ListChecks className="h-4 w-4" />} onClick={() => setViewMode("table")}>表格视图</Button>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {stats.map(([label, value, className]) => (
          <Card key={label}><CardBody><p className="text-sm text-muted">{label}</p><p className={cn("mt-3 inline-flex rounded-md px-3 py-1 text-2xl font-semibold", className)}>{value}</p></CardBody></Card>
        ))}
      </section>

      <Card>
        <CardHeader title="筛选区" subtitle="按平台、账号、类型、状态和关键词筛选完整作品。" />
        <CardBody className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SelectField value={filters.platform} options={platformOptions} onChange={(value) => setFilters((current) => ({ ...current, platform: value }))} />
          <SelectField value={filters.account} options={accountOptions} onChange={(value) => setFilters((current) => ({ ...current, account: value }))} />
          <SelectField value={filters.type} options={typeOptions} onChange={(value) => setFilters((current) => ({ ...current, type: value }))} />
          <SelectField value={filters.status} options={statusOptions} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} />
          <SelectField value={filters.time} options={["全部时间", "今天", "近 7 天", "近 30 天"]} onChange={(value) => setFilters((current) => ({ ...current, time: value }))} />
          <input value={filters.keyword} onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))} placeholder="搜索标题 / 文案 / 标签 / 账号 / 项目编号" className="h-10 rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" />
          <div className="flex flex-wrap gap-2 xl:col-span-6">
            <Button onClick={() => setFilters({ platform: "全部平台", account: "全部账号", type: "全部类型", status: "全部状态", time: "全部时间", keyword: "" })}>重置</Button>
            <Button variant="primary" onClick={() => setNotice(`已筛选出 ${filteredItems.length} 条成品内容`)}>筛选</Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => void exportSelectedOrVisible()}>批量导出</Button>
          </div>
        </CardBody>
      </Card>

      {notice ? <p className={cn("rounded-lg border px-4 py-3 text-sm", notice.includes("失败") ? "border-red-200 bg-red-50 text-red-700" : "border-orange-100 bg-orange-50 text-orange-800")}>{notice}</p> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700"><p>{error}</p><Button className="mt-3" onClick={() => void reload()}>重新加载</Button></div> : null}

      {loading ? (
        <div className="rounded-lg border border-line bg-white p-10 text-center text-sm text-muted">正在读取内容库…</div>
      ) : (
        <section className="grid min-h-[680px] gap-5 xl:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader title="页面文件夹" subtitle="按账号自动归类查看成品内容。" />
            <CardBody className="space-y-2">
              {folders.map((folder) => {
                const count = folder === "全部成品" ? filteredItems.length : filteredItems.filter((item) => item.account === folder).length;
                return (
                  <div key={folder} className={cn("flex items-center gap-1 rounded-md border px-3 py-2 text-sm transition", activeFolder === folder ? "border-orange-200 bg-orange-50 text-orange-700" : "border-line bg-white text-muted hover:bg-slate-50 hover:text-ink")}>
                    <button type="button" onClick={() => setActiveFolder(folder)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><FolderOpen className="h-4 w-4 shrink-0" /><span className="truncate">{folder}</span></button>
                    <span className="text-xs">{count}</span>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={`${activeFolder} · 成品预览`}
              subtitle="每条作品按标题、文案、标签和真实图片展示。"
              action={
                <div className="flex flex-wrap gap-2">
                  <Button onClick={toggleSelectionMode}>{selectionMode ? "退出多选" : "多选"}</Button>
                  <Button icon={<Send className="h-4 w-4" />} disabled={Boolean(syncingId)} onClick={() => void syncSelectedContentsToFeishu()}>同步到飞书{selectedItems.length ? `（${selectedItems.length}）` : ""}</Button>
                  <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={() => void exportSelectedOrVisible()}>导出到本地文件夹</Button>
                </div>
              }
            />
            <CardBody>
              {!folderItems.length ? (
                <div className="grid h-80 place-items-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-muted"><div className="text-center"><ImageIcon className="mx-auto mb-3 h-8 w-8 text-slate-300" />当前文件夹暂无内容</div></div>
              ) : viewMode === "cards" ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                  {folderItems.map((item) => {
                    const images = displayImageUrls(item);
                    const publishPlatform = getPublishPlatform(item);
                    const publishAccount = getPublishAccount(item);
                    const selectedRow = selectedIds.includes(item.id);
                    return (
                      <article key={item.id} className={cn("relative overflow-hidden rounded-lg border bg-white transition hover:border-orange-200 hover:shadow-sm", selectedRow ? "border-orange-300 ring-2 ring-orange-100" : "border-line")}>
                        {selectionMode ? <label className="absolute left-3 top-3 z-10 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-white/95 shadow-sm ring-1 ring-line"><input type="checkbox" checked={selectedRow} onChange={(event) => toggleSelected(item.id, event.target.checked)} className="h-4 w-4 accent-orange-500" aria-label={`选择 ${item.title}`} /></label> : null}
                        <div className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div><p className="text-xs text-muted">{item.account} · {item.platform}</p><h3 className="mt-1 line-clamp-2 text-base font-semibold leading-6 text-ink">{item.title}</h3></div>
                            <span className={cn("shrink-0 rounded-full px-2 py-1 text-[11px]", item.source === "cos" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700")}>{item.source === "cos" ? "COS" : "浏览器旧内容"}</span>
                          </div>
                          <div className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-ink">{item.body}</div>
                          <TagList tags={item.tags} />
                          <label className="block text-xs font-medium text-muted">发布平台
                            <select value={publishPlatform} onChange={(event) => { const platform = event.target.value; setPublishPlatformMap((current) => ({ ...current, [item.id]: platform })); setPublishAccountMap((current) => ({ ...current, [item.id]: accountsForPlatform(platform)[0] })); }} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-orange-300">
                              {feishuSyncPlatformOptions.map((platform) => <option key={platform}>{platform}</option>)}
                            </select>
                          </label>
                          <label className="block text-xs font-medium text-muted">发布账号
                            <select value={publishAccount} onChange={(event) => setPublishAccountMap((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-orange-300">
                              {accountsForPlatform(publishPlatform).map((account) => <option key={account}>{account}</option>)}
                            </select>
                          </label>
                        </div>
                        {images.length ? <div className="grid grid-cols-3 gap-1 border-t border-line bg-slate-50 p-2">{images.slice(0, 9).map((url, index) => <button type="button" key={`${item.id}-${url}-${index}`} onClick={() => setPreviewImageUrl(url)} className="overflow-hidden rounded-md bg-white"><img src={url} alt={`${item.title} P${index + 1}`} className="aspect-[3/4] w-full object-cover" /></button>)}</div> : <div className="border-t border-line bg-slate-50 px-4 py-6 text-center text-xs text-muted">暂无真实图片</div>}
                        <div className="flex flex-wrap justify-end gap-2 border-t border-line p-3">
                          <Button icon={<Eye className="h-4 w-4" />} onClick={() => setSelected(item)}>详情</Button>
                          <Button icon={<Edit3 className="h-4 w-4" />} onClick={() => openEditor(item)}>编辑</Button>
                          <Button variant="success" icon={<Send className="h-4 w-4" />} onClick={() => void syncContentToFeishu(item)} disabled={syncingId === item.id}>{syncingId === item.id ? "同步中…" : "同步"}</Button>
                          <Button icon={<Download className="h-4 w-4" />} onClick={() => void chooseLocalExportFolder(item)} disabled={exportingId === item.id}>导出</Button>
                          {item.source === "cos" ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => void removeItem(item)} disabled={deletingId === item.id}>删除</Button> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <DataTable headers={["", "内容预览", "标题", "平台 / 账号", "内容类型", "图片/视频数量", "标签", "查重分", "低流量风险", "状态", "存储位置", "更新时间", "操作"]}>
                  {folderItems.map((item) => {
                    const images = displayImageUrls(item);
                    return (
                      <tr key={item.id}>
                        <td className="px-4 py-3"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => toggleSelected(item.id, event.target.checked)} className="h-4 w-4 accent-orange-500" /></td>
                        <td className="px-4 py-3">{images[0] ? <button type="button" onClick={() => setPreviewImageUrl(images[0])}><img src={images[0]} alt={item.title} className="h-16 w-12 rounded-md object-cover" /></button> : <div className="h-16 w-12 rounded-md bg-slate-100" />}</td>
                        <td className="min-w-72 px-4 py-3"><p className="font-medium text-ink">{item.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{item.summary}</p></td>
                        <td className="px-4 py-3"><div className="flex items-center gap-2"><PlatformBadge badge="RED" platform={item.platform} /><div><p className="text-sm text-ink">{item.platform}</p><p className="text-xs text-muted">{item.account}</p></div></div></td>
                        <td className="px-4 py-3 text-muted">{item.type}</td>
                        <td className="px-4 py-3 text-muted">{mediaCount(item, images)}</td>
                        <td className="min-w-44 px-4 py-3"><TagList tags={item.tags} /></td>
                        <td className="px-4 py-3"><p className="text-sm text-ink">重复率 {item.duplicateRate}%</p><p className="text-xs text-muted">{item.duplicateLabel}</p></td>
                        <td className="px-4 py-3"><span className={cn("rounded-full px-2.5 py-1 text-xs font-medium ring-1", riskClass(item.lowFlowRisk))}>{item.lowFlowRisk}</span></td>
                        <td className="px-4 py-3"><StatusBadge status={statusKey(item.status)} label={item.status} /></td>
                        <td className="max-w-48 truncate px-4 py-3 text-xs text-muted">{item.localPath}</td>
                        <td className="px-4 py-3 text-muted">{dateText(item.updatedAt)}</td>
                        <td className="px-4 py-3"><div className="flex gap-1"><IconAction title="查看详情" icon={<Eye className="h-4 w-4" />} onClick={() => setSelected(item)} /><IconAction title="编辑内容" icon={<Edit3 className="h-4 w-4" />} onClick={() => openEditor(item)} /><IconAction title="复制文案" icon={<Copy className="h-4 w-4" />} onClick={() => void copyContent(item)} /><IconAction title="导出内容包" icon={<Download className="h-4 w-4" />} onClick={() => void chooseLocalExportFolder(item)} /></div></td>
                      </tr>
                    );
                  })}
                </DataTable>
              )}
            </CardBody>
          </Card>
        </section>
      )}

      {selected ? (
        <div className="fixed inset-0 z-[70] bg-slate-950/30" onMouseDown={() => setSelected(null)}>
          <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-white px-5 py-4"><div><h2 className="text-lg font-semibold text-ink">{selected.title}</h2><p className="mt-1 text-sm text-muted">{selected.id} · {selected.platform} · {selected.account}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded p-1 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
            <div className="space-y-4 p-5">
              <Card><CardHeader title="内容正文" /><CardBody><p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{selected.body}</p><div className="mt-3"><TagList tags={selected.tags} /></div></CardBody></Card>
              {displayImageUrls(selected).length ? <Card><CardHeader title="素材预览" /><CardBody><div className="grid grid-cols-3 gap-2">{displayImageUrls(selected).map((url, index) => <button type="button" key={`${url}-${index}`} onClick={() => setPreviewImageUrl(url)}><img src={url} alt={`${selected.title} 素材 ${index + 1}`} className="h-28 w-full rounded-md object-cover" /></button>)}</div></CardBody></Card> : null}
              {selected.videoUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"><ExternalLink className="h-4 w-4" />打开视频</a>)}
              {selected.prompts.length ? <Card><CardHeader title="提示词" /><CardBody className="space-y-2">{selected.prompts.map((prompt) => <p key={prompt} className="rounded-lg bg-slate-50 p-3 text-sm text-muted">{prompt}</p>)}</CardBody></Card> : null}
            </div>
            <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-white px-5 py-4"><Button onClick={() => openEditor(selected)}>编辑内容</Button><Button onClick={() => void copyContent(selected)}>复制文案</Button><Button variant="success" onClick={() => void syncContentToFeishu(selected)}>同步到飞书</Button><Button onClick={() => void chooseLocalExportFolder(selected)}>导出内容包</Button><Button onClick={() => setSelected(null)}>关闭</Button></div>
          </aside>
        </div>
      ) : null}

      {editingItem ? <EditModal item={editingItem} saving={savingId === editingItem.id} onClose={() => setEditingItem(null)} onPreview={setPreviewImageUrl} onSave={(values) => void saveEdit(editingItem, values)} /> : null}

      {previewImageUrl ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreviewImageUrl("")}><button type="button" aria-label="关闭预览" className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X className="h-6 w-6" /></button><img src={previewImageUrl} alt="图片预览" className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain" onClick={(event) => event.stopPropagation()} /></div> : null}
    </div>
  );
}

function SelectField({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">{options.map((option) => <option key={option}>{option}</option>)}</select>;
}

function TagList({ tags }: { tags: string[] }) {
  return <div className="flex flex-wrap gap-1">{tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{tag}</span>)}{tags.length > 3 ? <span className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-700">+{tags.length - 3}</span> : null}</div>;
}

function IconAction({ title, icon, onClick }: { title: string; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" title={title} aria-label={title} onClick={onClick} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-muted transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700">{icon}</button>;
}

function EditModal({
  item,
  saving,
  onClose,
  onSave,
  onPreview
}: {
  item: ContentLibraryItem;
  saving: boolean;
  onClose: () => void;
  onSave: (values: EditValues) => void;
  onPreview: (url: string) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [tags, setTags] = useState(item.tags.join("、"));
  const [images, setImages] = useState<EditableImage[]>(() => item.imageUrls.map((url, index) => ({
    id: `stored-${index}-${url}`,
    url
  })));
  const [draggingId, setDraggingId] = useState("");
  const [feedback, setFeedback] = useState("");
  const localUrls = useRef<string[]>([]);

  useEffect(() => () => {
    localUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function addImages(files: FileList | null) {
    const selected = Array.from(files ?? []);
    const supported = selected.filter((file) => CONTENT_IMAGE_TYPES.has(file.type));
    if (supported.length !== selected.length) setFeedback("仅支持 JPG、PNG、WebP、GIF 和 AVIF 图片");
    const available = Math.max(0, CONTENT_IMAGE_MAX_COUNT - images.length);
    const accepted = supported.slice(0, available);
    if (supported.length > available) setFeedback(`每条内容最多 ${CONTENT_IMAGE_MAX_COUNT} 张图片`);
    if (!accepted.length) return;
    const uploaded = accepted.map((blob, index) => {
      const url = URL.createObjectURL(blob);
      localUrls.current.push(url);
      return { id: `local-${Date.now()}-${index}-${blob.name}`, url, blob };
    });
    setImages((current) => [...uploaded, ...current]);
  }

  function deleteImage(image: EditableImage) {
    setImages((current) => current.filter((candidate) => candidate.id !== image.id));
    if (image.blob) {
      URL.revokeObjectURL(image.url);
      localUrls.current = localUrls.current.filter((url) => url !== image.url);
    }
  }

  function moveImage(targetId: string, placement: "before" | "after") {
    if (!draggingId) return;
    setImages((current) => {
      const order = reorderImageUrls(current.map((image) => image.id), draggingId, targetId, placement);
      const byId = new Map(current.map((image) => [image.id, image]));
      return order.map((id) => byId.get(id)).filter((image): image is EditableImage => Boolean(image));
    });
    setDraggingId("");
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={() => !saving && onClose()}>
      <section className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold text-ink">编辑内容和图片</h2>
            <p className="mt-1 text-xs text-muted">保存后，当前图片顺序会写入 COS，并作为飞书附件顺序。</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded p-1 text-muted hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <label className="block text-sm font-medium text-ink">标题
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" />
          </label>
          <label className="block text-sm font-medium text-ink">正文
            <textarea value={body} onChange={(event) => setBody(event.target.value)} className="mt-2 min-h-32 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" />
          </label>
          <label className="block text-sm font-medium text-ink">标签
            <input value={tags} onChange={(event) => setTags(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" />
          </label>
          <section className="rounded-lg border border-line bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-ink">作品图片（{images.length}/{CONTENT_IMAGE_MAX_COUNT}）</h3>
                <p className="mt-1 text-xs text-muted">拖动图片可调整顺序；新增图片先放到最前面，也可以继续拖动。</p>
              </div>
              <div>
                <input
                  id={`library-edit-upload-${item.id}`}
                  type="file"
                  accept={[...CONTENT_IMAGE_TYPES.keys()].join(",")}
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addImages(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => document.getElementById(`library-edit-upload-${item.id}`)?.click()} disabled={saving || images.length >= CONTENT_IMAGE_MAX_COUNT}>
                  添加本地图片
                </Button>
              </div>
            </div>
            {feedback ? <p className="mt-3 text-sm text-amber-700">{feedback}</p> : null}
            {images.length ? (
              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {images.map((image, index) => (
                  <div
                    key={image.id}
                    draggable={!saving}
                    onDragStart={() => setDraggingId(image.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      moveImage(image.id, event.clientX < bounds.left + bounds.width / 2 ? "before" : "after");
                    }}
                    onDragEnd={() => setDraggingId("")}
                    className={`relative cursor-grab overflow-hidden rounded-lg border border-line bg-white active:cursor-grabbing ${draggingId === image.id ? "opacity-60" : ""}`}
                  >
                    <button type="button" onClick={() => onPreview(image.url)} className="block w-full">
                      <img src={image.url} alt={`${title} 图片 ${index + 1}`} className="aspect-[3/4] w-full object-cover" />
                    </button>
                    <button type="button" aria-label={`删除图片 ${index + 1}`} onClick={() => deleteImage(image)} disabled={saving} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-slate-950/75 text-white hover:bg-red-600 disabled:opacity-50">×</button>
                    <p className="px-2 py-1 text-center text-[11px] text-muted">第 {index + 1} 张</p>
                  </div>
                ))}
              </div>
            ) : <div className="mt-4 grid h-24 place-items-center rounded-lg border border-dashed border-line bg-white text-xs text-muted">暂无图片，可从本地添加。</div>}
          </section>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button onClick={onClose} disabled={saving}>取消</Button>
          <Button variant="primary" onClick={() => onSave({ title, body, tags: tags.split(/[、,\s]+/).filter(Boolean), images })} disabled={saving}>
            {saving ? "正在上传 COS…" : "保存修改"}
          </Button>
        </div>
      </section>
    </div>
  );
}
