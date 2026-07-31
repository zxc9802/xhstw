"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Copy, Download, Edit3, ExternalLink, Eye, FileCheck2, FolderOpen, Grid2X2, ListChecks, MoreHorizontal, PackageCheck, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { feishuSyncPlatformOptions } from "@/lib/constants/platforms";
import { accounts as productionAccounts } from "@/lib/mock/data";
import { imageExtension, safeFileName, utf8TextBlob, writeBlobFiles, type WritableDirectoryLike } from "@/lib/utils/browser-file-export";
import { cn } from "@/lib/utils/cn";
import { imageRefToUploadUrl, isStoredImageRef, persistImageFile, resolveImageRef, resolveImageRefs } from "@/lib/utils/image-store";
import { reorderImageUrls, selectExportTargets } from "@/lib/utils/production-workflow";

type LibraryStatus = "可发布" | "已保存本地" | "需复查" | "已归档" | "已淘汰";
type RiskLevel = "低" | "中" | "高";
type ViewMode = "table" | "cards";

type FinishedContent = {
  id: string;
  title: string;
  summary: string;
  body: string;
  platform: string;
  platformBadge: string;
  account: string;
  type: string;
  mediaCount: string;
  mediaKind: "image" | "video";
  mediaUrls?: string[];
  pages?: Array<{ page: number; title: string; copy: string; prompt: string; provider: string; images: string[]; sourceImages: string[] }>;
  referenceSources?: Array<{ title: string; url: string; platform: string; media: Array<{ type: string; url: string; name: string }> }>;
  tags: string[];
  duplicateRate: number;
  duplicateLabel: string;
  lowFlowRisk: RiskLevel;
  status: LibraryStatus;
  localPath: string;
  createdAt: string;
  updatedAt: string;
  prompts: string[];
  negativePrompts: string[];
  checkAdvice: string[];
  reviewNotes: string[];
};

const finishedContentsSeed: FinishedContent[] = [
  {
    id: "CP-20260709-001",
    title: "夏天通勤防晒喷雾，包里常备这一支",
    summary: "早八通勤和午休外出前的轻量补防晒流程，适合收藏复用。",
    body: "通勤包里我会固定放一支清爽型防晒喷雾，尤其是早八出门、午休下楼、下午通勤前，补涂会比重新涂防晒霜更方便。重点不是喷得越多越好，而是先吸油、避开眼周、距离脸部一掌左右，最后等成膜再出门。",
    platform: "小红书",
    platformBadge: "RED",
    account: "白桃养肤记",
    type: "小红书长图文",
    mediaCount: "9 张图",
    mediaKind: "image",
    tags: ["通勤防晒", "防晒喷雾", "夏天护肤", "不黏腻", "补涂防晒"],
    duplicateRate: 12,
    duplicateLabel: "低风险",
    lowFlowRisk: "低",
    status: "可发布",
    localPath: "outputs/xhs_01_baitao_yangfuji/2026-07-09/001_夏天通勤防晒喷雾",
    createdAt: "2026-07-09 09:30",
    updatedAt: "2026-07-09 10:12",
    prompts: ["干净通勤桌面，防晒喷雾和帆布包，橙白色清爽护肤科普风长图。"],
    negativePrompts: ["不要夸张磨皮，不要医疗功效表达，不要过度广告化。"],
    checkAdvice: ["标题与历史选题区分度良好", "产品植入较自然", "建议保留收藏清单页"]
  ,
    reviewNotes: ["2026-07-09 10:05 王欣审核通过", "无返工记录"]
  },
  {
    id: "CP-20260709-002",
    title: "敏感肌防晒不要乱选，先看这 5 个点",
    summary: "面向混油敏和混干敏的防晒避坑清单，语气温柔理性。",
    body: "敏感肌选防晒，不要只看热门和肤感。先看刺激风险、成膜方式、是否容易搓泥、是否需要卸妆、以及真实使用场景。尤其换季时，先小面积试用再上脸，会比盲买热门款更稳。",
    platform: "小红书",
    platformBadge: "RED",
    account: "叙妍欧尼吖",
    type: "小红书短图文",
    mediaCount: "4 张图",
    mediaKind: "image",
    tags: ["敏感肌防晒", "防晒避坑", "混油敏", "温和护肤"],
    duplicateRate: 18,
    duplicateLabel: "低风险",
    lowFlowRisk: "低",
    status: "已保存本地",
    localPath: "outputs/xhs_02_xuyan_ouniya/2026-07-09/002_敏感肌防晒避坑",
    createdAt: "2026-07-09 11:20",
    updatedAt: "2026-07-09 11:48",
    prompts: ["敏感肌护肤备忘录风，浅蓝白背景，5 点清单式排版。"],
    negativePrompts: ["不要绝对化功效，不要刺激前后对比图。"],
    checkAdvice: ["合规风险低", "缺少评论引导，可在结尾补一句提问"],
    reviewNotes: ["2026-07-09 11:40 已保存本地", "等待二次人工复核封面"]
  },
  {
    id: "CP-20260709-003",
    title: "防晒补涂 30 秒流程",
    summary: "小红书短视频口播脚本，拆成 6 个镜头，适合收藏和评论互动。",
    body: "夏天补防晒不要直接往脸上糊。先轻轻吸掉浮油，再少量多次补喷，避开眼周，等它成膜后再出门。这个流程 30 秒就够，通勤和午休外出都能用。",
    platform: "小红书",
    platformBadge: "RED",
    account: "小英家的牛",
    type: "小红书短视频",
    mediaCount: "6 个镜头 / 1 条成片",
    mediaKind: "video",
    tags: ["SPF reapply", "sun care", "summer routine", "skincare tips"],
    duplicateRate: 24,
    duplicateLabel: "中低风险",
    lowFlowRisk: "中",
    status: "需复查",
    localPath: "outputs/xhs_04_xiaoying_niu/2026-07-09/003_防晒补涂30秒流程",
    createdAt: "2026-07-09 13:10",
    updatedAt: "2026-07-09 13:36",
    prompts: ["Vertical clean skincare routine, hand-held sunscreen spray, fast cuts, natural daylight."],
    negativePrompts: ["No medical claims, no exaggerated whitening result."],
    checkAdvice: ["英文口播节奏偏快", "建议复查字幕断句", "低流量风险中等"],
    reviewNotes: ["2026-07-09 13:35 进入需复查", "待补充更自然的开场镜头"]
  },
  {
    id: "CP-20260709-004",
    title: "村头公主的包里防晒",
    summary: "素人生活感种草图文，突出真实包内常备用法。",
    body: "我这种出门经常忘补防晒的人，包里必须放一支顺手的。不是说它多神，而是夏天真的需要一个能随时拿出来补的东西。尤其下午出门买咖啡、等车、临时见朋友，补一下会安心很多。",
    platform: "小红书",
    platformBadge: "RED",
    account: "村头在逃公主",
    type: "素人种草图文",
    mediaCount: "6 张图",
    mediaKind: "image",
    tags: ["素人种草", "防晒好物", "包里常备", "真实分享"],
    duplicateRate: 15,
    duplicateLabel: "低风险",
    lowFlowRisk: "低",
    status: "可发布",
    localPath: "outputs/xhs_03_cuntou_princess/2026-07-09/004_包里防晒",
    createdAt: "2026-07-09 14:00",
    updatedAt: "2026-07-09 14:18",
    prompts: ["生活感自拍视角，帆布包内防晒喷雾，真实素人种草氛围。"],
    negativePrompts: ["不要精修商业大片感，不要夸张品牌露出。"],
    checkAdvice: ["素人感较强", "评论引导自然", "建议保留第一人称表达"],
    reviewNotes: ["2026-07-09 14:15 审核通过"]
  },
  {
    id: "CP-20260708-005",
    title: "油皮夏天怎么选不闷痘的防晒",
    summary: "油皮防晒选择逻辑，含质地、成膜和补涂建议。",
    body: "油皮夏天选防晒，先别被清爽两个字带跑。重点看成膜速度、后续出油状态、是否容易糊成一层，以及补涂时会不会搓泥。",
    platform: "小红书",
    platformBadge: "RED",
    account: "白桃养肤记",
    type: "小红书短视频",
    mediaCount: "5 个镜头 / 1 条成片",
    mediaKind: "video",
    tags: ["油皮防晒", "不闷痘", "夏季护肤"],
    duplicateRate: 31,
    duplicateLabel: "需复查",
    lowFlowRisk: "高",
    status: "已归档",
    localPath: "outputs/xhs_01_baitao_yangfuji/2026-07-08/005_油皮夏天防晒",
    createdAt: "2026-07-08 16:10",
    updatedAt: "2026-07-09 09:18",
    prompts: ["油皮护肤测评台面，质地展示，快节奏口播剪辑。"],
    negativePrompts: ["不要祛痘治疗暗示，不要医美前后对比。"],
    checkAdvice: ["低流量风险偏高", "标题可进一步降低泛化表达"],
    reviewNotes: ["2026-07-09 09:18 已归档"]
  }
];

