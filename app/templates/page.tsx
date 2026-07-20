"use client";

import { Edit3, Folder, FolderOpen, FolderUp, ImagePlus, Plus, Sparkles, Trash2, Video, X } from "lucide-react";
import type { DragEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { platformBadges } from "@/lib/constants/platforms";
import { templateItems } from "@/lib/mock/data";
import { cn } from "@/lib/utils/cn";
import {
  LibraryAsset,
  appendMaterialLibrary,
  countAssetChildren,
  createFolderAsset,
  deleteAssetBlobsRecursively,
  deleteAssetBlob,
  getAssetBlob,
  putAssetBlob,
  readMaterialLibrary,
  stripRuntimeAssetUrl,
  writeMaterialLibrary
} from "@/lib/utils/material-library";

type TemplateTarget = "image" | "video";
type LibraryView = "templates" | "materials";

type TemplateItem = {
  id: string;
  name: string;
  platform: string;
  type: string;
  used: number;
  cover: string;
  tone: string;
  categoryId: string;
  category: string;
  target: TemplateTarget;
  title?: string;
  copy?: string;
  keywords?: string;
  imageAssets?: LibraryAsset[];
  videoAssets?: LibraryAsset[];
};

type TemplateDraft = {
  id: string;
  name: string;
  platform: string;
  type: string;
  used: number;
  cover: string;
  tone: string;
  categoryId: string;
  target: TemplateTarget;
  title: string;
  copy: string;
  keywords: string;
  imageAssets: LibraryAsset[];
  videoAssets: LibraryAsset[];
};

type Category = { id: string; name: string; fixed?: boolean; className: string };

const TEMPLATE_STORAGE_KEY = "content-production-studio-xhs.templates";
const CATEGORY_STORAGE_KEY = "content-production-studio-xhs.template-categories";

const fixedCategories: Category[] = [
  { id: "image", name: "图文", fixed: true, className: "bg-blue-50 text-blue-700 ring-blue-200" },
  { id: "video", name: "视频", fixed: true, className: "bg-violet-50 text-violet-700 ring-violet-200" }
];

const initialCustomCategories: Category[] = [
  { id: "seeding", name: "种草", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  { id: "compliance", name: "合规", className: "bg-amber-50 text-amber-700 ring-amber-200" }
];

const autoCategoryColors = [
  "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "bg-amber-50 text-amber-700 ring-amber-200",
  "bg-sky-50 text-sky-700 ring-sky-200",
  "bg-rose-50 text-rose-700 ring-rose-200",
  "bg-purple-50 text-purple-700 ring-purple-200",
  "bg-orange-50 text-orange-700 ring-orange-200"
];

const platformOptions = ["小红书"];
const contentTypeOptions = ["长图文", "短图文", "标题组", "轻知识", "短视频", "分镜脚本", "改写模板"];
const toneOptions = ["收藏向", "素人感", "真实分享", "理性提醒", "流程感", "安全表达"];

const defaultDraft: TemplateDraft = {
  id: "tpl_new",
  name: "",
  platform: "小红书",
  type: "长图文",
  used: 0,
  cover: "图文模板",
  tone: "收藏向",
  categoryId: "image",
  target: "image",
  title: "",
  copy: "",
  keywords: "",
  imageAssets: [],
  videoAssets: []
};

function normalizeAssets(value: unknown): LibraryAsset[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === "string") {
      return { id: `legacy_${index}_${item}`, name: item, type: "file", source: "旧素材", createdAt: new Date().toISOString() };
    }
    const asset = item as Partial<LibraryAsset>;
    return {
      id: asset.id ?? `asset_${index}_${asset.name ?? "file"}`,
      name: asset.name ?? "未命名素材",
      type: asset.type ?? "file",
      source: asset.source ?? "素材库",
      createdAt: asset.createdAt ?? new Date().toISOString(),
      storeKey: asset.storeKey,
      url: asset.url,
      size: asset.size,
      note: asset.note,
      folderPath: asset.folderPath,
      coverAssetId: asset.coverAssetId,
      children: normalizeAssets(asset.children)
    };
  });
}

function normalizeTemplate(item: Partial<TemplateItem>): TemplateItem {
  return {
    id: item.id ?? `tpl_${Date.now()}`,
    name: item.name ?? "未命名模板",
    platform: item.platform ?? "小红书",
    type: item.type ?? "长图文",
    used: item.used ?? 0,
    cover: item.cover ?? (item.target === "video" ? "视频脚本" : "图文模板"),
    tone: item.tone ?? "收藏向",
    categoryId: item.categoryId ?? "image",
    category: item.category ?? "图文",
    target: item.target ?? "image",
    title: item.title ?? item.name ?? "",
    copy: item.copy ?? "围绕防晒护肤场景整理一段可复用文案，保留真实体验、收藏点和轻量转化表达。",
    keywords: item.keywords ?? "通勤防晒, 防晒喷雾, 油皮防晒, 夏天护肤, 不泛白",
    imageAssets: normalizeAssets(item.imageAssets),
    videoAssets: normalizeAssets(item.videoAssets)
  };
}

const initialTemplates = (templateItems as unknown as TemplateItem[]).map(normalizeTemplate);

function readStoredTemplates() {
  if (typeof window === "undefined") return initialTemplates;
  try {
    const raw = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<TemplateItem>[]).map(normalizeTemplate) : initialTemplates;
  } catch {
    return initialTemplates;
  }
}