const FINISHED_CONTENT_STORAGE_KEY = "content-production-studio-xhs.finished-content";
const DELETED_CONTENT_STORAGE_KEY = "content-production-studio-xhs.deleted-content-ids";
const CUSTOM_FOLDERS_STORAGE_KEY = "content-production-studio-xhs.content-library-folders";

const platformOptions = ["全部平台", "小红书"];
const publishPlatformOptions = feishuSyncPlatformOptions;
const fallbackPublishAccounts: Array<{ platform: string; name: string }> = [];
const publishAccounts = [
  ...productionAccounts.map((account) => ({ platform: account.platform, name: account.name })),
  ...fallbackPublishAccounts
];
const accountOptions = ["全部账号", "白桃养肤记", "叙妍欧尼吖", "村头在逃公主", "小英家的牛", "其他账号"];
const typeOptions = ["全部类型", "小红书长图文", "小红书短图文", "小红书短视频", "素人种草图文", "剪辑成片"];
const statusOptions = ["全部状态", "可发布", "已保存本地", "需复查", "已归档", "已淘汰"];
const timeOptions = ["今天", "近 7 天", "近 30 天", "自定义时间"];

function mockCover(item: FinishedContent) {
  if (item.mediaUrls?.[0] && !isStoredImageRef(item.mediaUrls[0])) return item.mediaUrls[0];
  const tone = item.mediaKind === "video" ? "#eef2ff" : "#fff7ed";
  const label = item.mediaKind === "video" ? "视频封面" : "图文封面";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${tone}"/><stop offset="1" stop-color="#e0f2fe"/></linearGradient></defs><rect width="360" height="480" rx="20" fill="url(#g)"/><rect x="34" y="54" width="292" height="292" rx="18" fill="white" fill-opacity=".72"/><circle cx="112" cy="150" r="38" fill="#fb923c" fill-opacity=".25"/><rect x="170" y="126" width="106" height="20" rx="10" fill="#fb923c" fill-opacity=".4"/><rect x="70" y="234" width="220" height="18" rx="9" fill="#0f172a" fill-opacity=".18"/><rect x="70" y="270" width="170" height="16" rx="8" fill="#0f172a" fill-opacity=".12"/><text x="180" y="398" text-anchor="middle" font-size="22" font-family="Arial, sans-serif" fill="#ea580c" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function finishedImageBlob(url: string) {
  const readableUrl = await imageRefToUploadUrl(url);
  if (!readableUrl) throw new Error("图片数据不存在");
  const response = await fetch(readableUrl);
  if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
  return response.blob();
}

function downloadFinishedImage(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function realMediaUrls(item: FinishedContent) {
  if (item.mediaKind !== "image") return [];
  return [
    ...(item.mediaUrls ?? []),
    ...(item.pages ?? []).flatMap((page) => page.images ?? [])
  ].filter((url) => url && !url.startsWith("data:image/svg+xml"));
}

function accountsForPlatform(platform: string) {
  const rows = publishAccounts.filter((account) => account.platform === platform).map((account) => account.name);
  return rows.length ? rows : [`${platform}待添加账号`];
}

function statusKey(status: LibraryStatus) {
  if (status === "可发布") return "publishable";
  if (status === "已保存本地") return "saved";
  if (status === "需复查") return "rework";
  if (status === "已归档") return "disabled";
  return "rejected";
}

function riskClass(level: RiskLevel) {
  if (level === "低") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (level === "中") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-red-50 text-red-700 ring-red-200";
}

export default function ContentLibraryPage() {
  const [items, setItems] = useState(finishedContentsSeed);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [detailItem, setDetailItem] = useState<FinishedContent | null>(null);
  const [editingItem, setEditingItem] = useState<FinishedContent | null>(null);
  const [activeFolder, setActiveFolder] = useState("全部成品");
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [publishPlatformMap, setPublishPlatformMap] = useState<Record<string, string>>({});
  const [publishAccountMap, setPublishAccountMap] = useState<Record<string, string>>({});
  const [resolvedMediaMap, setResolvedMediaMap] = useState<Record<string, string[]>>({});
  const [syncingFeishu, setSyncingFeishu] = useState(false);
  const [exportingLocal, setExportingLocal] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(FINISHED_CONTENT_STORAGE_KEY);
    const deletedIds = new Set(JSON.parse(window.localStorage.getItem(DELETED_CONTENT_STORAGE_KEY) || "[]") as string[]);
    const parsed = stored ? JSON.parse(stored) as FinishedContent[] : [];
    setItems([...parsed, ...finishedContentsSeed.filter((item) => !parsed.some((storedItem) => storedItem.id === item.id))]
      .filter((item) => item.platform === "小红书")
      .filter((item) => !deletedIds.has(item.id)));
    setCustomFolders(JSON.parse(window.localStorage.getItem(CUSTOM_FOLDERS_STORAGE_KEY) || "[]") as string[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(items.map(async (item) => [item.id, await resolveImageRefs(realMediaUrls(item))] as const)).then((rows) => {
      if (!cancelled) setResolvedMediaMap(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
  }, [items]);
  const [feedback, setFeedback] = useState("成品内容库已就绪，当前数据为本地 mock 完整作品。");
  const [filters, setFilters] = useState({ platform: "全部平台", account: "全部账号", type: "全部类型", status: "全部状态", time: "今天", keyword: "" });

  const filteredItems = useMemo(() => items.filter((item) => {
    const keyword = filters.keyword.trim().toLowerCase();
    return (filters.platform === "全部平台" || item.platform === filters.platform)
      && (filters.account === "全部账号" || item.account === filters.account)
      && (filters.type === "全部类型" || item.type === filters.type)
      && (filters.status === "全部状态" || item.status === filters.status)
      && (!keyword || `${item.title} ${item.body} ${item.tags.join(" ")} ${item.account} ${item.id}`.toLowerCase().includes(keyword));
  }), [filters, items]);
  const folderItems = useMemo(() => filteredItems.filter((item) => activeFolder === "全部成品" || item.account === activeFolder), [activeFolder, filteredItems]);
  const folders = ["全部成品", ...customFolders];

  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const stats = [
    ["全部成品", items.length, "bg-blue-50 text-blue-700"],
    ["今日新增", items.filter((item) => item.createdAt.startsWith("2026-07-09")).length, "bg-orange-50 text-orange-700"],
    ["可发布", items.filter((item) => item.status === "可发布").length, "bg-emerald-50 text-emerald-700"],
    ["已保存本地", items.filter((item) => item.status === "已保存本地").length, "bg-violet-50 text-violet-700"],
    ["需复查", items.filter((item) => item.status === "需复查").length, "bg-red-50 text-red-700"],
    ["已归档", items.filter((item) => item.status === "已归档").length, "bg-slate-100 text-slate-700"]
  ] as const;

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  };

  const toggleSelectionMode = () => {
    setSelectionMode((value) => {
      if (value) setSelectedIds([]);
      return !value;
    });
  };

  const updateStatus = (targetItems: FinishedContent[], status: LibraryStatus) => {
    const targetIds = new Set(targetItems.map((item) => item.id));
    setItems((current) => current.map((item) => targetIds.has(item.id) ? { ...item, status, updatedAt: "2026-07-09 14:35" } : item));
    setFeedback(`已将 ${targetItems.length} 条内容标记为：${status}`);
  };

  const deleteItems = (targetItems: FinishedContent[]) => {
    const targetIds = new Set(targetItems.map((item) => item.id));
    setItems((current) => current.filter((item) => !targetIds.has(item.id)));
    setSelectedIds((current) => current.filter((id) => !targetIds.has(id)));
    const stored = JSON.parse(window.localStorage.getItem(FINISHED_CONTENT_STORAGE_KEY) || "[]") as FinishedContent[];
    window.localStorage.setItem(FINISHED_CONTENT_STORAGE_KEY, JSON.stringify(stored.filter((item) => !targetIds.has(item.id))));
    const deletedIds = new Set(JSON.parse(window.localStorage.getItem(DELETED_CONTENT_STORAGE_KEY) || "[]") as string[]);
    targetItems.forEach((item) => deletedIds.add(item.id));
    window.localStorage.setItem(DELETED_CONTENT_STORAGE_KEY, JSON.stringify([...deletedIds]));
    setFeedback(`已删除 ${targetItems.length} 条成品内容。`);
  };

  const copyContent = async (item: FinishedContent) => {
    const text = `${item.title}\n\n${item.body}\n\n${item.tags.map((tag) => `#${tag}`).join(" ")}`;
    await navigator.clipboard?.writeText(text).catch(() => null);
    setFeedback(`已复制文案：${item.title}`);
  };

  const exportPackage = (targetItems: FinishedContent[]) => {
    const manifest = targetItems.map((item) => ({ 平台: item.platform, 账号: item.account, 标题: item.title, 内容类型: item.type, 本地路径: item.localPath, 状态: item.status }));
    console.table(manifest);
    setFeedback(`已生成 ${targetItems.length} 条内容包导出清单 mock。`);
  };

  const createFolder = () => {
    const name = window.prompt("请输入新文件夹名称");
    if (!name?.trim()) return;
    setCustomFolders((items) => {
      const next = [...new Set([...items, name.trim()])];
      window.localStorage.setItem(CUSTOM_FOLDERS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setActiveFolder(name.trim());
    setFeedback(`已新建文件夹：${name.trim()}`);
  };

  const deleteFolder = (folder: string) => {
    if (folder === "全部成品") return;
    setCustomFolders((items) => {
      const next = items.filter((item) => item !== folder);
      window.localStorage.setItem(CUSTOM_FOLDERS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    if (activeFolder === folder) setActiveFolder("全部成品");
    setFeedback(`已删除文件夹：${folder}`);
  };

  const getPublishPlatform = (item: FinishedContent) => publishPlatformMap[item.id] ?? (publishPlatformOptions.includes(item.platform) ? item.platform : "小红书");
  const getPublishAccount = (item: FinishedContent) => {
    const platform = getPublishPlatform(item);
    const options = accountsForPlatform(platform);
    return publishAccountMap[item.id] ?? (options.includes(item.account) ? item.account : options[0]);
  };
  const mediaUrlsFor = (item: FinishedContent) => resolvedMediaMap[item.id] ?? realMediaUrls(item).filter((url) => !isStoredImageRef(url));
  const coverUrlFor = (item: FinishedContent) => mediaUrlsFor(item)[0] ?? mockCover(item);
  const openEditor = (item: FinishedContent) => {
    const mediaUrls = realMediaUrls(item);
    setEditingItem({
      ...item,
      mediaUrls,
      pages: item.pages?.map((page) => ({ ...page, images: [] })),
      mediaCount: item.mediaKind === "image" ? `${mediaUrls.length} 张图` : item.mediaCount
    });
  };

  const syncContentToFeishu = async (item: FinishedContent, openAfterSync = true) => {
    const platform = getPublishPlatform(item);
    const accountName = getPublishAccount(item);
    setFeedback(`正在同步到飞书表：${item.title}`);
    const uploadImages = (await Promise.all(realMediaUrls(item).map((url) => imageRefToUploadUrl(url).catch(() => "")))).filter(Boolean);
    const response = await fetch("/api/feishu/sync-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        accountName,
        images: uploadImages,
        title: item.title,
        body: item.body,
        tags: item.tags
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.message || "飞书同步失败");
    const baseUrl = typeof data?.data?.baseUrl === "string" ? data.data.baseUrl : "";
    if (!baseUrl) throw new Error("飞书同步成功，但接口未返回目标表格地址");
    if (openAfterSync) window.open(baseUrl, "_blank", "noopener,noreferrer");
    const warnings = Array.isArray(data?.data?.warnings) ? data.data.warnings.filter(Boolean) : [];
    setFeedback(warnings.length ? `已同步文字到飞书，但图片上传有提示：${warnings[0]}` : `已同步到飞书表：${item.title}`);
    return baseUrl;
  };

  const syncSelectedContentsToFeishu = async () => {
    if (!selectedItems.length) {
      setFeedback("请先点击“多选”，再在成品卡片左上角勾选要同步的作品。");
      window.alert("请先点击“多选”，再在成品卡片左上角勾选要同步的作品。");
      return;
    }
    setSyncingFeishu(true);
    setFeedback(`正在同步 ${selectedItems.length} 条成品到飞书表，请稍等...`);
    try {
      let baseUrl = "";
      for (const item of selectedItems) {
        baseUrl = await syncContentToFeishu(item, false);
      }
      window.open(baseUrl, "_blank", "noopener,noreferrer");
      setFeedback(`已同步 ${selectedItems.length} 条成品到飞书表。`);
    } catch (error) {
      setFeedback(error instanceof Error ? `飞书同步失败：${error.message}` : "飞书同步失败。");
    } finally {
      setSyncingFeishu(false);
    }
  };

  const chooseLocalExportFolder = async () => {
    const targets = selectExportTargets(selectedItems, folderItems);
    if (!targets.length) {
      setFeedback("当前没有可导出的成品内容。");
      return;
    }
    setExportingLocal(true);
    const pickerWindow = window as Window & { showDirectoryPicker?: () => Promise<WritableDirectoryLike> };
    try {
      const rootDirectory = pickerWindow.showDirectoryPicker ? await pickerWindow.showDirectoryPicker() : null;
      let saved = 0;
      let failed = 0;

      for (const [itemIndex, item] of targets.entries()) {
        const imageUrls = realMediaUrls(item);
        const blobs = [{
          name: "标题和文案.txt",
          blob: utf8TextBlob(`标题：${item.title}\n\n文案：\n${item.body}`)
        }];
        for (const [imageIndex, imageUrl] of imageUrls.entries()) {
          try {
            const blob = await finishedImageBlob(imageUrl);
            blobs.push({
              name: `${String(imageIndex + 1).padStart(2, "0")}.${imageExtension(blob)}`,
              blob
            });
          } catch {
            failed += 1;
          }
        }

        if (rootDirectory) {
          const folderName = `${String(itemIndex + 1).padStart(2, "0")}_${safeFileName(item.title).slice(0, 80)}`;
          const itemDirectory = rootDirectory.getDirectoryHandle
            ? await rootDirectory.getDirectoryHandle(folderName, { create: true })
            : rootDirectory;
          const result = await writeBlobFiles(itemDirectory, rootDirectory.getDirectoryHandle
            ? blobs
            : blobs.map((file) => ({ ...file, name: `${folderName}_${file.name}` })));
          saved += result.saved;
          failed += result.failed;
          continue;
        }

        const prefix = `${String(itemIndex + 1).padStart(2, "0")}_${safeFileName(item.title).slice(0, 60)}`;
        blobs.forEach((file) => downloadFinishedImage(file.blob, `${prefix}_${file.name}`));
        saved += blobs.length;
      }

      setFeedback(rootDirectory
        ? `已导出 ${saved} 个文件到 ${rootDirectory.name}，每条作品文件夹均包含“标题和文案.txt”${failed ? `，${failed} 个文件失败` : ""}。`
        : `当前浏览器不支持直接写入文件夹，已下载 ${saved} 个文件，每条作品均包含标题和文案文本${failed ? `，${failed} 个文件失败` : ""}。`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFeedback(error instanceof Error ? `本地导出失败：${error.message}` : "本地导出失败，请重试。");
    } finally {
      setExportingLocal(false);
    }
  };

  const saveEdit = () => {
    if (!editingItem) return;
    const nextItem = {
      ...editingItem,
      updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      mediaCount: editingItem.mediaKind === "image" ? `${editingItem.mediaUrls?.length ?? 0} 张图` : editingItem.mediaCount
    };
    setItems((current) => {
      const nextItems = current.map((item) => item.id === nextItem.id ? nextItem : item);
      window.localStorage.setItem(FINISHED_CONTENT_STORAGE_KEY, JSON.stringify(nextItems));
      return nextItems;
    });
    setDetailItem((current) => current?.id === nextItem.id ? nextItem : current);
    setFeedback(`已保存内容修改：${editingItem.title}`);
    setEditingItem(null);
  };

  return (
    <>
      <PageHeader
        title="成品内容库"
        description="集中管理已通过审核、可发布、已保存本地和已归档的完整内容项目。"
        action={
          <div className="flex gap-2">
            <Button className={viewMode === "cards" ? "bg-orange-50 text-orange-700" : ""} icon={<Grid2X2 className="h-4 w-4" />} onClick={() => setViewMode("cards")}>卡片视图</Button>
            <Button className={viewMode === "table" ? "bg-orange-50 text-orange-700" : ""} icon={<ListChecks className="h-4 w-4" />} onClick={() => setViewMode("table")}>表格视图</Button>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {stats.map(([label, value, className]) => (
          <Card key={label}>
            <CardBody>
              <p className="text-sm text-muted">{label}</p>
              <p className={cn("mt-3 inline-flex rounded-md px-3 py-1 text-2xl font-semibold", className)}>{value}</p>
            </CardBody>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader title="筛选区" subtitle="按平台、账号、类型、状态和关键词筛选完整作品。" />
        <CardBody className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Select value={filters.platform} options={platformOptions} onChange={(value) => setFilters((current) => ({ ...current, platform: value }))} />
          <Select value={filters.account} options={accountOptions} onChange={(value) => setFilters((current) => ({ ...current, account: value }))} />
          <Select value={filters.type} options={typeOptions} onChange={(value) => setFilters((current) => ({ ...current, type: value }))} />
          <Select value={filters.status} options={statusOptions} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} />
          <Select value={filters.time} options={timeOptions} onChange={(value) => setFilters((current) => ({ ...current, time: value }))} />
          <input value={filters.keyword} onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))} placeholder="搜索标题 / 文案 / 标签 / 账号 / 项目编号" className="h-10 rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" />
          <div className="flex gap-2 xl:col-span-6">
            <Button onClick={() => setFilters({ platform: "全部平台", account: "全部账号", type: "全部类型", status: "全部状态", time: "今天", keyword: "" })}>重置</Button>
            <Button variant="primary" onClick={() => setFeedback(`已筛选出 ${filteredItems.length} 条成品内容。`)}>筛选</Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => exportPackage(filteredItems)}>批量导出</Button>
          </div>
        </CardBody>
      </Card>

      <p className={cn("rounded-lg border px-4 py-3 text-sm", feedback.includes("失败") ? "border-red-200 bg-red-50 text-red-700" : feedback.includes("正在") ? "border-orange-200 bg-orange-50 text-orange-700" : "border-line bg-white text-muted")}>{feedback}</p>

      <section className="grid min-h-[680px] gap-5 xl:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader
            title="页面文件夹"
            subtitle="可新建文件夹，也可删除自建文件夹。"
            action={<Button className="h-8 px-2 text-xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={createFolder}>新建</Button>}
          />
          <CardBody className="space-y-2">
            {folders.map((folder) => {
              const count = folder === "全部成品" ? filteredItems.length : filteredItems.filter((item) => item.account === folder).length;
              return (
                <div key={folder} className={cn("flex items-center gap-1 rounded-md border px-3 py-2 text-sm transition", activeFolder === folder ? "border-orange-200 bg-orange-50 text-orange-700" : "border-line bg-white text-muted hover:bg-slate-50 hover:text-ink")}>
                  <button onClick={() => setActiveFolder(folder)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate">{folder}</span>
                  </button>
                  <span className="text-xs">{count}</span>
                  {folder !== "全部成品" ? (
                    <button onClick={() => deleteFolder(folder)} className="ml-1 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="删除文件夹">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={`${activeFolder} · 成品预览`}
            subtitle="每条作品按标题、文案、标签和真实生成图片打包展示。"
            action={
              <div className="flex flex-wrap gap-2">
                <Button onClick={toggleSelectionMode}>{selectionMode ? "退出多选" : "多选"}</Button>
                <Button icon={<ExternalLink className="h-4 w-4" />} disabled={syncingFeishu} onClick={() => void syncSelectedContentsToFeishu()}>{syncingFeishu ? "同步中..." : `同步到飞书${selectedItems.length ? `（${selectedItems.length}）` : ""}`}</Button>
                <Button variant="primary" icon={<Download className="h-4 w-4" />} disabled={exportingLocal} onClick={() => void chooseLocalExportFolder()}>{exportingLocal ? "导出中..." : "导出到本地文件夹"}</Button>
              </div>
            }
          />
          <CardBody className="space-y-4">
            {folderItems.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                {folderItems.map((item) => {
                  const images = mediaUrlsFor(item);
                  const publishPlatform = getPublishPlatform(item);
                  const publishAccount = getPublishAccount(item);
                  const publishAccountOptions = accountsForPlatform(publishPlatform);
                  const selected = selectedIds.includes(item.id);
                  return (
                    <article key={item.id} className={cn("relative overflow-hidden rounded-lg border bg-white transition hover:border-orange-200 hover:shadow-sm", selected ? "border-orange-300 ring-2 ring-orange-100" : "border-line")}>
                      {selectionMode ? (
                        <label className="absolute left-3 top-3 z-10 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-white/95 shadow-sm ring-1 ring-line">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) => toggleSelected(item.id, event.target.checked)}
                            className="h-4 w-4 accent-orange-500"
                            aria-label={`选择 ${item.title}`}
                          />
                        </label>
                      ) : null}
                      <div className="space-y-3 p-4">
                        <div>
                          <p className="text-xs text-muted">{item.account} · {item.platform}</p>
                          <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-6 text-ink">{item.title}</h3>
                        </div>
                        <div className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-ink">{item.body}</div>
                        <TagList tags={item.tags} />
                        <label className="block text-xs font-medium text-muted">
                          发布平台
                          <select
                            value={publishPlatform}
                            onChange={(event) => {
                              const platform = event.target.value;
                              setPublishPlatformMap((current) => ({ ...current, [item.id]: platform }));
                              setPublishAccountMap((current) => ({ ...current, [item.id]: accountsForPlatform(platform)[0] }));
                            }}
                            className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-orange-300"
                          >
                            {publishPlatformOptions.map((platform) => <option key={platform}>{platform}</option>)}
                          </select>
                        </label>
                        <label className="block text-xs font-medium text-muted">
                          发布账号
                          <select
                            value={publishAccount}
                            onChange={(event) => setPublishAccountMap((current) => ({ ...current, [item.id]: event.target.value }))}
                            className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-ink outline-none focus:border-orange-300"
                          >
                            {publishAccountOptions.map((account) => <option key={account}>{account}</option>)}
                          </select>
                        </label>
                      </div>
                      {images.length ? (
                        <div className="grid grid-cols-3 gap-1 border-t border-line bg-slate-50 p-2">
                          {images.slice(0, 9).map((url, index) => (
                            <button key={`${item.id}-${url}-${index}`} onClick={() => setPreviewImageUrl(url)} className="overflow-hidden rounded-md bg-white" title={`放大 P${index + 1}`}>
                              <img src={url} alt={`${item.title} P${index + 1}`} className="aspect-[3/4] w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="border-t border-line bg-slate-50 px-4 py-6 text-center text-xs text-muted">
                          暂无真实生成图片，请从图文生产重新预览并打包。
                        </div>
                      )}
                      <div className="flex justify-end gap-2 border-t border-line p-3">
                        <Button icon={<Edit3 className="h-4 w-4" />} onClick={() => openEditor(item)}>编辑</Button>
                        <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => deleteItems([item])}>删除</Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-80 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-muted">当前文件夹暂无内容</div>
            )}
          </CardBody>
        </Card>
      </section>

      <div className="hidden">
      {selectedItems.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <span className="font-medium">已选择 {selectedItems.length} 条</span>
          <Button onClick={() => exportPackage(selectedItems)}>批量导出</Button>
          <Button onClick={() => updateStatus(selectedItems, "已归档")}>批量标记已归档</Button>
          <Button onClick={() => updateStatus(selectedItems, "需复查")}>批量移动到需复查</Button>
          <Button onClick={() => deleteItems(selectedItems)}>批量删除</Button>
          <Button onClick={() => { void navigator.clipboard?.writeText(selectedItems.map((item) => item.title).join("\n")); setFeedback("已批量复制标题。"); }}>批量复制标题</Button>
          <Button variant="primary" onClick={() => exportPackage(selectedItems)}>批量生成发布清单</Button>
        </div>
      ) : null}

      {viewMode === "table" ? (
        <DataTable headers={["", "内容预览", "标题", "平台 / 账号", "内容类型", "图片/视频数量", "标签", "查重分", "低流量风险", "状态", "本地路径", "更新时间", "操作"]}>
          {filteredItems.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-3"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => toggleSelected(item.id, event.target.checked)} className="h-4 w-4 accent-orange-500" /></td>
              <td className="px-4 py-3"><button onClick={() => setPreviewImageUrl(coverUrlFor(item))} title="放大图片"><img src={coverUrlFor(item)} alt={item.title} className="h-16 w-12 rounded-md object-cover" /></button></td>
              <td className="min-w-72 px-4 py-3"><p className="font-medium text-ink">{item.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{item.summary}</p></td>
              <td className="px-4 py-3"><div className="flex items-center gap-2"><PlatformBadge badge={item.platformBadge} platform={item.platform} /><div><p className="text-sm text-ink">{item.platform}</p><p className="text-xs text-muted">{item.account}</p></div></div></td>
              <td className="px-4 py-3 text-muted">{item.type}</td>
              <td className="px-4 py-3 text-muted">{item.mediaCount}</td>
              <td className="min-w-44 px-4 py-3"><TagList tags={item.tags} /></td>
              <td className="px-4 py-3"><p className="text-sm text-ink">重复率 {item.duplicateRate}%</p><p className="text-xs text-muted">{item.duplicateLabel}</p></td>
              <td className="px-4 py-3"><span className={cn("rounded-full px-2.5 py-1 text-xs font-medium ring-1", riskClass(item.lowFlowRisk))}>{item.lowFlowRisk}</span></td>
              <td className="px-4 py-3"><StatusBadge status={statusKey(item.status)} label={item.status} /></td>
              <td className="max-w-56 truncate px-4 py-3 text-xs text-muted" title={item.localPath}>{item.localPath}</td>
              <td className="px-4 py-3 text-muted">{item.updatedAt}</td>
              <td className="px-4 py-3"><RowActions item={item} onDetail={setDetailItem} onEdit={openEditor} onCopy={copyContent} onExport={(row) => exportPackage([row])} onArchive={(row) => updateStatus([row], "已归档")} onMore={(row, action) => updateStatus([row], action)} onDelete={(row) => deleteItems([row])} onFeedback={setFeedback} /></td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {filteredItems.map((item) => (
            <Card key={item.id}>
              <CardBody>
                <div className="relative overflow-hidden rounded-lg bg-slate-50">
                  <button onClick={() => setPreviewImageUrl(coverUrlFor(item))} className="block w-full" title="放大图片"><img src={coverUrlFor(item)} alt={item.title} className="h-56 w-full object-cover" /></button>
                  <div className="absolute left-3 top-3 flex gap-2"><PlatformBadge badge={item.platformBadge} platform={item.platform} /><StatusBadge status={statusKey(item.status)} label={item.status} /></div>
                  <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-ink">{item.type}</span>
                </div>
                <h3 className="mt-3 line-clamp-2 text-base font-semibold text-ink">{item.title}</h3>
                <p className="mt-1 text-sm text-muted">{item.account} · {item.mediaCount}</p>
                <div className="mt-3"><TagList tags={item.tags} /></div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted"><span>重复率 {item.duplicateRate}%</span><span>{item.updatedAt}</span></div>
                <div className="mt-4 grid grid-cols-6 gap-2">
                  <IconButton title="查看详情" icon={<Eye className="h-4 w-4" />} onClick={() => setDetailItem(item)} />
                  <IconButton title="编辑内容" icon={<Edit3 className="h-4 w-4" />} onClick={() => openEditor(item)} />
                  <IconButton title="复制文案" icon={<Copy className="h-4 w-4" />} onClick={() => void copyContent(item)} />
                  <IconButton title="导出内容包" icon={<Download className="h-4 w-4" />} onClick={() => exportPackage([item])} />
                  <IconButton title="进入初检查重" icon={<FileCheck2 className="h-4 w-4" />} onClick={() => { window.location.href = `/detection?contentId=${encodeURIComponent(item.id)}`; }} />
                  <IconButton title="更多操作" icon={<MoreHorizontal className="h-4 w-4" />} onClick={() => updateStatus([item], "需复查")} />
                </div>
              </CardBody>
            </Card>
          ))}
        </section>
      )}

      </div>

      {detailItem ? <DetailDrawer item={detailItem} mediaUrls={mediaUrlsFor(detailItem)} onClose={() => setDetailItem(null)} onEdit={openEditor} onCopy={copyContent} onExport={(item) => exportPackage([item])} onArchive={(item) => updateStatus([item], "已归档")} onFeedback={setFeedback} onPreview={setPreviewImageUrl} /> : null}
      {editingItem ? <EditModal item={editingItem} onChange={setEditingItem} onClose={() => setEditingItem(null)} onSave={saveEdit} onPreview={setPreviewImageUrl} /> : null}
      {previewImageUrl ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4" onClick={() => setPreviewImageUrl("")}>
          <div className="max-h-[92vh] max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex justify-end border-b border-line px-4 py-3"><button onClick={() => setPreviewImageUrl("")} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-slate-100">关闭</button></div>
            <div className="max-h-[84vh] overflow-auto bg-slate-50 p-4"><img src={previewImageUrl} alt="成品图片放大预览" className="mx-auto max-h-[78vh] max-w-full rounded-md object-contain" /></div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">{options.map((option) => <option key={option}>{option}</option>)}</select>;
}

function TagList({ tags }: { tags: string[] }) {
  return <div className="flex flex-wrap gap-1">{tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{tag}</span>)}{tags.length > 3 ? <span className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-700">+{tags.length - 3}</span> : null}</div>;
}

function IconButton({ title, icon, onClick }: { title: string; icon: React.ReactNode; onClick: () => void }) {
  return <button title={title} aria-label={title} onClick={onClick} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-muted transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700">{icon}</button>;
}

function RowActions({ item, onDetail, onEdit, onCopy, onExport, onArchive, onMore, onDelete, onFeedback }: { item: FinishedContent; onDetail: (item: FinishedContent) => void; onEdit: (item: FinishedContent) => void; onCopy: (item: FinishedContent) => void; onExport: (item: FinishedContent) => void; onArchive: (item: FinishedContent) => void; onMore: (item: FinishedContent, action: LibraryStatus) => void; onDelete: (item: FinishedContent) => void; onFeedback: (value: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <IconButton title="查看详情" icon={<Eye className="h-4 w-4" />} onClick={() => onDetail(item)} />
      <IconButton title="编辑内容" icon={<Edit3 className="h-4 w-4" />} onClick={() => onEdit(item)} />
      <IconButton title="打开本地文件夹" icon={<FolderOpen className="h-4 w-4" />} onClick={() => onFeedback(`已定位到本地文件夹：${item.localPath}`)} />
      <IconButton title="复制文案" icon={<Copy className="h-4 w-4" />} onClick={() => void onCopy(item)} />
      <IconButton title="导出内容包" icon={<Download className="h-4 w-4" />} onClick={() => onExport(item)} />
      <IconButton title="进入初检查重" icon={<FileCheck2 className="h-4 w-4" />} onClick={() => { window.location.href = `/detection?contentId=${encodeURIComponent(item.id)}`; }} />
      <IconButton title="标记已归档" icon={<Archive className="h-4 w-4" />} onClick={() => onArchive(item)} />
      <div className="group relative inline-flex h-8 w-8">
        <button title="更多操作" aria-label="更多操作" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-muted transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700">
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <span className="invisible absolute right-0 top-8 z-20 w-32 rounded-md border border-line bg-white p-1 text-left text-xs text-muted shadow-lg group-hover:visible">
          <button className="block w-full rounded px-2 py-1 text-left hover:bg-slate-50" onClick={() => onFeedback("已重新检测，检测报告为 mock 结果。")}><RotateCcw className="mr-1 inline h-3 w-3" />重新检测</button>
          <button className="block w-full rounded px-2 py-1 text-left hover:bg-slate-50" onClick={() => onMore(item, "需复查")}>移入需复查</button>
          <button className="block w-full rounded px-2 py-1 text-left hover:bg-slate-50" onClick={() => onMore(item, "已淘汰")}>移入已淘汰</button>
          <button className="block w-full rounded px-2 py-1 text-left text-red-600 hover:bg-red-50" onClick={() => onDelete(item)}><Trash2 className="mr-1 inline h-3 w-3" />删除项目</button>
        </span>
      </div>
    </div>
  );
}

function DetailDrawer({ item, mediaUrls, onClose, onEdit, onCopy, onExport, onArchive, onFeedback, onPreview }: { item: FinishedContent; mediaUrls: string[]; onClose: () => void; onEdit: (item: FinishedContent) => void; onCopy: (item: FinishedContent) => void; onExport: (item: FinishedContent) => void; onArchive: (item: FinishedContent) => void; onFeedback: (value: string) => void; onPreview: (url: string) => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/20" onClick={onClose}>
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-white px-5 py-4">
          <div><h2 className="text-lg font-semibold text-ink">{item.title}</h2><p className="mt-1 text-sm text-muted">{item.id} · {item.platform} · {item.account}</p></div>
          <button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-5">
          <DetailSection title="基础信息" items={[["项目编号", item.id], ["平台", item.platform], ["目标账号", item.account], ["内容类型", item.type], ["状态", item.status], ["创建时间", item.createdAt], ["更新时间", item.updatedAt]]} />
          <Card><CardHeader title="内容正文" /><CardBody><h3 className="font-semibold text-ink">{item.title}</h3><p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted">{item.body}</p><div className="mt-3"><TagList tags={item.tags} /></div></CardBody></Card>
          <Card><CardHeader title="素材预览" /><CardBody><div className="grid grid-cols-3 gap-2">{(mediaUrls.length ? mediaUrls : [mockCover(item)]).slice(0, 9).map((url, index) => <button key={`${url}-${index}`} onClick={() => onPreview(url)} title={`放大素材 ${index + 1}`}><img src={url} alt={`${item.title} 素材 ${index + 1}`} className="h-28 w-full rounded-md object-cover" /></button>)}</div><p className="mt-3 text-sm text-muted">{item.mediaCount}</p></CardBody></Card>
          <Card><CardHeader title="提示词" /><CardBody className="space-y-3">{item.prompts.map((prompt) => <p key={prompt} className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-muted">{prompt}</p>)}{item.negativePrompts.map((prompt) => <p key={prompt} className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">反向：{prompt}</p>)}</CardBody></Card>
          <DetailSection title="检测结果" items={[["重复率", `${item.duplicateRate}%`], ["同质化", item.duplicateLabel], ["合规风险", "低"], ["低流量风险", item.lowFlowRisk], ["检测建议", item.checkAdvice.join("；")]]} />
          <Card><CardHeader title="本地文件" /><CardBody className="space-y-3"><p className="rounded-lg bg-slate-50 p-3 text-sm text-muted">{item.localPath}</p><div className="flex gap-2"><Button onClick={() => onFeedback(`已定位到本地文件夹：${item.localPath}`)}>打开本地文件夹</Button><Button onClick={() => onExport(item)}>导出内容包</Button></div></CardBody></Card>
          <Card><CardHeader title="审核记录" /><CardBody className="space-y-2">{item.reviewNotes.map((note) => <p key={note} className="rounded-lg border border-line p-3 text-sm text-muted">{note}</p>)}</CardBody></Card>
        </div>
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-white px-5 py-4">
          <Button onClick={() => onEdit(item)}>编辑内容</Button>
          <Button onClick={() => void onCopy(item)}>复制文案</Button>
          <Button onClick={() => onExport(item)}>导出内容包</Button>
          <Button variant="success" onClick={() => { window.location.href = `/detection?contentId=${encodeURIComponent(item.id)}`; }}>进入初检查重</Button>
          <Button variant="primary" onClick={() => onArchive(item)}>标记已归档</Button>
          <Button onClick={onClose}>关闭</Button>
        </div>
      </aside>
    </div>
  );
}

function DetailSection({ title, items }: { title: string; items: [string, string][] }) {
  return <Card><CardHeader title={title} /><CardBody className="grid gap-3 md:grid-cols-2">{items.map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-sm font-medium text-ink">{value}</p></div>)}</CardBody></Card>;
}

function EditModal({ item, onChange, onClose, onSave, onPreview }: { item: FinishedContent; onChange: (item: FinishedContent) => void; onClose: () => void; onSave: () => void; onPreview: (url: string) => void }) {
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});
  const [draggingImageUrl, setDraggingImageUrl] = useState("");
  const [uploadingImages, setUploadingImages] = useState(false);
  const mediaUrls = item.mediaUrls ?? [];

  useEffect(() => {
    let cancelled = false;
    void Promise.all(mediaUrls.map(async (url) => [url, await resolveImageRef(url)] as const)).then((rows) => {
      if (!cancelled) setResolvedUrls(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
  }, [mediaUrls]);

  const uploadImages = async (files: FileList | null) => {
    const imageFiles = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    setUploadingImages(true);
    try {
      const uploadedUrls = await Promise.all(imageFiles.map((file, index) => persistImageFile(file, `library_edit_${item.id}_${Date.now()}_${index}`)));
      const nextUrls = [...uploadedUrls, ...mediaUrls];
      onChange({ ...item, mediaUrls: nextUrls, mediaCount: `${nextUrls.length} 张图` });
    } finally {
      setUploadingImages(false);
    }
  };

  const deleteImage = (url: string) => {
    const nextUrls = mediaUrls.filter((itemUrl) => itemUrl !== url);
    onChange({ ...item, mediaUrls: nextUrls, mediaCount: `${nextUrls.length} 张图` });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-line px-5 py-4"><div><h2 className="text-lg font-semibold text-ink">编辑内容</h2><p className="mt-1 text-sm text-muted">{item.id}</p></div><button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block text-sm font-medium text-ink">标题<input value={item.title} onChange={(event) => onChange({ ...item, title: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" /></label>
          <label className="block text-sm font-medium text-ink">正文 / 口播<textarea value={item.body} onChange={(event) => onChange({ ...item, body: event.target.value })} className="mt-2 min-h-36 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></label>
          <label className="block text-sm font-medium text-ink">标签<input value={item.tags.join("、")} onChange={(event) => onChange({ ...item, tags: event.target.value.split(/[、,\s]+/).filter(Boolean) })} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" /></label>
          {item.mediaKind === "image" ? (
            <section className="rounded-lg border border-line bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">作品图片</h3>
                  <p className="mt-1 text-xs text-muted">拖动图片可调整顺序；点击图片可放大，右上角可删除图片。</p>
                </div>
                <div>
                  <input
                    id={`library-edit-upload-${item.id}`}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      const input = event.currentTarget;
                      void uploadImages(input.files).finally(() => {
                        input.value = "";
                      });
                    }}
                  />
                  <Button disabled={uploadingImages} icon={<Plus className="h-4 w-4" />} onClick={() => document.getElementById(`library-edit-upload-${item.id}`)?.click()}>
                    {uploadingImages ? "添加中..." : "添加本地图片"}
                  </Button>
                </div>
              </div>
              {mediaUrls.length ? (
                <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                  {mediaUrls.map((url, index) => {
                    const previewUrl = resolvedUrls[url] ?? (isStoredImageRef(url) ? "" : url);
                    return (
                      <div
                        key={`${url}-${index}`}
                        draggable
                        onDragStart={() => setDraggingImageUrl(url)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (!draggingImageUrl) return;
                          const bounds = event.currentTarget.getBoundingClientRect();
                          const placement = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
                          onChange({ ...item, mediaUrls: reorderImageUrls(mediaUrls, draggingImageUrl, url, placement) });
                          setDraggingImageUrl("");
                        }}
                        onDragEnd={() => setDraggingImageUrl("")}
                        className={cn("relative cursor-grab overflow-hidden rounded-lg border border-line bg-white active:cursor-grabbing", draggingImageUrl === url ? "opacity-60" : "")}
                      >
                        <button type="button" onClick={() => previewUrl && onPreview(previewUrl)} className="block w-full" title={`放大图片 ${index + 1}`}>
                          {previewUrl ? <img src={previewUrl} alt={`${item.title} 图片 ${index + 1}`} className="aspect-[3/4] w-full object-cover" /> : <span className="grid aspect-[3/4] place-items-center text-xs text-muted">读取中...</span>}
                        </button>
                        <button
                          type="button"
                          title="删除图片"
                          aria-label={`删除图片 ${index + 1}`}
                          onClick={() => deleteImage(url)}
                          className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-slate-950/75 text-sm leading-none text-white hover:bg-red-600"
                        >
                          ×
                        </button>
                        <p className="px-2 py-1 text-center text-[11px] text-muted">第 {index + 1} 张</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 flex h-24 items-center justify-center rounded-lg border border-dashed border-line bg-white text-xs text-muted">暂无图片，可从本地添加。</div>
              )}
            </section>
          ) : null}
          <label className="block text-sm font-medium text-ink">提示词<textarea value={item.prompts.join("\n")} onChange={(event) => onChange({ ...item, prompts: event.target.value.split(/\n+/).filter(Boolean) })} className="mt-2 min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></label>
          <label className="block text-sm font-medium text-ink">备注<textarea value={item.reviewNotes.join("\n")} onChange={(event) => onChange({ ...item, reviewNotes: event.target.value.split(/\n+/).filter(Boolean) })} className="mt-2 min-h-20 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4"><Button onClick={onClose}>取消</Button><Button variant="primary" onClick={onSave}>保存修改</Button></div>
      </div>
    </div>
  );
}