function readStoredCategories() {
  if (typeof window === "undefined") return initialCustomCategories;
  try {
    const raw = window.localStorage.getItem(CATEGORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Category[] : initialCustomCategories;
  } catch {
    return initialCustomCategories;
  }
}

async function hydrateAsset(asset: LibraryAsset): Promise<LibraryAsset> {
  const children = asset.children?.length ? await Promise.all(asset.children.map(hydrateAsset)) : undefined;
  if (!asset.storeKey || asset.url?.startsWith("data:")) return { ...asset, children };
  const blob = await getAssetBlob(asset.storeKey);
  return blob ? { ...asset, children, url: URL.createObjectURL(blob) } : { ...asset, children };
}

async function hydrateTemplates(items: TemplateItem[]) {
  return Promise.all(items.map(async (item) => ({
    ...item,
    imageAssets: await Promise.all((item.imageAssets ?? []).map(hydrateAsset)),
    videoAssets: await Promise.all((item.videoAssets ?? []).map(hydrateAsset))
  })));
}

async function hydrateMaterials(items: LibraryAsset[]) {
  return Promise.all(items.map(hydrateAsset));
}

function persistTemplates(items: TemplateItem[]) {
  return items.map((item) => ({
    ...item,
    imageAssets: item.imageAssets?.map(stripRuntimeAssetUrl),
    videoAssets: item.videoAssets?.map(stripRuntimeAssetUrl)
  }));
}

function getCoverAsset(item: Pick<TemplateItem, "imageAssets" | "videoAssets">) {
  return item.imageAssets?.find((asset) => asset.type === "image" && asset.url) ?? item.videoAssets?.find((asset) => asset.type === "video" && asset.url);
}

function getAssetById(asset: LibraryAsset, id?: string): LibraryAsset | null {
  if (!id) return null;
  if (asset.id === id) return asset;
  for (const child of asset.children ?? []) {
    const found = getAssetById(child, id);
    if (found) return found;
  }
  return null;
}

function getFolderCoverAsset(asset: LibraryAsset): LibraryAsset | null {
  return getAssetById(asset, asset.coverAssetId) ?? (asset.children ?? []).find((item) => (item.type === "image" || item.type === "video") && item.url) ?? null;
}

function findFolderByPath(root: LibraryAsset, path: string[]) {
  return path.reduce<LibraryAsset | null>((folder, folderId) => {
    if (!folder) return null;
    return (folder.children ?? []).find((item) => item.id === folderId && item.type === "folder") ?? null;
  }, root);
}

function updateFolderByPath(root: LibraryAsset, path: string[], updater: (folder: LibraryAsset) => LibraryAsset): LibraryAsset {
  if (!path.length) return updater(root);
  const [nextId, ...rest] = path;
  return {
    ...root,
    children: (root.children ?? []).map((child) => {
      if (child.id !== nextId || child.type !== "folder") return child;
      return updateFolderByPath(child, rest, updater);
    })
  };
}

async function readFiles(files: FileList | null, source: string): Promise<LibraryAsset[]> {
  const selected = Array.from(files ?? []);
  return Promise.all(selected.map(async (file) => {
    const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file";
    const id = `asset_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const storeKey = `blob_${id}`;
    await putAssetBlob(storeKey, file);
    return {
      id,
      name: file.name,
      type,
      source,
      createdAt: new Date().toISOString(),
      storeKey,
      url: URL.createObjectURL(file),
      size: file.size,
      folderPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined
    } satisfies LibraryAsset;
  }));
}

function folderNameFromFiles(files: FileList | null, fallback: string) {
  const first = Array.from(files ?? [])[0] as (File & { webkitRelativePath?: string }) | undefined;
  return first?.webkitRelativePath?.split("/")[0] || fallback;
}

export default function TemplatesPage() {
  const router = useRouter();
  const [view, setView] = useState<LibraryView>("materials");
  const [templates, setTemplates] = useState<TemplateItem[]>(initialTemplates);
  const [materials, setMaterials] = useState<LibraryAsset[]>([]);
  const [customCategories, setCustomCategories] = useState<Category[]>(initialCustomCategories);
  const [hydrated, setHydrated] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [previewing, setPreviewing] = useState<TemplateItem | null>(null);
  const [openFolder, setOpenFolder] = useState<LibraryAsset | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadRemark, setUploadRemark] = useState("");
  const [draggingMaterialId, setDraggingMaterialId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("素材库已就绪，可管理本地图文、视频、文件夹和内容生产生成结果素材。");

  useEffect(() => {
    void (async () => {
      setTemplates(await hydrateTemplates(readStoredTemplates()));
      setMaterials(await hydrateMaterials(readMaterialLibrary()));
      setCustomCategories(readStoredCategories());
      setView("materials");
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(persistTemplates(templates)));
  }, [hydrated, templates]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(customCategories));
  }, [hydrated, customCategories]);

  useEffect(() => {
    if (!hydrated) return;
    writeMaterialLibrary(materials.map(stripRuntimeAssetUrl));
  }, [hydrated, materials]);

  const categories = useMemo(() => [...fixedCategories, ...customCategories], [customCategories]);
  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const filteredTemplates = activeCategory === "all" ? templates : templates.filter((item) => item.categoryId === activeCategory);

  const openEditor = (item?: TemplateItem) => {
    setEditing(item ? {
      id: item.id,
      name: item.name,
      platform: item.platform,
      type: item.type,
      used: item.used,
      cover: item.cover,
      tone: item.tone,
      categoryId: item.categoryId,
      target: item.target,
      title: item.title ?? item.name,
      copy: item.copy ?? "",
      keywords: item.keywords ?? "",
      imageAssets: item.imageAssets ?? [],
      videoAssets: item.videoAssets ?? []
    } : { ...defaultDraft, id: `tpl_${Date.now()}` });
  };

  const saveTemplate = () => {
    if (!editing) return;
    const category = categoryMap.get(editing.categoryId) ?? fixedCategories[0];
    const nextItem: TemplateItem = {
      id: editing.id,
      name: editing.name || editing.title || "未命名模板",
      platform: editing.platform,
      type: editing.type,
      used: editing.used,
      cover: editing.target === "video" ? "视频脚本" : "图文模板",
      tone: editing.tone || "未设置",
      categoryId: editing.categoryId,
      category: category.name,
      target: editing.target,
      title: editing.title,
      copy: editing.copy,
      keywords: editing.keywords,
      imageAssets: editing.imageAssets,
      videoAssets: editing.videoAssets
    };
    setTemplates((items) => items.some((item) => item.id === editing.id) ? items.map((item) => item.id === editing.id ? nextItem : item) : [nextItem, ...items]);
    setFeedback(`已保存模板：${nextItem.name}`);
    setEditing(null);
  };

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return setFeedback("请输入自定义分类名称。");
    if (categories.some((category) => category.name === name)) return setFeedback("这个分类已经存在。");
    const id = `custom_${Date.now()}`;
    setCustomCategories((items) => [...items, { id, name, className: autoCategoryColors[customCategories.length % autoCategoryColors.length] }]);
    setActiveCategory(id);
    setNewCategoryName("");
    setFeedback(`已新增分类：${name}`);
  };

  const deleteCategory = (category: Category) => {
    if (category.fixed) return;
    setCustomCategories((items) => items.filter((item) => item.id !== category.id));
    setTemplates((items) => items.map((item) => item.categoryId === category.id ? { ...item, categoryId: "image", category: "图文" } : item));
    if (activeCategory === category.id) setActiveCategory("all");
    setFeedback(`已删除分类：${category.name}，原分类下模板已移至图文分类。`);
  };

  const useTemplate = (item: TemplateItem) => {
    const params = new URLSearchParams({ tab: "image", templateId: item.id, templateName: item.name });
    params.set("imageStep", "仿写生成");
    router.push(`/content?${params.toString()}`);
  };

  const addMaterials = (items: LibraryAsset[]) => {
    setMaterials((current) => {
      const next = [...items, ...current];
      writeMaterialLibrary(next.map(stripRuntimeAssetUrl));
      return next;
    });
    appendMaterialLibrary(items);
  };

  const quickUploadFiles = async (files: FileList | null, source: string) => {
    const assets = await readFiles(files, source);
    addMaterials(assets);
    setFeedback(`已上传 ${assets.length} 个素材。`);
  };

  const quickUploadFolder = async (files: FileList | null) => {
    const children = await readFiles(files, "素材库快速上传 / 文件夹");
    const folder = createFolderAsset({ name: folderNameFromFiles(files, "上传文件夹"), source: "素材库快速上传 / 文件夹", children });
    addMaterials([folder]);
    setFeedback(`已上传文件夹：${folder.name}`);
  };

  const createMaterialFolder = (folder: LibraryAsset) => {
    addMaterials([folder]);
    setFeedback(`已新建文件夹：${folder.name}`);
    setUploadOpen(false);
    setUploadTitle("");
    setUploadRemark("");
  };

  const deleteMaterial = async (asset: LibraryAsset) => {
    await deleteAssetBlobsRecursively(asset);
    setMaterials((items) => {
      const next = items.filter((item) => item.id !== asset.id);
      writeMaterialLibrary(next.map(stripRuntimeAssetUrl));
      return next;
    });
    if (openFolder?.id === asset.id) setOpenFolder(null);
    setFeedback(`已删除素材：${asset.name}`);
  };

  const updateOpenFolder = (folder: LibraryAsset) => {
    setOpenFolder(folder);
    setMaterials((items) => {
      const next = items.map((item) => item.id === folder.id ? folder : item);
      writeMaterialLibrary(next.map(stripRuntimeAssetUrl));
      return next;
    });
  };

  const moveMaterialIntoFolder = (assetId: string, folderId: string) => {
    if (assetId === folderId) return;
    setMaterials((items) => {
      const movingAsset = items.find((item) => item.id === assetId);
      if (!movingAsset || movingAsset.type === "folder") return items;
      const next = items
        .filter((item) => item.id !== assetId)
        .map((item) => item.id === folderId && item.type === "folder"
          ? { ...item, children: [movingAsset, ...(item.children ?? [])] }
          : item);
      writeMaterialLibrary(next.map(stripRuntimeAssetUrl));
      return next;
    });
    const folderName = materials.find((item) => item.id === folderId)?.name ?? "文件夹";
    setFeedback(`已移动素材到：${folderName}`);
    setDraggingMaterialId(null);
  };

  const stopAndUse = (event: MouseEvent<HTMLButtonElement>, item: TemplateItem) => {
    event.stopPropagation();
    useTemplate(item);
  };

  const stopAndEdit = (event: MouseEvent<HTMLButtonElement>, item: TemplateItem) => {
    event.stopPropagation();
    openEditor(item);
  };

  return (
    <>
      <PageHeader
        title={view === "templates" ? "模板库" : "素材库"}
        description={view === "templates" ? "沉淀自建内容模板，支持图文模板、视频脚本模板和自定义分类。" : "集中管理本地图文、视频、文件夹和内容生产生成结果素材。"}
        action={view === "templates" ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openEditor()}>新增模板</Button> : undefined}
      />

      {view === "templates" ? (
        <>
          <Card>
            <CardHeader title="模板筛选" subtitle="按平台、内容形式、分类和使用次数排序。" />
            <CardBody className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <FilterSelect label="平台筛选" options={["全部平台", ...platformOptions]} />
                <FilterSelect label="内容形式筛选" options={["全部形式", ...contentTypeOptions]} />
                <FilterSelect label="排序" options={["使用次数从高到低", "最近更新", "平台优先"]} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setActiveCategory("all")} className={cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition", activeCategory === "all" ? "bg-orange-50 text-orange-700 ring-orange-200" : "bg-white text-muted ring-line hover:text-orange-700")}>全部</button>
                {categories.map((category) => (
                  <span key={category.id} className={cn("inline-flex items-center overflow-hidden rounded-full text-sm font-medium ring-1", category.className, activeCategory === category.id ? "shadow-sm" : "opacity-90")}>
                    <button onClick={() => setActiveCategory(category.id)} className="px-3 py-1.5 transition hover:bg-white/40">{category.name}{category.fixed ? "分类" : ""}</button>
                    {!category.fixed ? <button onClick={() => deleteCategory(category)} className="border-l border-current/15 px-2 py-1.5 transition hover:bg-white/60" title={`删除${category.name}分类`}><X className="h-3.5 w-3.5" /></button> : null}
                  </span>
                ))}
              </div>
              <div className="grid gap-3 rounded-lg border border-dashed border-orange-200 bg-orange-50/40 p-3 md:grid-cols-[1fr_auto]">
                <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} className="h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300" placeholder="新增自定义分类，例如：口播、避坑、测评" />
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={addCategory}>添加分类</Button>
              </div>
              <p className="text-sm text-orange-700">{feedback}</p>
            </CardBody>
          </Card>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredTemplates.map((item, index) => {
              const category = categoryMap.get(item.categoryId);
              return (
                <div key={item.id} role="button" tabIndex={0} onClick={() => setPreviewing(item)} onKeyDown={(event) => { if (event.key === "Enter") setPreviewing(item); }} className="cursor-pointer outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-orange-300">
                  <Card>
                    <CardBody>
                      <div className="relative flex h-36 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-orange-100 via-white to-blue-100">
                        <TemplateCover item={item} index={index} />
                        <div className="absolute left-3 top-3"><PlatformBadge badge={platformBadges[item.platform as keyof typeof platformBadges] ?? "ALL"} platform={item.platform} /></div>
                        <div className="absolute right-3 top-3"><span className={cn("rounded-full px-2.5 py-1 text-xs font-medium ring-1", category?.className ?? "bg-slate-50 text-slate-700 ring-slate-200")}>{item.category}</span></div>
                      </div>
                      <div className="mt-4 flex items-start justify-between gap-3">
                        <div><h2 className="text-base font-semibold text-ink">{item.name}</h2><p className="mt-1 text-sm text-muted">{item.platform} · {item.type}</p></div>
                        <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 ring-1 ring-orange-100">{item.tone}</span>
                      </div>
                      <p className="mt-3 text-sm text-muted">已使用 {item.used} 次，适合本地内容生产、检测和归档流程复用。</p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} onClick={(event) => stopAndUse(event, item)}>使用模板</Button>
                        <Button icon={<Edit3 className="h-4 w-4" />} onClick={(event) => stopAndEdit(event, item)}>编辑模板</Button>
                      </div>
                    </CardBody>
                  </Card>
                </div>
              );
            })}
          </section>
        </>
      ) : (
        <MaterialLibrary
          materials={materials}
          feedback={feedback}
          onQuickUploadFiles={quickUploadFiles}
          onQuickUploadFolder={quickUploadFolder}
          onCreateFolder={() => setUploadOpen(true)}
          onOpenFolder={setOpenFolder}
          onDelete={deleteMaterial}
          draggingMaterialId={draggingMaterialId}
          onDragStart={setDraggingMaterialId}
          onDragEnd={() => setDraggingMaterialId(null)}
          onDropIntoFolder={moveMaterialIntoFolder}
        />
      )}

      {previewing ? <PreviewModal item={previewing} onClose={() => setPreviewing(null)} onEdit={() => { openEditor(previewing); setPreviewing(null); }} onUse={() => useTemplate(previewing)} /> : null}
      {openFolder ? <FolderModal folder={openFolder} onClose={() => setOpenFolder(null)} onUpdate={updateOpenFolder} onDeleteAsset={deleteAssetBlobsRecursively} /> : null}
      {uploadOpen ? (
        <UploadMaterialModal
          title={uploadTitle}
          remark={uploadRemark}
          onTitleChange={setUploadTitle}
          onRemarkChange={setUploadRemark}
          onClose={() => setUploadOpen(false)}
          onCreate={createMaterialFolder}
        />
      ) : null}
      {editing ? <EditorModal editing={editing} categories={categories} onChange={setEditing} onClose={() => setEditing(null)} onSave={saveTemplate} onDelete={() => { setTemplates((items) => items.filter((item) => item.id !== editing.id)); setEditing(null); }} /> : null}
    </>
  );
}

function FilterSelect({ label, options }: { label: string; options: string[] }) {
  return <label className="text-sm font-medium text-ink">{label}<select className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function MaterialLibrary({
  materials,
  feedback,
  onQuickUploadFiles,
  onQuickUploadFolder,
  onCreateFolder,
  onOpenFolder,
  onDelete,
  draggingMaterialId,
  onDragStart,
  onDragEnd,
  onDropIntoFolder
}: {
  materials: LibraryAsset[];
  feedback: string;
  onQuickUploadFiles: (files: FileList | null, source: string) => void;
  onQuickUploadFolder: (files: FileList | null) => void;
  onCreateFolder: () => void;
  onOpenFolder: (folder: LibraryAsset) => void;
  onDelete: (asset: LibraryAsset) => void;
  draggingMaterialId: string | null;
  onDragStart: (assetId: string) => void;
  onDragEnd: () => void;
  onDropIntoFolder: (assetId: string, folderId: string) => void;
}) {
  return (
    <>
      <Card>
        <CardHeader title="素材库" subtitle="快速上传会生成单个图文、单个视频或一个文件夹；可新建文件夹后，把素材拖入文件夹整理。" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <UploadButton id="quick-material-image" icon={<ImagePlus className="h-4 w-4" />} label="上传图文" accept="image/*" onChange={(files) => onQuickUploadFiles(files, "素材库快速上传 / 图文")} />
            <UploadButton id="quick-material-video" icon={<Video className="h-4 w-4" />} label="上传视频" accept="video/*" onChange={(files) => onQuickUploadFiles(files, "素材库快速上传 / 视频")} />
            <UploadButton id="quick-material-folder" icon={<FolderUp className="h-4 w-4" />} label="上传文件夹" accept="" directory onChange={onQuickUploadFolder} />
            <Button icon={<Folder className="h-4 w-4" />} onClick={onCreateFolder}>新建文件夹</Button>
          </div>
          <p className="text-sm text-orange-700">{feedback}</p>
        </CardBody>
      </Card>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {materials.map((asset) => (
          <MaterialCard
            key={asset.id}
            asset={asset}
            draggingMaterialId={draggingMaterialId}
            onOpenFolder={() => onOpenFolder(asset)}
            onDelete={() => onDelete(asset)}
            onDragStart={() => onDragStart(asset.id)}
            onDragEnd={onDragEnd}
            onDropIntoFolder={(draggedId) => onDropIntoFolder(draggedId, asset.id)}
          />
        ))}
        {!materials.length ? <Card className="md:col-span-2 xl:col-span-4"><CardBody><p className="text-sm text-muted">暂无素材，先上传图文、视频或文件夹。</p></CardBody></Card> : null}
      </section>
    </>
  );
}

function UploadMaterialModal({ title, remark, onTitleChange, onRemarkChange, onClose, onCreate }: { title: string; remark: string; onTitleChange: (value: string) => void; onRemarkChange: (value: string) => void; onClose: () => void; onCreate: (folder: LibraryAsset) => void }) {
  const [uploadGroupOpen, setUploadGroupOpen] = useState(false);
  const [stagedAssets, setStagedAssets] = useState<LibraryAsset[]>([]);
  const canShowGroup = title.trim().length > 0;

  const addAssets = async (files: FileList | null, source: string) => {
    const nextAssets = await readFiles(files, source);
    setStagedAssets((items) => [...items, ...nextAssets]);
  };

  const addFolder = async (files: FileList | null) => {
    const children = await readFiles(files, "新建文件夹 / 文件夹");
    const folder = createFolderAsset({ name: folderNameFromFiles(files, "上传文件夹"), source: "新建文件夹 / 文件夹", children });
    setStagedAssets((items) => [...items, folder]);
  };

  const removeStagedAsset = async (asset: LibraryAsset) => {
    await deleteAssetBlobsRecursively(asset);
    setStagedAssets((items) => items.filter((item) => item.id !== asset.id));
  };

  const create = () => {
    onCreate(createFolderAsset({ name: title.trim(), note: remark.trim(), source: "新建文件夹", children: stagedAssets }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div><h2 className="text-lg font-semibold text-ink">新建文件夹</h2><p className="mt-1 text-sm text-muted">填写文件夹名称，可先空文件夹创建，也可以顺手放入一组素材。</p></div>
          <button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block text-sm font-medium text-ink">文件夹名称<input value={title} onChange={(event) => onTitleChange(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" placeholder="例如：7月防晒口播素材" /></label>
          <label className="block text-sm font-medium text-ink">备注<textarea value={remark} onChange={(event) => onRemarkChange(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" placeholder="备注选填，例如来源、用途、适用账号、拍摄注意点等" /></label>
          {canShowGroup ? (
            <div className="rounded-lg border border-line bg-slate-50">
              <button onClick={() => setUploadGroupOpen((current) => !current)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink">素材子集<span className="text-xs text-muted">{uploadGroupOpen ? "收起" : "展开上传"}</span></button>
              {uploadGroupOpen ? (
                <div className="space-y-3 border-t border-line p-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <UploadButton id="modal-material-image" icon={<ImagePlus className="h-4 w-4" />} label="上传图文" accept="image/*" multiple onChange={(files) => addAssets(files, "新建文件夹 / 图文")} />
                    <UploadButton id="modal-material-video" icon={<Video className="h-4 w-4" />} label="上传视频" accept="video/*" multiple onChange={(files) => addAssets(files, "新建文件夹 / 视频")} />
                    <UploadButton id="modal-material-folder" icon={<FolderUp className="h-4 w-4" />} label="上传文件夹" accept="" directory onChange={addFolder} />
                  </div>
                  {stagedAssets.length ? <div className="grid grid-cols-3 gap-2">{stagedAssets.map((asset) => <AssetThumb key={asset.id} asset={asset} onRemove={() => removeStagedAsset(asset)} />)}</div> : null}
                </div>
              ) : null}
            </div>
          ) : <div className="rounded-lg border border-dashed border-line bg-slate-50 px-4 py-3 text-sm text-muted">填写标题后，会出现素材子集上传入口。</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4"><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!title.trim()} onClick={create}>完成</Button></div>
      </div>
    </div>
  );
}

function UploadButton({ id, label, accept, icon, directory, multiple, onChange }: { id: string; label: string; accept: string; icon: ReactNode; directory?: boolean; multiple?: boolean; onChange: (files: FileList | null) => void }) {
  return (
    <>
      <input id={id} type="file" accept={accept} multiple={directory || multiple} className="hidden" onChange={(event) => onChange(event.target.files)} {...(directory ? { webkitdirectory: "", directory: "" } : {})} />
      <label htmlFor={id} className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink transition hover:border-orange-200 hover:bg-orange-50">{icon}{label}</label>
    </>
  );
}

function MaterialCard({
  asset,
  draggingMaterialId,
  onOpenFolder,
  onDelete,
  onDragStart,
  onDragEnd,
  onDropIntoFolder
}: {
  asset: LibraryAsset;
  draggingMaterialId?: string | null;
  onOpenFolder: () => void;
  onDelete: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDropIntoFolder?: (draggedId: string) => void;
}) {
  const isFolder = asset.type === "folder";
  const folderCover = isFolder ? getFolderCoverAsset(asset) : null;
  const canDrop = Boolean(isFolder && draggingMaterialId && draggingMaterialId !== asset.id);
  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (!isFolder) return;
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("application/x-material-id") || draggingMaterialId;
    if (draggedId) onDropIntoFolder?.(draggedId);
  };
  return (
    <Card>
      <CardBody>
        <div
          draggable={!isFolder}
          onDragStart={(event) => {
            if (isFolder) return;
            event.dataTransfer.setData("application/x-material-id", asset.id);
            event.dataTransfer.effectAllowed = "move";
            onDragStart?.();
          }}
          onDragEnd={onDragEnd}
          onDragOver={(event) => {
            if (!isFolder) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={drop}
          onClick={isFolder ? onOpenFolder : undefined}
          className={cn("relative flex h-36 items-center justify-center overflow-hidden rounded-lg bg-slate-50 transition", isFolder ? "cursor-pointer hover:bg-orange-50" : "cursor-grab active:cursor-grabbing", canDrop ? "ring-2 ring-orange-300 bg-orange-50" : "")}
        >
          {asset.type === "image" && asset.url ? <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" /> : null}
          {asset.type === "video" && asset.url ? <video src={asset.url} className="h-full w-full object-cover" muted playsInline preload="metadata" /> : null}
          {folderCover?.type === "image" && folderCover.url ? <img src={folderCover.url} alt={asset.name} className="h-full w-full object-cover" /> : null}
          {folderCover?.type === "video" && folderCover.url ? <video src={folderCover.url} className="h-full w-full object-cover" muted playsInline preload="metadata" /> : null}
          {isFolder && !folderCover ? <div className="text-center text-orange-700"><Folder className="mx-auto h-12 w-12" /><p className="mt-2 text-sm font-medium">{countAssetChildren(asset)} 个素材</p></div> : null}
          {isFolder && folderCover ? <div className="absolute left-2 top-2 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-orange-700 shadow-sm">文件夹 · {countAssetChildren(asset)} 个</div> : null}
          {(!asset.url && !isFolder) ? <div className="px-3 text-center text-sm text-muted">{asset.folderPath || asset.name}</div> : null}
          <button onClick={(event) => { event.stopPropagation(); onDelete(); }} className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-red-600 shadow-sm hover:bg-red-50" title="删除素材"><X className="h-4 w-4" /></button>
        </div>
        <h3 className="mt-3 truncate text-sm font-semibold text-ink">{asset.name}</h3>
        <p className="mt-1 text-xs text-muted">{asset.source}</p>
        {asset.note ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{asset.note}</p> : null}
        {isFolder ? <Button className="mt-3 w-full" onClick={onOpenFolder}>打开文件夹</Button> : null}
      </CardBody>
    </Card>
  );
}

function FolderModal({ folder, onClose, onUpdate, onDeleteAsset }: { folder: LibraryAsset; onClose: () => void; onUpdate: (folder: LibraryAsset) => void; onDeleteAsset: (asset: LibraryAsset) => void | Promise<void> }) {
  const [rootFolder, setRootFolder] = useState(folder);
  const [folderPath, setFolderPath] = useState<string[]>([]);
  const currentFolder = findFolderByPath(rootFolder, folderPath) ?? rootFolder;
  const breadcrumb = [rootFolder.name, ...folderPath.map((folderId, index) => findFolderByPath(rootFolder, folderPath.slice(0, index + 1))?.name).filter(Boolean)];

  useEffect(() => {
    setRootFolder(folder);
    setFolderPath([]);
  }, [folder]);

  const updateCurrentFolder = (updater: (folder: LibraryAsset) => LibraryAsset) => {
    const nextRoot = updateFolderByPath(rootFolder, folderPath, updater);
    setRootFolder(nextRoot);
    onUpdate(nextRoot);
  };

  const addAssets = async (files: FileList | null, source: string) => {
    const assets = await readFiles(files, source);
    updateCurrentFolder((current) => ({ ...current, children: [...(current.children ?? []), ...assets] }));
  };

  const addFolder = async (files: FileList | null) => {
    const children = await readFiles(files, "文件夹内上传 / 文件夹");
    const childFolder = createFolderAsset({ name: folderNameFromFiles(files, "上传文件夹"), source: "文件夹内上传 / 文件夹", children });
    updateCurrentFolder((current) => ({ ...current, children: [...(current.children ?? []), childFolder] }));
  };

  const remove = async (asset: LibraryAsset) => {
    await onDeleteAsset(asset);
    updateCurrentFolder((current) => ({ ...current, children: (current.children ?? []).filter((item) => item.id !== asset.id), coverAssetId: current.coverAssetId === asset.id ? undefined : current.coverAssetId }));
  };

  const setCover = (asset: LibraryAsset) => {
    updateCurrentFolder((current) => ({ ...current, coverAssetId: asset.id }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{currentFolder.name}</h2>
            <p className="mt-1 text-sm text-muted">{currentFolder.note || "素材文件夹"}</p>
            <p className="mt-2 text-xs text-muted">{breadcrumb.join(" / ")}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-3">
            {folderPath.length ? <Button onClick={() => setFolderPath((items) => items.slice(0, -1))}>返回上一步</Button> : null}
            <UploadButton id={`folder-image-${currentFolder.id}`} icon={<ImagePlus className="h-4 w-4" />} label="上传图文" accept="image/*" multiple onChange={(files) => addAssets(files, "文件夹内上传 / 图文")} />
            <UploadButton id={`folder-video-${currentFolder.id}`} icon={<Video className="h-4 w-4" />} label="上传视频" accept="video/*" multiple onChange={(files) => addAssets(files, "文件夹内上传 / 视频")} />
            <UploadButton id={`folder-folder-${currentFolder.id}`} icon={<FolderUp className="h-4 w-4" />} label="上传文件夹" accept="" directory onChange={addFolder} />
          </div>
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            {(currentFolder.children ?? []).map((asset) => (
              <div key={asset.id} className="space-y-2">
                <MaterialCard asset={asset} onOpenFolder={() => asset.type === "folder" ? setFolderPath((items) => [...items, asset.id]) : undefined} onDelete={() => remove(asset)} />
                {(asset.type === "image" || asset.type === "video") && asset.url ? <Button className="w-full" onClick={() => setCover(asset)}>{currentFolder.coverAssetId === asset.id ? "当前首页封面" : "设为首页封面"}</Button> : null}
              </div>
            ))}
            {!(currentFolder.children ?? []).length ? <div className="rounded-lg border border-line p-4 text-sm text-muted">这个文件夹还没有素材。</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorModal({ editing, categories, onChange, onClose, onSave, onDelete }: { editing: TemplateDraft; categories: Category[]; onChange: (draft: TemplateDraft) => void; onClose: () => void; onSave: () => void; onDelete: () => void }) {
  const addTemplateAssets = async (files: FileList | null, kind: "imageAssets" | "videoAssets") => {
    const assets = await readFiles(files, kind === "imageAssets" ? "模板库 / 图文素材" : "模板库 / 视频素材");
    onChange({ ...editing, [kind]: [...editing[kind], ...assets] });
  };
  const removeTemplateAsset = async (kind: "imageAssets" | "videoAssets", asset: LibraryAsset) => {
    await deleteAssetBlobsRecursively(asset);
    onChange({ ...editing, [kind]: editing[kind].filter((item) => item.id !== asset.id) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4"><div><h2 className="text-lg font-semibold text-ink">编辑模板</h2><p className="mt-1 text-sm text-muted">维护模板内容、分类、平台和本地素材。</p></div><button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <Field label="模板名称"><input value={editing.name} onChange={(event) => onChange({ ...editing, name: event.target.value })} className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" /></Field>
          <Field label="适用平台"><select value={editing.platform} onChange={(event) => onChange({ ...editing, platform: event.target.value })} className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">{platformOptions.map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select></Field>
          <Field label="分类"><select value={editing.categoryId} onChange={(event) => { const categoryId = event.target.value; onChange({ ...editing, categoryId, target: categoryId === "video" ? "video" : categoryId === "image" ? "image" : editing.target }); }} className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
          <Field label="使用入口"><select value={editing.target} onChange={(event) => onChange({ ...editing, target: event.target.value as TemplateTarget })} className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300"><option value="image">图文仿写生成</option><option value="video">视频脚本仿写</option></select></Field>
          <Field label="内容形式"><select value={editing.type} onChange={(event) => onChange({ ...editing, type: event.target.value })} className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">{contentTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
          <Field label="风格标签"><select value={editing.tone} onChange={(event) => onChange({ ...editing, tone: event.target.value })} className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">{toneOptions.map((tone) => <option key={tone} value={tone}>{tone}</option>)}</select></Field>
          <Field label="标题" className="md:col-span-2"><textarea value={editing.title} onChange={(event) => onChange({ ...editing, title: event.target.value })} className="min-h-20 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></Field>
          <Field label="文案" className="md:col-span-2"><textarea value={editing.copy} onChange={(event) => onChange({ ...editing, copy: event.target.value })} className="min-h-32 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></Field>
          <Field label="关键词" className="md:col-span-2"><textarea value={editing.keywords} onChange={(event) => onChange({ ...editing, keywords: event.target.value })} className="min-h-20 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></Field>
          <Field label="本地图文素材"><AssetPicker id="image-assets-upload" icon={<ImagePlus className="h-4 w-4" />} label="上传图文素材" accept="image/*" assets={editing.imageAssets} onUpload={(files) => addTemplateAssets(files, "imageAssets")} onRemove={(asset) => removeTemplateAsset("imageAssets", asset)} /></Field>
          <Field label="本地视频素材"><AssetPicker id="video-assets-upload" icon={<Video className="h-4 w-4" />} label="上传视频素材" accept="video/*" assets={editing.videoAssets} onUpload={(files) => addTemplateAssets(files, "videoAssets")} onRemove={(asset) => removeTemplateAsset("videoAssets", asset)} /></Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4"><Button onClick={onClose}>取消</Button><Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete}>删除模板</Button><Button variant="primary" onClick={onSave}>保存模板</Button></div>
      </div>
    </div>
  );
}

function AssetPicker({ id, label, accept, icon, assets, onUpload, onRemove }: { id: string; label: string; accept: string; icon: ReactNode; assets: LibraryAsset[]; onUpload: (files: FileList | null) => void; onRemove: (asset: LibraryAsset) => void }) {
  return (
    <div>
      <input id={id} type="file" accept={accept} multiple className="hidden" onChange={(event) => onUpload(event.target.files)} />
      <label htmlFor={id} className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink transition hover:border-orange-200 hover:bg-orange-50">{icon}{label}</label>
      {assets.length ? <div className="mt-2 grid grid-cols-3 gap-2">{assets.map((asset) => <AssetThumb key={asset.id} asset={asset} onRemove={() => onRemove(asset)} />)}</div> : null}
    </div>
  );
}

function AssetThumb({ asset, onRemove }: { asset: LibraryAsset; onRemove: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-slate-50">
      {asset.type === "image" && asset.url ? <img src={asset.url} alt={asset.name} className="h-16 w-full object-cover" /> : null}
      {asset.type === "video" && asset.url ? <video src={asset.url} className="h-16 w-full object-cover" muted playsInline preload="metadata" /> : null}
      {asset.type === "folder" ? <div className="flex h-16 items-center justify-center text-orange-700"><Folder className="h-8 w-8" /></div> : null}
      {!asset.url && asset.type !== "folder" ? <div className="flex h-16 items-center justify-center px-2 text-center text-xs text-muted">{asset.name}</div> : null}
      <button type="button" onClick={onRemove} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-red-600 shadow-sm hover:bg-red-50" title="删除素材"><X className="h-3.5 w-3.5" /></button>
      <p className="truncate px-2 py-1 text-xs text-muted">{asset.name}</p>
    </div>
  );
}

function TemplateCover({ item, index }: { item: TemplateItem; index: number }) {
  const asset = getCoverAsset(item);
  if (asset?.type === "image" && asset.url) return <img src={asset.url} alt={item.name} className="h-full w-full object-cover" />;
  if (asset?.type === "video" && asset.url) return <video src={asset.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />;
  return <div className="text-center"><p className="text-3xl font-semibold text-orange-600">{String(index + 1).padStart(2, "0")}</p><p className="mt-2 text-sm font-medium text-ink">{item.cover}</p></div>;
}

function PreviewModal({ item, onClose, onEdit, onUse }: { item: TemplateItem; onClose: () => void; onEdit: () => void; onUse: () => void }) {
  const cover = getCoverAsset(item);
  const allAssets = [...(item.imageAssets ?? []), ...(item.videoAssets ?? [])];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4"><div><h2 className="text-lg font-semibold text-ink">{item.name}</h2><p className="mt-1 text-sm text-muted">{item.platform} · {item.type} · {item.category}</p></div><button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="grid gap-5 p-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            <div className="flex min-h-80 items-center justify-center overflow-hidden rounded-lg border border-line bg-slate-50">{cover?.type === "image" && cover.url ? <img src={cover.url} alt={item.name} className="max-h-[520px] w-full object-contain" /> : null}{cover?.type === "video" && cover.url ? <video src={cover.url} className="max-h-[520px] w-full object-contain" controls /> : null}{!cover ? <div className="text-center text-sm text-muted"><p className="text-3xl font-semibold text-orange-600">{item.cover}</p><p className="mt-2">暂无可预览素材</p></div> : null}</div>
            {allAssets.length ? <div className="grid grid-cols-3 gap-2">{allAssets.map((asset) => <AssetThumb key={asset.id} asset={asset} onRemove={() => {}} />)}</div> : null}
          </div>
          <div className="space-y-4"><PreviewField label="标题" value={item.title || item.name} /><PreviewField label="文案" value={item.copy || "暂无文案"} multiline /><PreviewField label="关键词" value={item.keywords || "暂无关键词"} /></div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4"><Button onClick={onClose}>关闭</Button><Button icon={<Edit3 className="h-4 w-4" />} onClick={onEdit}>编辑模板</Button><Button variant="primary" icon={<Sparkles className="h-4 w-4" />} onClick={onUse}>使用模板</Button></div>
      </div>
    </div>
  );
}

function PreviewField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return <div><p className="text-sm font-medium text-muted">{label}</p><div className={cn("mt-2 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm leading-7 text-ink", multiline ? "min-h-40 whitespace-pre-wrap" : "")}>{value}</div></div>;
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn("block text-sm font-medium text-ink", className)}><span className="mb-2 block">{label}</span>{children}</label>;
}
