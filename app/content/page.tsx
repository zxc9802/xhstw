"use client";

import { type DragEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { FileText, FolderOpen, ImagePlus, Link2, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { accounts, copyCandidates, imagePlans, referenceSources, titleCandidates, trafficTags, videoExtraction, videoScriptRows, videoShots } from "@/lib/mock/data";
import { imageExtension, writeBlobFiles, type WritableDirectoryLike } from "@/lib/utils/browser-file-export";
import { cn } from "@/lib/utils/cn";
import { imageRefToUploadUrl, isStoredImageRef, persistImageFile, persistImageRefs, resolveImageRef } from "@/lib/utils/image-store";
import { appendMaterialLibrary, createLibraryAsset, getAssetBlob, readMaterialLibrary, type LibraryAsset } from "@/lib/utils/material-library";
import { loadVersionedState, saveVersionedState } from "@/lib/utils/local-state";
import { readProductLibrary, type ProductLibraryItem } from "@/lib/utils/product-library";
import { loadGeneratedImages, saveGeneratedImages } from "@/lib/utils/image-generation-history";
import { addKeywordValues, removeKeywordValue, reorderAssignedImages, withoutSelectedKeywords } from "@/lib/utils/production-workflow";
import type { ImagePlanItem, ImageProvider } from "@/types/image";
import type { VideoProvider, VideoScriptRow, VideoShotPlan } from "@/types/video";

type MainTab = "图文内容" | "视频内容";
type ImageStep = "发布文案生成" | "图片生成";
type VideoStep = "发布文案生成" | "视频脚本生成" | "视频素材生成";

const imageSteps: ImageStep[] = ["发布文案生成", "图片生成"];
const videoSteps: VideoStep[] = ["发布文案生成", "视频脚本生成", "视频素材生成"];
const imageProviders: ImageProvider[] = ["Image 2.0", "Nano Banana 2", "仅生成提示词，不直接生图"];
const videoProviders: VideoProvider[] = ["Seedance 2.0", "仅生成分镜提示词，不直接生成视频"];
const actionLinkClass = "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink transition hover:border-orange-200 hover:bg-orange-50";
const FINISHED_CONTENT_STORAGE_KEY = "content-production-studio-xhs.finished-content";
const REFERENCE_HISTORY_STORAGE_KEY = "content-production-studio-xhs.reference-history";
const GENERATED_IMAGES_STORAGE_KEY = "content-production-studio-xhs.generated-images";
const KEYWORD_LIBRARY_STORAGE_KEY = "content-production-studio.keyword-library";
const IMAGE_DRAFT_STORAGE_KEY = "content-production-studio.image-draft";
const LOCAL_STATE_VERSION = 1;
const defaultImagePlan: ImagePlanItem = { ...imagePlans[0], status: "pending" };
const keywordLibrary = [
  "通勤防晒",
  "防晒喷雾",
  "防晒霜",
  "防晒推荐",
  "油皮防晒",
  "夏天护肤",
  "不泛白",
  "不黏腻",
  "学生党防晒",
  "补涂防晒",
  "护肤好物",
  "敏感肌防晒",
  "防晒避坑",
  "清爽肤感",
  "小红书种草",
  "真实分享"
];

type ReferenceRow = {
  id: string;
  platform: string;
  title: string;
  author: string;
  time: string;
  likes: string;
  saves: string;
  comments: string;
  status: string;
  reason: string;
  url?: string;
  copy?: string;
  media?: ParsedReferenceMedia[];
};

type ParsedReferenceMedia = {
  type: "image" | "video";
  url: string;
  name: string;
};

type ParsedReference = {
  platform: string;
  title: string;
  author: string;
  copy: string;
  url: string;
  media: ParsedReferenceMedia[];
};

type GeneratedImagePreview = {
  id: string;
  planPage: number;
  url: string;
  provider: string;
  storageUrl?: string;
};

type GeneratedVideoPreview = {
  id: string;
  shotNo: number;
  url: string;
  provider: string;
};

type ImageSourceAsset = ParsedReferenceMedia & {
  source: "链接解析" | "本地上传" | "素材库" | "产品素材库";
  storageUrl?: string;
};

function productLibraryKey(product: ProductLibraryItem, index: number) {
  return product.id || `${product.name || "product"}_${index}`;
}

type BatchDraft = {
  id: string;
  title: string;
  copy: string;
  tags: string[];
  style: string;
};

type ImageProductionDraft = {
  imageStep: ImageStep;
  selectedBatchDrafts: BatchDraft[];
  activeBatchIndex: number;
  draftTitle: string;
  draftCopy: string;
  targetAccount: string;
  contentType: string;
  imageCount: string;
  imageProvider: ImageProvider;
  imagePlanItems: ImagePlanItem[];
  activeImagePage: number;
  imagePromptText: string;
  imageSize: string;
  generateCount: string;
  productImage: ({ name: string; url: string; storageUrl?: string } | null);
  localImageSources: ImageSourceAsset[];
  libraryImageSources: ImageSourceAsset[];
  productImageSources: ImageSourceAsset[];
  selectedProductId: string;
  planSourceMap: Record<number, ImageSourceAsset[]>;
  planPromptMap: Record<number, string>;
  planSizeMap: Record<number, string>;
  planCountMap: Record<number, string>;
  planProviderMap: Record<number, ImageProvider>;
  parsedReference: ParsedReference | null;
};

function detectPlatformFromUrl(url: string) {
  if (url.includes("xiaohongshu.com")) return "小红书";
  return "小红书";
}

function mockSvg(label: string, tone = "#fff7ed") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${tone}"/><stop offset="1" stop-color="#e0f2fe"/></linearGradient></defs><rect width="720" height="960" rx="36" fill="url(#g)"/><rect x="64" y="82" width="592" height="680" rx="30" fill="white" fill-opacity=".72"/><circle cx="178" cy="220" r="66" fill="#fb923c" fill-opacity=".22"/><rect x="270" y="190" width="270" height="34" rx="17" fill="#fb923c" fill-opacity=".35"/><rect x="150" y="330" width="420" height="28" rx="14" fill="#0f172a" fill-opacity=".18"/><rect x="150" y="382" width="360" height="24" rx="12" fill="#0f172a" fill-opacity=".12"/><text x="360" y="826" text-anchor="middle" font-size="38" font-family="Arial, sans-serif" fill="#ea580c" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function generatedImageKey(image: GeneratedImagePreview) {
  return image.storageUrl ?? image.url;
}

function generatedImageForStorage(image: GeneratedImagePreview): GeneratedImagePreview {
  return image.storageUrl ? { ...image, url: image.storageUrl } : image;
}

function generatedImagePageLabel(image: GeneratedImagePreview) {
  return image.planPage > 0 ? `P${image.planPage}` : "本地";
}

async function imageUrlToBlob(url: string) {
  const readableUrl = await imageRefToUploadUrl(url);
  if (!readableUrl) throw new Error("图片数据不存在");
  const response = await fetch(readableUrl);
  if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
  return response.blob();
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function buildMockReferenceMedia(platform: string, title: string): ParsedReferenceMedia[] {
  return Array.from({ length: 5 }, (_, index) => ({
    type: "image" as const,
    name: `${title || "参考作品"} P${index + 1}`,
    url: mockSvg(`参考图 ${index + 1}`, index % 2 ? "#f0f9ff" : "#fff7ed")
  }));
}

function normalizeOpenCliMedia(media: unknown): ParsedReferenceMedia[] {
  if (!Array.isArray(media)) return [];
  return media.flatMap((item, index) => {
    const record = item && typeof item === "object" ? item as Partial<ParsedReferenceMedia> : null;
    if (!record?.url || typeof record.url !== "string") return [];
    return [{
      type: record.type === "video" ? "video" as const : "image" as const,
      url: record.url,
      name: record.name || `OpenCLI 采集素材 ${index + 1}`
    }];
  });
}

function mediaTypeFromUrl(url: string): "image" | "video" {
  return /\.(?:mp4|mov|webm|m4v)(?:[?#]|$)/i.test(url) ? "video" : "image";
}

function incomingReferenceMedia(params: URLSearchParams): ParsedReferenceMedia[] {
  const mediaParam = params.get("media");
  let media: ParsedReferenceMedia[] = [];
  if (mediaParam) {
    try {
      media = normalizeOpenCliMedia(JSON.parse(mediaParam));
    } catch {
      media = [];
    }
  }
  const coverUrl = params.get("coverUrl");
  if (coverUrl && !media.some((item) => item.url === coverUrl)) {
    media = [{ type: mediaTypeFromUrl(coverUrl), url: coverUrl, name: "保留作品封面" }, ...media];
  }
  return media;
}

function flattenMaterialImages(items: LibraryAsset[]): ImageSourceAsset[] {
  return items.flatMap((item) => {
    const children = item.children ? flattenMaterialImages(item.children) : [];
    const current = item.type === "image" && item.url ? [{
      type: "image" as const,
      url: item.url,
      name: item.name,
      source: "素材库" as const
    }] : [];
    return [...current, ...children];
  });
}

async function hydrateMaterialAsset(asset: LibraryAsset): Promise<LibraryAsset> {
  const children = asset.children ? await Promise.all(asset.children.map(hydrateMaterialAsset)) : undefined;
  if (!asset.storeKey) return { ...asset, children };
  const blob = await getAssetBlob(asset.storeKey);
  return blob ? { ...asset, children, url: URL.createObjectURL(blob) } : { ...asset, children };
}

function platformShortName(platform: string) {
  if (platform === "小红书") return "小红书公开参考作品";
  return `${platform}公开参考作品`;
}

async function readProductLibraryProducts(): Promise<ProductLibraryItem[]> {
  return readProductLibrary();
}

function productAssetsForPool(product: ProductLibraryItem): ImageSourceAsset[] {
  return (product.assets ?? []).flatMap((asset, index) => {
    if (!asset.url) return [];
    return [{
      type: asset.type === "video" ? "video" as const : "image" as const,
      url: asset.url,
      name: `${product.name} · ${asset.name || (asset.type === "video" ? `产品视频 ${index + 1}` : `产品图 ${index + 1}`)}`,
      source: "产品素材库" as const
    }];
  });
}

function imageSourceForStorage(asset: ImageSourceAsset): ImageSourceAsset {
  const stableUrl = asset.storageUrl ?? asset.url;
  return { ...asset, url: stableUrl, storageUrl: stableUrl };
}

async function hydrateImageSource(asset: ImageSourceAsset): Promise<ImageSourceAsset> {
  const stableUrl = asset.storageUrl ?? asset.url;
  if (!isStoredImageRef(stableUrl)) return { ...asset, storageUrl: stableUrl };
  const resolvedUrl = await resolveImageRef(stableUrl);
  return { ...asset, url: resolvedUrl || stableUrl, storageUrl: stableUrl };
}

async function stabilizeImageSource(asset: ImageSourceAsset, scope: string): Promise<ImageSourceAsset> {
  const stableUrl = asset.storageUrl ?? asset.url;
  if (isStoredImageRef(stableUrl) || /^https?:\/\//i.test(stableUrl) || stableUrl.startsWith("/")) {
    return { ...asset, storageUrl: stableUrl };
  }
  const [storedUrl] = await persistImageRefs([stableUrl], scope);
  const resolvedUrl = isStoredImageRef(storedUrl) ? await resolveImageRef(storedUrl) : stableUrl;
  return { ...asset, url: resolvedUrl || stableUrl, storageUrl: storedUrl };
}

async function hydrateImageSourceMap(sourceMap: Record<number, ImageSourceAsset[]>) {
  const entries = await Promise.all(Object.entries(sourceMap).map(async ([page, assets]) => [
    Number(page),
    await Promise.all((assets ?? []).map(hydrateImageSource))
  ] as const));
  return Object.fromEntries(entries) as Record<number, ImageSourceAsset[]>;
}

function expandCopyCandidates(items: typeof copyCandidates, baseTitle: string) {
  const styles = ["素人种草", "备忘录风", "科普风", "真实分享", "轻吐槽", "闺蜜口吻", "收藏清单", "避坑提醒", "通勤场景", "理性推荐"];
  return Array.from({ length: 10 }, (_, index) => {
    const base = items[index % items.length];
    return {
      ...base,
      id: `A${index + 1}`,
      style: index < items.length ? base.style : styles[index],
      summary: index < items.length ? base.summary : `围绕「${baseTitle}」做${styles[index]}版本，保留真实场景、痛点和收藏点。`,
      body: index < items.length ? base.body : `${baseTitle}\n\n这个版本会先写真实使用场景，再拆出容易忽略的防晒补涂细节，最后用清单方式总结适合收藏的重点。表达会尽量像真人整理，不夸大功效，也不把产品植入写得太硬。`
    };
  });
}

function copyBodyPreview(body: string) {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text) return "暂无正文内容，请重新生成文案候选。";
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function buildBatchDrafts(titles: ReturnType<typeof fallbackTitleCandidates>, copies: ReturnType<typeof expandCopyCandidates>, count = 10): BatchDraft[] {
  return Array.from({ length: count }, (_, index) => {
    const title = titles[index % titles.length]?.title ?? titles[0]?.title ?? `图文作品 ${index + 1}`;
    const copy = copies[index % copies.length];
    const tagStart = index % 4;
    return {
      id: `work_${index + 1}`,
      title,
      copy: copy?.body ?? "",
      tags: trafficTags.slice(tagStart, tagStart + 5),
      style: copy?.style ?? titles[index % titles.length]?.tag ?? "图文"
    };
  });
}

function fallbackTitleCandidates(baseTitle: string) {
  const sourceTitle = baseTitle.trim() || "参考作品";
  const tags = ["高点击", "强痛点", "收藏向", "种草向", "科普向", "素人感", "备忘录风", "真实分享", "轻吐槽", "避坑提醒"];
  const patterns = [
    `${sourceTitle}，换个角度这样写更容易被点开`,
    `别只看${sourceTitle}，真正要注意的是这几点`,
    `${sourceTitle}的实用版整理，先收藏再慢慢看`,
    `普通人也能看懂的${sourceTitle}避坑清单`,
    `${sourceTitle}到底怎么选？这篇讲清楚`,
    `关于${sourceTitle}，很多人第一步就做错了`,
    `${sourceTitle}真实使用感：舒服比夸张更重要`,
    `把${sourceTitle}整理成备忘录，照着看就行`,
    `${sourceTitle}不踩雷指南，适合夏天直接参考`,
    `${sourceTitle}的关键不是跟风，而是看场景`
  ];

  return patterns.map((title, index) => ({
    title,
    score: Math.max(86, 96 - index),
    tag: tags[index]
  }));
}

function normalizeTitleCandidates(payload: unknown, baseTitle: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(nested.titles)
      ? nested.titles
      : Array.isArray(nested.titleCandidates)
        ? nested.titleCandidates
        : Array.isArray(nested.candidates)
          ? nested.candidates
          : Array.isArray(nested["标题候选"])
            ? nested["标题候选"]
            : Array.isArray(nested["标题"])
              ? nested["标题"]
              : [];

  if (!source.length) return fallbackTitleCandidates(baseTitle);

  return source.slice(0, 10).map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const title = typeof row.title === "string" ? row.title : typeof item === "string" ? item : "";
    const fallback = fallbackTitleCandidates(baseTitle)[index];
    return {
      title: title.trim() || fallback.title,
      score: Number(row.score || fallback.score),
      tag: String(row.tag || row.label || fallback.tag)
    };
  });
}

function normalizeCopyCandidates(payload: unknown, baseTitle: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(nested.copies)
      ? nested.copies
      : Array.isArray(nested.copyCandidates)
        ? nested.copyCandidates
        : Array.isArray(nested.candidates)
          ? nested.candidates
          : Array.isArray(nested["文案候选"])
            ? nested["文案候选"]
            : Array.isArray(nested["文案"])
              ? nested["文案"]
              : [];

  if (!source.length) return expandCopyCandidates(copyCandidates, baseTitle);

  const normalized = source.slice(0, 10).map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const fallback = copyCandidates[index % copyCandidates.length];
    const body = String(row.body || row.copy || row.content || row.text || (typeof item === "string" ? item : "") || fallback.body);
    return {
      id: String(row.id || `A${index + 1}`),
      style: String(row.style || row.tag || row.label || fallback.style),
      summary: copyBodyPreview(body),
      body
    };
  });

  return expandCopyCandidates(normalized as typeof copyCandidates, baseTitle);
}

function extractGeneratedImageUrls(payload: unknown): string[] {
  if (!payload) return [];
  if (typeof payload === "string") {
    if (/^https?:\/\//.test(payload) || payload.startsWith("data:image/")) return [payload];
    return [];
  }
  if (Array.isArray(payload)) return payload.flatMap(extractGeneratedImageUrls);
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return [record.url, record.image_url, record.b64_json ? `data:image/jpeg;base64,${record.b64_json}` : undefined, record.base64 ? `data:image/jpeg;base64,${record.base64}` : undefined, record.images, record.data]
      .flatMap(extractGeneratedImageUrls);
  }
  return [];
}

function StepNav<T extends string>({ steps, value, onChange }: { steps: T[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((step, index) => (
        <button key={step} onClick={() => onChange(step)} className={cn("flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition", value === step ? "border-orange-200 bg-orange-50 text-orange-700" : "border-line bg-white text-muted hover:bg-slate-50")}>
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-xs", value === step ? "bg-orange-500 text-white" : "bg-slate-100 text-muted")}>{index + 1}</span>
          {step}
        </button>
      ))}
    </div>
  );
}

function FieldLabel({ children, count }: { children: React.ReactNode; count?: string }) {
  return <div className="mb-2 flex items-center justify-between text-sm font-medium text-ink"><span>{children}</span>{count ? <span className="text-xs font-normal text-muted">{count}</span> : null}</div>;
}

function AssetSection({
  title,
  assets,
  emptyText,
  onDrag,
  onPreview,
  onDelete,
  onEmptyClick,
  actionLabel,
  headerExtra
}: {
  title: string;
  assets: ImageSourceAsset[];
  emptyText: string;
  onDrag: (event: DragEvent, asset: ImageSourceAsset) => void;
  onPreview: (asset: ImageSourceAsset) => void;
  onDelete?: (asset: ImageSourceAsset) => void;
  onEmptyClick?: () => void;
  actionLabel?: string;
  headerExtra?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-slate-50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{assets.length} 张</span>
          {onEmptyClick && actionLabel ? (
            <button type="button" onClick={onEmptyClick} className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-orange-700 ring-1 ring-orange-100 hover:bg-orange-50">
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
      {headerExtra ? <div className="mb-3">{headerExtra}</div> : null}
      {assets.length ? (
        <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
          {assets.map((asset, index) => (
            <div key={`${asset.source}-${asset.url}-${index}`} draggable onDragStart={(event) => onDrag(event, asset)} className="group relative cursor-grab overflow-hidden rounded-md border border-line bg-white active:cursor-grabbing">
              <button className="block w-full" onClick={() => onPreview(asset)}>
                {asset.type === "video" ? <video src={asset.url} className="aspect-[3/4] w-full object-cover" muted playsInline preload="metadata" /> : <img src={asset.url} alt={asset.name} className="aspect-[3/4] w-full object-cover" />}
              </button>
              {onDelete ? <button onClick={() => onDelete(asset)} className="absolute right-1 top-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100">删除</button> : null}
              <div className="px-2 py-1">
                <p className="text-[11px] font-medium text-orange-700">{asset.type === "video" ? "产品视频" : `对标图${index + 1}`}</p>
                <p className="truncate text-[11px] text-muted">{asset.name}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="w-full rounded-md bg-white px-3 py-3 text-left text-xs text-muted">
          {emptyText}
        </div>
      )}
    </section>
  );
}

export default function ContentPage() {
  const [queryString, setQueryString] = useState("");
  const [tab, setTab] = useState<MainTab>("图文内容");
  const [imageStep, setImageStep] = useState<ImageStep>("发布文案生成");
  const [videoStep, setVideoStep] = useState<VideoStep>("发布文案生成");
  const [feedback, setFeedback] = useState("内容生产中心已准备就绪，当前所有模型调用均通过本地 API adapter mock。");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadText, setUploadText] = useState("夏天通勤防晒喷雾，包里常备这一支\n早八赶地铁时最怕防晒厚重，午休外出前补喷一层会更方便。");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [referenceRows, setReferenceRows] = useState<ReferenceRow[]>(referenceSources.map((item) => ({ ...item })));
  const [parsedReference, setParsedReference] = useState<ParsedReference | null>(null);
  const [referenceParsing, setReferenceParsing] = useState(false);
  const [imitationLoading, setImitationLoading] = useState(false);
  const [imitationProduct, setImitationProduct] = useState("");
  const [imitationPrompt, setImitationPrompt] = useState("");
  const [titleOptions, setTitleOptions] = useState(titleCandidates);
  const [copyOptions, setCopyOptions] = useState(expandCopyCandidates(copyCandidates, titleCandidates[0].title));

  const [selectedTitle, setSelectedTitle] = useState(titleCandidates[0].title);
  const [selectedCopyId, setSelectedCopyId] = useState(copyOptions[0].id);
  const [draftTitle, setDraftTitle] = useState(titleCandidates[0].title);
  const [draftCopy, setDraftCopy] = useState(copyOptions[0].body);
  const [batchCandidates, setBatchCandidates] = useState<BatchDraft[]>(() => buildBatchDrafts(titleCandidates, expandCopyCandidates(copyCandidates, titleCandidates[0].title), 10));
  const [selectedBatchDrafts, setSelectedBatchDrafts] = useState<BatchDraft[]>(() => buildBatchDrafts(titleCandidates, expandCopyCandidates(copyCandidates, titleCandidates[0].title), 1).map(withoutSelectedKeywords));
  const [activeBatchIndex, setActiveBatchIndex] = useState(0);
  const [targetAccount, setTargetAccount] = useState(accounts[0].id);
  const [contentType, setContentType] = useState(accounts[0].contentTypes[0]);
  const [imageCount, setImageCount] = useState("9 张");
  const [imageProvider, setImageProvider] = useState<ImageProvider>("Image 2.0");
  const [imagePlanItems, setImagePlanItems] = useState([defaultImagePlan]);
  const [activeImagePage, setActiveImagePage] = useState(1);
  const [productImage, setProductImage] = useState<{ name: string; url: string; storageUrl?: string } | null>(null);
  const [imagePromptText, setImagePromptText] = useState("");
  const [imageSize, setImageSize] = useState("1080x1440");
  const [generateCount, setGenerateCount] = useState("1");
  const [generatedImages, setGeneratedImages] = useState<GeneratedImagePreview[]>([]);
  const [generatedImagesHydrated, setGeneratedImagesHydrated] = useState(false);

  useEffect(() => {
    void loadGeneratedImages(GENERATED_IMAGES_STORAGE_KEY)
      .then(async (images) => {
        const hydratedImages = await Promise.all(images.map(async (image) => {
          const storedImage = image as GeneratedImagePreview;
          const stableUrl = storedImage.storageUrl ?? storedImage.url;
          if (!isStoredImageRef(stableUrl)) return storedImage;
          const resolvedUrl = await resolveImageRef(stableUrl);
          return { ...storedImage, url: resolvedUrl || stableUrl, storageUrl: stableUrl };
        }));
        if (hydratedImages.length) setGeneratedImages(hydratedImages);
      })
      .finally(() => setGeneratedImagesHydrated(true));
  }, []);

  useEffect(() => {
    if (!generatedImagesHydrated) return;
    void saveGeneratedImages(GENERATED_IMAGES_STORAGE_KEY, generatedImages.map(generatedImageForStorage));
  }, [generatedImages, generatedImagesHydrated]);

  const [customKeywordDraft, setCustomKeywordDraft] = useState("");
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [hiddenKeywords, setHiddenKeywords] = useState<string[]>([]);
  const [localImageSources, setLocalImageSources] = useState<ImageSourceAsset[]>([]);
  const [libraryImageSources, setLibraryImageSources] = useState<ImageSourceAsset[]>([]);
  const [productImageSources, setProductImageSources] = useState<ImageSourceAsset[]>([]);
  const [productLibraryProducts, setProductLibraryProducts] = useState<ProductLibraryItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [materialPickerAssets, setMaterialPickerAssets] = useState<ImageSourceAsset[]>([]);
  const [selectedMaterialUrls, setSelectedMaterialUrls] = useState<string[]>([]);
  const [planSourceMap, setPlanSourceMap] = useState<Record<number, ImageSourceAsset[]>>({});
  const [planPromptMap, setPlanPromptMap] = useState<Record<number, string>>({});
  const [planSizeMap, setPlanSizeMap] = useState<Record<number, string>>({});
  const [planCountMap, setPlanCountMap] = useState<Record<number, string>>({});
  const [planProviderMap, setPlanProviderMap] = useState<Record<number, ImageProvider>>({});
  const [imageDraftHydrated, setImageDraftHydrated] = useState(false);
  const [previewImage, setPreviewImage] = useState<GeneratedImagePreview | null>(null);
  const [generatingImagePages, setGeneratingImagePages] = useState<Record<number, ImageProvider>>({});
  const [draggingImagePage, setDraggingImagePage] = useState<number | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [finishedPreviewOpen, setFinishedPreviewOpen] = useState(false);
  const [finishedSaving, setFinishedSaving] = useState(false);
  const [finishedImageAssignments, setFinishedImageAssignments] = useState<Record<number, string[]>>({});
  const [draggingFinishedImageUrl, setDraggingFinishedImageUrl] = useState<string | null>(null);
  const [expandedPreviewWork, setExpandedPreviewWork] = useState(0);
  const [previewImagePageFilter, setPreviewImagePageFilter] = useState("全部");
  const [videoFinishedPreviewOpen, setVideoFinishedPreviewOpen] = useState(false);
  const [savePath, setSavePath] = useState("尚未选择文件夹");
  const [localSaveSelectedUrls, setLocalSaveSelectedUrls] = useState<string[]>([]);
  const [localSaveDirectory, setLocalSaveDirectory] = useState<WritableDirectoryLike | null>(null);
  const [localSaveSaving, setLocalSaveSaving] = useState(false);
  const [directoryPickerSupported, setDirectoryPickerSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDirectoryPickerSupported("showDirectoryPicker" in window);
    const keywordState = loadVersionedState(window.localStorage, KEYWORD_LIBRARY_STORAGE_KEY, LOCAL_STATE_VERSION, {
      customKeywords: [] as string[],
      hiddenKeywords: [] as string[]
    });
    setCustomKeywords(keywordState.customKeywords);
    setHiddenKeywords(keywordState.hiddenKeywords);

    const draft = loadVersionedState<Partial<ImageProductionDraft> | null>(
      window.localStorage,
      IMAGE_DRAFT_STORAGE_KEY,
      LOCAL_STATE_VERSION,
      null
    );

    const restoreDraft = async () => {
      if (!draft) return;
      if (draft.imageStep && imageSteps.includes(draft.imageStep)) setImageStep(draft.imageStep);
      if (Array.isArray(draft.selectedBatchDrafts) && draft.selectedBatchDrafts.length) setSelectedBatchDrafts(draft.selectedBatchDrafts);
      if (draft.activeBatchIndex !== undefined) setActiveBatchIndex(draft.activeBatchIndex);
      if (draft.draftTitle !== undefined) setDraftTitle(draft.draftTitle);
      if (draft.draftCopy !== undefined) setDraftCopy(draft.draftCopy);
      if (draft.targetAccount !== undefined) setTargetAccount(draft.targetAccount);
      if (draft.contentType !== undefined) setContentType(draft.contentType);
      if (draft.imageCount !== undefined) setImageCount(draft.imageCount);
      if (draft.imageProvider !== undefined) setImageProvider(draft.imageProvider);
      if (Array.isArray(draft.imagePlanItems) && draft.imagePlanItems.length) setImagePlanItems(draft.imagePlanItems);
      if (draft.activeImagePage !== undefined) setActiveImagePage(draft.activeImagePage);
      if (draft.imagePromptText !== undefined) setImagePromptText(draft.imagePromptText);
      if (draft.imageSize !== undefined) setImageSize(draft.imageSize);
      if (draft.generateCount !== undefined) setGenerateCount(draft.generateCount);
      if (draft.selectedProductId !== undefined) setSelectedProductId(draft.selectedProductId);
      if (draft.planPromptMap) setPlanPromptMap(draft.planPromptMap);
      if (draft.planSizeMap) setPlanSizeMap(draft.planSizeMap);
      if (draft.planCountMap) setPlanCountMap(draft.planCountMap);
      if (draft.planProviderMap) setPlanProviderMap(draft.planProviderMap);
      if (draft.parsedReference !== undefined) setParsedReference(draft.parsedReference);

      const [localSources, librarySources, productSources, restoredPlanSources] = await Promise.all([
        Promise.all((draft.localImageSources ?? []).map(hydrateImageSource)),
        Promise.all((draft.libraryImageSources ?? []).map(hydrateImageSource)),
        Promise.all((draft.productImageSources ?? []).map(hydrateImageSource)),
        hydrateImageSourceMap(draft.planSourceMap ?? {})
      ]);
      if (cancelled) return;
      setLocalImageSources(localSources);
      setLibraryImageSources(librarySources);
      setProductImageSources(productSources);
      setPlanSourceMap(restoredPlanSources);

      if (draft.productImage) {
        const stableUrl = draft.productImage.storageUrl ?? draft.productImage.url;
        const resolvedUrl = isStoredImageRef(stableUrl) ? await resolveImageRef(stableUrl) : stableUrl;
        if (!cancelled) setProductImage({ ...draft.productImage, url: resolvedUrl || stableUrl, storageUrl: stableUrl });
      }
    };

    void restoreDraft().finally(() => {
      if (!cancelled) setImageDraftHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!imageDraftHydrated) return;
    saveVersionedState(window.localStorage, KEYWORD_LIBRARY_STORAGE_KEY, LOCAL_STATE_VERSION, {
      customKeywords,
      hiddenKeywords
    });
  }, [customKeywords, hiddenKeywords, imageDraftHydrated]);

  useEffect(() => {
    if (!imageDraftHydrated) return;
    const storedProductImage = productImage
      ? { ...productImage, url: productImage.storageUrl ?? productImage.url, storageUrl: productImage.storageUrl ?? productImage.url }
      : null;
    const storedPlanSourceMap = Object.fromEntries(Object.entries(planSourceMap).map(([page, assets]) => [page, assets.map(imageSourceForStorage)]));
    saveVersionedState<ImageProductionDraft>(window.localStorage, IMAGE_DRAFT_STORAGE_KEY, LOCAL_STATE_VERSION, {
      imageStep,
      selectedBatchDrafts,
      activeBatchIndex,
      draftTitle,
      draftCopy,
      targetAccount,
      contentType,
      imageCount,
      imageProvider,
      imagePlanItems,
      activeImagePage,
      imagePromptText,
      imageSize,
      generateCount,
      productImage: storedProductImage,
      localImageSources: localImageSources.map(imageSourceForStorage),
      libraryImageSources: libraryImageSources.map(imageSourceForStorage),
      productImageSources: productImageSources.map(imageSourceForStorage),
      selectedProductId,
      planSourceMap: storedPlanSourceMap,
      planPromptMap,
      planSizeMap,
      planCountMap,
      planProviderMap,
      parsedReference
    });
  }, [activeBatchIndex, activeImagePage, contentType, draftCopy, draftTitle, generateCount, imageCount, imageDraftHydrated, imagePlanItems, imagePromptText, imageProvider, imageSize, imageStep, libraryImageSources, localImageSources, parsedReference, planCountMap, planPromptMap, planProviderMap, planSizeMap, planSourceMap, productImage, productImageSources, selectedBatchDrafts, selectedProductId, targetAccount]);

  const [selectedVideoTitle, setSelectedVideoTitle] = useState("夏天通勤补防晒，喷雾到底怎么用才不花妆");
  const [videoCoverCopy, setVideoCoverCopy] = useState(videoExtraction.coverCopy);
  const [draftVoiceover, setDraftVoiceover] = useState(videoExtraction.voiceover);
  const [videoTitleOptions, setVideoTitleOptions] = useState(titleCandidates);
  const [videoCopyOptions, setVideoCopyOptions] = useState(expandCopyCandidates(copyCandidates, titleCandidates[0].title));
  const [selectedVideoCopyId, setSelectedVideoCopyId] = useState("A1");
  const [videoImitationLoading, setVideoImitationLoading] = useState(false);
  const [videoReferenceUrl, setVideoReferenceUrl] = useState("");
  const [localReferenceVideo, setLocalReferenceVideo] = useState<{ name: string; url: string } | null>(null);
  const [parsedVideoReference, setParsedVideoReference] = useState<ParsedReference | null>(null);
  const [videoReferenceParsing, setVideoReferenceParsing] = useState(false);
  const [scriptPrompt, setScriptPrompt] = useState("拆解原视频结构，保留镜头时间、画面、动作、音效和口播字段；仿写时强化防晒护肤真实分享感。");
  const [scriptReferenceImages, setScriptReferenceImages] = useState<ImageSourceAsset[]>([]);
  const [scriptRows, setScriptRows] = useState<VideoScriptRow[]>(videoScriptRows);
  const [shotPlans, setShotPlans] = useState<VideoShotPlan[]>(videoShots);
  const [videoProvider, setVideoProvider] = useState<VideoProvider>("仅生成分镜提示词，不直接生成视频");
  const [activeVideoPage, setActiveVideoPage] = useState(videoShots[0].no);
  const [videoRatio, setVideoRatio] = useState("9:16");
  const [videoGenerateCount, setVideoGenerateCount] = useState("1");
  const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideoPreview[]>([]);
  const [previewVideo, setPreviewVideo] = useState<GeneratedVideoPreview | null>(null);

  const selectedShotCount = scriptRows.filter((row) => row.selected).length;
  const visibleKeywordLibrary = useMemo(
    () => Array.from(new Set([...customKeywords, ...keywordLibrary])).filter((tag) => !hiddenKeywords.includes(tag)),
    [customKeywords, hiddenKeywords]
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(REFERENCE_HISTORY_STORAGE_KEY);
    if (!stored) return;
    const parsed = (JSON.parse(stored) as ReferenceRow[]).filter((row) => row.platform.includes("小红书"));
    if (parsed.length) setReferenceRows(parsed.slice(0, 3));
  }, []);

  useEffect(() => {
    if (imageStep !== "图片生成") return;
    void readProductLibraryProducts().then((products) => {
      setProductLibraryProducts(products);
      if (selectedProductId && !products.some((product, index) => productLibraryKey(product, index) === selectedProductId)) {
        setSelectedProductId("");
        setProductImageSources([]);
      }
    });
  }, [imageStep, selectedProductId]);

  const persistReferenceRows = (rows: ReferenceRow[]) => {
    const recent = rows.filter((row) => row.platform.includes("小红书") && (row.status === "已解析" || row.status === "已导入文本")).slice(0, 3);
    window.localStorage.setItem(REFERENCE_HISTORY_STORAGE_KEY, JSON.stringify(recent));
  };

  const saveImageAssetsToLibrary = () => {
    appendMaterialLibrary(imagePlanItems.map((plan) => createLibraryAsset({
      name: `图文素材 P${plan.page} · ${plan.type}`,
      type: "file",
      source: "内容生产 / 图文生产",
      note: `${draftTitle}\n${planPromptMap[plan.page] ?? ""}`
    })));
    setFeedback("已自动保存图文生产素材到素材库。");
  };

  const saveVideoAssetsToLibrary = () => {
    appendMaterialLibrary(shotPlans.filter((shot) => shot.selected).map((shot) => createLibraryAsset({
      name: `视频镜头 ${shot.no} · ${shot.title}`,
      type: "file",
      source: "内容生产 / 图文素材",
      note: `${shot.scene}\n${shot.prompt}`
    })));
    setFeedback(`已自动保存 ${shotPlans.filter((shot) => shot.selected).length} 个视频镜头素材到素材库。`);
  };

  useEffect(() => {
    const updateQuery = () => setQueryString(window.location.search);
    updateQuery();

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(...args: Parameters<History["pushState"]>) {
      originalPushState.apply(this, args);
      window.dispatchEvent(new Event("content-url-change"));
    };
    window.history.replaceState = function replaceState(...args: Parameters<History["replaceState"]>) {
      originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event("content-url-change"));
    };

    window.addEventListener("popstate", updateQuery);
    window.addEventListener("content-url-change", updateQuery);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", updateQuery);
      window.removeEventListener("content-url-change", updateQuery);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    const incomingUrl = params.get("referenceUrl") ?? "";
    const incomingTitle = params.get("title") ?? "";
    const incomingType = params.get("contentType") ?? "";
    const incomingTemplateName = params.get("templateName") ?? "";
    const incomingImageStep = params.get("imageStep") as ImageStep | null;
    const incomingPrefill = params.get("prefill") === "1";
    const incomingCopy = params.get("copy") ?? "";
    const incomingKeyword = params.get("keyword") ?? "";
    setTab("图文内容");
    if (incomingImageStep && imageSteps.includes(incomingImageStep)) setImageStep(incomingImageStep);
    if (params.get("imageStep") === "仿写生成" || params.get("imageStep") === "初检查重") setImageStep("发布文案生成");
    if (params.get("imageStep") === "素材生成") setImageStep("图片生成");
    if (incomingTemplateName) {
      setFeedback(`已载入模板：${incomingTemplateName}`);
    }
    if (incomingUrl && incomingPrefill) {
      const author = (params.get("sourceAccount") || "公开参考作品").replace(/^OpenCLI · /, "");
      const likes = params.get("likes") || "-";
      const fetchedAt = params.get("fetchedAt") || new Date().toISOString().slice(0, 10);
      const media = incomingReferenceMedia(params);
      const parsedTitle = incomingTitle || "保留参考作品";
      const parsedCopy = incomingCopy || `关键词：${incomingKeyword || "小红书"}\n参考标题：${parsedTitle}`;
      const nextParsed: ParsedReference = {
        platform: "小红书",
        title: parsedTitle,
        author,
        copy: parsedCopy,
        url: incomingUrl,
        media
      };
      setTab("图文内容");
      setImageStep("发布文案生成");
      setReferenceUrl(incomingUrl);
      setParsedReference(nextParsed);
      setDraftCopy(parsedCopy);
      setImagePlanItems([{ ...defaultImagePlan, title: parsedTitle, copy: parsedCopy.slice(0, 40) }]);
      setActiveImagePage(1);
      setImageCount(`${Math.max(media.filter((item) => item.type === "image").length, 1)} 张`);
      setReferenceRows((rows) => {
        const nextRow: ReferenceRow = {
          id: `kept_${Date.now()}`,
          platform: "小红书",
          title: parsedTitle,
          author,
          time: fetchedAt,
          likes,
          saves: "-",
          comments: "-",
          status: "已解析",
          reason: "",
          url: incomingUrl,
          copy: parsedCopy,
          media
        };
        const nextRows = [nextRow, ...rows.filter((row) => row.url !== incomingUrl)].slice(0, 3);
        persistReferenceRows(nextRows);
        return nextRows;
      });
      setFeedback("已从全部保留带入参考内容，标题、正文和图片已放入参考内容输入区；不用开始解析，直接点击发布文案生成即可仿写。");
    } else if (incomingUrl) {
      setTab("图文内容");
      setImageStep("发布文案生成");
      setReferenceUrl(incomingUrl);
      setFeedback("已从爆款选题库带入参考作品链接，点击“开始解析”即可解析该作品。");
    }
    if (incomingTitle) {
      setSelectedTitle(incomingTitle);
      setDraftTitle(incomingTitle);
    }
    if (incomingType) setContentType(incomingType);
  }, [queryString]);

  const selectTitle = (title: string) => {
    setSelectedTitle(title);
    setDraftTitle(title);
    setFeedback("已同步标题候选到右侧可编辑标题。");
  };

  const selectCopy = (id: string) => {
    const copy = copyOptions.find((item) => item.id === id) ?? copyOptions[0];
    setSelectedCopyId(id);
    setDraftCopy(copy.body);
    setFeedback("已同步文案候选到右侧完整文案。");
  };

  const selectBatchCandidate = (candidate: BatchDraft) => {
    setSelectedBatchDrafts((items) => items.map((item, index) => index === activeBatchIndex ? withoutSelectedKeywords({ ...candidate, id: item.id }) : item));
    if (activeBatchIndex === 0) {
      setDraftTitle(candidate.title);
      setDraftCopy(candidate.copy);
    }
    setFeedback(`已把候选内容同步到作品 ${activeBatchIndex + 1}。`);
  };

  const updateBatchDraft = (index: number, patch: Partial<BatchDraft>) => {
    setSelectedBatchDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    if (index === 0) {
      if (patch.title !== undefined) setDraftTitle(patch.title);
      if (patch.copy !== undefined) setDraftCopy(patch.copy);
    }
  };

  const addSelectedBatchDraft = () => {
    const source = batchCandidates[selectedBatchDrafts.length % Math.max(batchCandidates.length, 1)] ?? selectedBatchDrafts[0];
    const nextDraft = {
      ...(source ?? {
        id: "new_work",
        title: "新图文作品",
        copy: "",
        tags: [],
        style: "自定义"
      }),
      id: `selected_${Date.now()}_${selectedBatchDrafts.length + 1}`
    };
    setSelectedBatchDrafts((items) => [...items, withoutSelectedKeywords(nextDraft)]);
    setActiveBatchIndex(selectedBatchDrafts.length);
    setFeedback(`已新增作品 ${selectedBatchDrafts.length + 1}。`);
  };

  const removeSelectedBatchDraft = (index: number) => {
    setSelectedBatchDrafts((items) => {
      if (items.length <= 1) return items;
      const next = items.filter((_, itemIndex) => itemIndex !== index);
      setActiveBatchIndex((value) => Math.min(value, next.length - 1));
      return next;
    });
  };

  const toggleBatchKeyword = (index: number, tag: string) => {
    setSelectedBatchDrafts((items) => items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const tags = item.tags.includes(tag)
        ? item.tags.filter((value) => value !== tag)
        : [...item.tags, tag];
      return { ...item, tags };
    }));
  };

  const addCustomKeyword = () => {
    const incoming = customKeywordDraft.split(/[\n,，、\s]+/).map((item) => item.trim()).filter(Boolean);
    if (!incoming.length) return;
    const next = addKeywordValues({ customKeywords, hiddenKeywords }, incoming);
    setCustomKeywords(next.customKeywords);
    setHiddenKeywords(next.hiddenKeywords);
    setCustomKeywordDraft("");
    setFeedback(`已添加关键词：${incoming.join("、")}`);
  };

  const deleteKeywordFromLibrary = (tag: string) => {
    const next = removeKeywordValue({ customKeywords, hiddenKeywords }, tag);
    setCustomKeywords(next.customKeywords);
    setHiddenKeywords(next.hiddenKeywords);
    setSelectedBatchDrafts((items) => items.map((item) => ({ ...item, tags: item.tags.filter((value) => value !== tag) })));
    setFeedback(`已从关键词库删除：${tag}`);
  };

  const generateImitationCandidates = async () => {
    if (!parsedReference) {
      setFeedback("请先点击开始解析，解析出参考作品后再生成发布文案。");
      return;
    }
    setImitationLoading(true);
    setFeedback("正在调用 DeepSeek 文案 adapter 仿写标题和文案候选。");
    try {
      const payload = {
        provider: "deepseek",
        reference: parsedReference,
        product: imitationProduct.trim(),
        prompt: imitationPrompt.trim(),
        targetAccount,
        contentType
      };
      const [titleResponse, copyResponse] = await Promise.all([
        fetch("/api/copy/generate-titles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }),
        fetch("/api/copy/generate-copies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      ]);
      const titleData = await titleResponse.json();
      const copyData = await copyResponse.json();
      const nextTitles = normalizeTitleCandidates(titleData?.data ?? titleData, parsedReference.title);
      const nextCopies = normalizeCopyCandidates(copyData?.data ?? copyData, parsedReference.title);
      const titleProvider = titleData?.data?.provider ?? "unknown";
      const copyProvider = copyData?.data?.provider ?? "unknown";
      const model = titleData?.data?.model || copyData?.data?.model || "";
      setTitleOptions(nextTitles);
      setCopyOptions(nextCopies);
      const nextBatchCandidates = buildBatchDrafts(nextTitles, nextCopies, 10);
      setBatchCandidates(nextBatchCandidates);
      setSelectedBatchDrafts(nextBatchCandidates.slice(0, Math.max(selectedBatchDrafts.length, 1)).map((item, index) => withoutSelectedKeywords({ ...item, id: `selected_${index + 1}` })));
      setActiveBatchIndex(0);
      setSelectedTitle(nextTitles[0]?.title ?? parsedReference.title);
      setDraftTitle(nextTitles[0]?.title ?? parsedReference.title);
      setSelectedCopyId(nextCopies[0].id);
      setDraftCopy(nextCopies[0].body);
      const titleError = titleData?.data?.error;
      const copyError = copyData?.data?.error;
      setFeedback(
        titleProvider === "deepseek" || copyProvider === "deepseek"
          ? `仿写完成：已通过 DeepSeek ${model} 生成 ${nextTitles.length} 条标题和 ${nextCopies.length} 条文案候选。`
          : `DeepSeek 未完成真实仿写，已 fallback：${titleError || copyError || `${titleProvider}/${copyProvider}`}。`
      );
    } catch (error) {
      const nextCopies = expandCopyCandidates(copyCandidates, parsedReference.title);
      const nextTitles = fallbackTitleCandidates(parsedReference.title);
      setTitleOptions(nextTitles);
      setCopyOptions(nextCopies);
      const nextBatchCandidates = buildBatchDrafts(nextTitles, nextCopies, 10);
      setBatchCandidates(nextBatchCandidates);
      setSelectedBatchDrafts(nextBatchCandidates.slice(0, Math.max(selectedBatchDrafts.length, 1)).map((item, index) => withoutSelectedKeywords({ ...item, id: `selected_${index + 1}` })));
      setFeedback(error instanceof Error ? `仿写接口异常，已使用 mock 候选：${error.message}` : "仿写接口异常，已使用 mock 候选。");
    } finally {
      setImitationLoading(false);
    }
  };

  const toggleScriptRow = (id: string, selected: boolean) => {
    setScriptRows((rows) => rows.map((row) => row.id === id ? { ...row, selected } : row));
    setShotPlans((shots) => shots.map((shot) => shot.id === id.replace("s", "v") ? { ...shot, selected } : shot));
  };

  const uploadReferenceVideo = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setLocalReferenceVideo({ name: file.name, url: URL.createObjectURL(file) });
    setParsedVideoReference(null);
    setFeedback(`已上传对标视频：${file.name}`);
  };

  const parseVideoReferenceLink = async () => {
    const url = videoReferenceUrl.trim();
    if (!url) {
      setFeedback("请先粘贴小红书参考链接。");
      return;
    }
    setVideoReferenceParsing(true);
    setParsedVideoReference(null);
    setFeedback("正在解析视频参考链接：POST /api/reference/parse-link");
    try {
      const response = await fetch("/api/reference/parse-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, title: selectedVideoTitle, author: "公开视频参考" })
      });
      const data = await response.json();
      const reference = data?.data?.reference ?? {};
      const parsedTitle = reference.title ?? selectedVideoTitle;
      const parsedCopy = reference.copy || reference.content || draftVoiceover;
      const parsedPlatform = "小红书";
      const media = normalizeOpenCliMedia(reference.media);
      setSelectedVideoTitle(parsedTitle);
      setVideoCoverCopy(parsedTitle);
      setDraftVoiceover(parsedCopy);
      setParsedVideoReference({
        platform: parsedPlatform,
        title: parsedTitle,
        author: reference.author ?? "公开视频参考",
        copy: parsedCopy,
        url,
        media
      });
      const hasVideo = media.some((item) => item.type === "video");
      setFeedback(hasVideo ? "视频参考链接解析完成：已通过 OpenCLI 抓取标题、文案和视频本身。" : "视频参考链接解析完成，但 OpenCLI 没有返回可播放视频；标题和文案已同步。");
    } catch (error) {
      setFeedback(error instanceof Error ? `视频链接解析失败：${error.message}` : "视频链接解析失败。");
    } finally {
      setVideoReferenceParsing(false);
    }
  };

  const selectVideoCopy = (id: string) => {
    const copy = videoCopyOptions.find((item) => item.id === id) ?? videoCopyOptions[0];
    setSelectedVideoCopyId(id);
    setDraftVoiceover(copy.body);
    setFeedback("已同步视频文案候选到右侧口播文案。");
  };

  const generateVideoImitationCandidates = async () => {
    const reference = parsedVideoReference ?? {
      platform: "本地视频",
      title: localReferenceVideo?.name ?? selectedVideoTitle,
      author: "本地上传",
      copy: draftVoiceover,
      url: "",
      media: localReferenceVideo ? [{ type: "video" as const, url: localReferenceVideo.url, name: localReferenceVideo.name }] : []
    };
    setVideoImitationLoading(true);
    setFeedback("正在调用 DeepSeek 为参考视频生成发布标题和文案候选。");
    try {
      const payload = { provider: "deepseek", reference };
      const [titleResponse, copyResponse] = await Promise.all([
        fetch("/api/copy/generate-titles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
        fetch("/api/copy/generate-copies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      ]);
      const titleData = await titleResponse.json();
      const copyData = await copyResponse.json();
      const nextTitles = normalizeTitleCandidates(titleData?.data ?? titleData, reference.title);
      const nextCopies = expandCopyCandidates(Array.isArray(copyData?.data?.copies) ? copyData.data.copies : copyCandidates, reference.title);
      setVideoTitleOptions(nextTitles);
      setVideoCopyOptions(nextCopies);
      setSelectedVideoTitle(nextTitles[0]?.title ?? reference.title);
      setSelectedVideoCopyId(nextCopies[0]?.id ?? "A1");
      setDraftVoiceover(nextCopies[0]?.body ?? reference.copy);
      setFeedback(`视频拆解完成第一步：已生成 ${nextTitles.length} 条标题和 ${nextCopies.length} 条文案候选。`);
    } catch (error) {
      const nextTitles = fallbackTitleCandidates(reference.title);
      const nextCopies = expandCopyCandidates(copyCandidates, reference.title);
      setVideoTitleOptions(nextTitles);
      setVideoCopyOptions(nextCopies);
      setSelectedVideoTitle(nextTitles[0].title);
      setSelectedVideoCopyId(nextCopies[0].id);
      setDraftVoiceover(nextCopies[0].body);
      setFeedback(error instanceof Error ? `DeepSeek 视频仿写失败，已使用本地候选：${error.message}` : "DeepSeek 视频仿写失败，已使用本地候选。");
    } finally {
      setVideoImitationLoading(false);
    }
  };

  const decomposeVideoScript = async () => {
    setFeedback("正在调用 GPT 视频脚本拆解接口：POST /api/video/parse");
    const response = await fetch("/api/video/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "gpt",
        reference: parsedVideoReference,
        localVideo: localReferenceVideo?.name,
        prompt: scriptPrompt
      })
    });
    const data = await response.json().catch(() => ({}));
    const nextScript = Array.isArray(data?.data?.script) ? data.data.script : videoScriptRows;
    setScriptRows(nextScript);
    setFeedback(`GPT 原脚本拆解完成：已提取 ${nextScript.length} 个镜头脚本。`);
  };

  const rewriteVideoScript = async () => {
    setFeedback("正在调用 GPT 视频脚本生成接口：POST /api/video/generate-script");
    const response = await fetch("/api/video/generate-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "gpt",
        title: selectedVideoTitle,
        voiceover: draftVoiceover,
        prompt: scriptPrompt,
        referenceImages: scriptReferenceImages.map((item) => item.name)
      })
    });
    const data = await response.json().catch(() => ({}));
    const nextScript = Array.isArray(data?.data?.script) ? data.data.script.map((row: VideoScriptRow) => ({ ...row, selected: true })) : videoScriptRows;
    setScriptRows(nextScript);
    setShotPlans(videoShots.map((shot, index) => ({ ...shot, selected: Boolean(nextScript[index]?.selected), scene: nextScript[index]?.scene ?? shot.scene, voiceFocus: nextScript[index]?.voiceover ?? shot.voiceFocus })));
    setFeedback(`GPT 新脚本仿写完成：已生成 ${nextScript.length} 个镜头。`);
  };

  const uploadScriptPromptFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setScriptPrompt(await file.text());
    setFeedback(`已导入视频脚本提示词：${file.name}`);
  };

  const uploadVideoScriptFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setDraftVoiceover(await file.text());
    setFeedback(`已上传视频生成脚本：${file.name}`);
  };

  const uploadScriptReferenceImages = (files: FileList | null) => {
    const assets = Array.from(files ?? []).filter((file) => file.type.startsWith("image/")).map((file) => ({
      type: "image" as const,
      name: file.name,
      url: URL.createObjectURL(file),
      source: "本地上传" as const
    }));
    setScriptReferenceImages((items) => [...items, ...assets]);
    if (assets.length) setFeedback(`已上传 ${assets.length} 张脚本仿写参考图。`);
  };

  const generateSingleVideoShot = async (shotNo: number) => {
    const shot = shotPlans.find((item) => item.no === shotNo);
    if (!shot) return;
    await fetch("/api/video/generate-selected-shots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: videoProvider,
        ratio: videoRatio,
        count: Number(videoGenerateCount),
        shot,
        script: draftVoiceover,
        referenceImages: scriptReferenceImages.map((item) => item.name)
      })
    }).catch(() => null);
    const referenceVideo = localReferenceVideo?.url ?? parsedVideoReference?.media.find((item) => item.type === "video")?.url ?? "";
    const count = Math.max(1, Math.min(4, Number(videoGenerateCount) || 1));
    const nextVideos = Array.from({ length: count }, (_, index) => ({
      id: `video_${shotNo}_${Date.now()}_${index}`,
      shotNo,
      url: referenceVideo,
      provider: videoProvider
    }));
    setGeneratedVideos((items) => [...nextVideos, ...items.filter((item) => item.shotNo !== shotNo)]);
    setShotPlans((items) => items.map((item) => item.no === shotNo ? { ...item, status: "done" as const } : item));
    setFeedback(`P${shotNo} 已生成 ${count} 条视频结果。`);
  };

  const parseReference = async (inputUrl = referenceUrl) => {
    const urlToParse = inputUrl.trim();
    if (!urlToParse) {
      setFeedback("请先粘贴或从选题库带入一个参考作品链接。");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const title = params.get("title") || draftTitle || "待解析参考作品";
    const author = (params.get("sourceAccount") || "公开参考作品").replace(/^OpenCLI · /, "");
    const likes = params.get("likes") || "-";
    const fetchedAt = params.get("fetchedAt") || new Date().toISOString().slice(0, 10);
    const rowId = `parsed_${Date.now()}`;
    const pendingRow: ReferenceRow = {
      id: rowId,
      platform: detectPlatformFromUrl(urlToParse),
      title,
      author,
      time: fetchedAt,
      likes,
      saves: "-",
      comments: "-",
      status: "解析中",
      reason: "",
      url: urlToParse
    };

    setReferenceParsing(true);
    setParsedReference(null);
    setReferenceUrl(urlToParse);
    setReferenceRows((rows) => [pendingRow, ...rows.filter((row) => row.url !== urlToParse)]);
    setFeedback("正在解析参考作品：POST /api/reference/parse-link");

    try {
      const response = await fetch("/api/reference/parse-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToParse, title, author, likes, fetchedAt })
      });
      const data = await response.json();
      const reference = data?.data?.reference ?? pendingRow;
      const parsedTitle = reference.title ?? title;
      const parsedPlatform = "小红书";
      const mediaType = reference.mediaType ?? (/视频/.test(reference.contentType ?? parsedTitle) ? "视频" : "图文");
      const parsedMedia = normalizeOpenCliMedia(reference.media);
      const parsedCopy = reference.copy || reference.content || reference.description || `暂未从公开链接解析到正文，请点击“上传标题文本”手动粘贴正文后继续仿写。当前已识别标题「${parsedTitle}」。`;
      const nextParsed: ParsedReference = {
        platform: parsedPlatform,
        title: parsedTitle,
        author: reference.author ?? author,
        copy: parsedCopy,
        url: urlToParse,
        media: parsedMedia
      };
      const imageMediaCount = parsedMedia.filter((item) => item.type === "image").length || (mediaType === "视频" ? 3 : 5);
      setParsedReference(nextParsed);
      setImagePlanItems([{ ...defaultImagePlan, title: parsedTitle, copy: parsedCopy.slice(0, 40) }]);
      setActiveImagePage(1);
      setImageCount(`${imageMediaCount} 张`);
      setReferenceRows((rows) => {
        const nextRows = rows.map((row) => row.id === rowId ? { ...row, ...reference, title: parsedTitle, platform: parsedPlatform, author: reference.author ?? author, status: "已解析", copy: parsedCopy, media: parsedMedia } : row);
        persistReferenceRows(nextRows);
        return nextRows;
      });
      setSelectedTitle(parsedTitle);
      setDraftTitle(parsedTitle);
      setDraftCopy(parsedCopy);
      setFeedback(parsedMedia.length ? "解析完成：下方已展示 OpenCLI 采集到的标题、正文和图文素材。点击“发布文案生成”后会生成候选标题与文案。" : "解析完成：已采集到标题和正文，但 OpenCLI 没有返回可展示图片；请确认链接公开可访问。");
    } catch (error) {
      setReferenceRows((rows) => rows.map((row) => row.id === rowId ? { ...row, status: "解析失败", reason: error instanceof Error ? error.message : "接口调用失败" } : row));
      setFeedback("解析失败：可点击手动粘贴标题正文继续。");
    } finally {
      setReferenceParsing(false);
    }
  };

  const uploadProductImage = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const storageUrl = await persistImageFile(file, `product_${Date.now()}`);
    const url = await resolveImageRef(storageUrl);
    setProductImage({ name: file.name, url: url || URL.createObjectURL(file), storageUrl });
    setFeedback(`已上传产品图：${file.name}`);
  };

  const uploadLocalReferenceImages = async (files: FileList | null) => {
    const assets = await Promise.all(Array.from(files ?? []).filter((file) => file.type.startsWith("image/")).map(async (file, index) => {
      const storageUrl = await persistImageFile(file, `local_source_${Date.now()}_${index}`);
      const url = await resolveImageRef(storageUrl);
      return {
        type: "image" as const,
        name: file.name,
        url: url || URL.createObjectURL(file),
        storageUrl,
        source: "本地上传" as const
      };
    }));
    setLocalImageSources((items) => [...items, ...assets]);
    if (assets.length) setFeedback(`已上传 ${assets.length} 张本地素材，可拖入右侧生成页面。`);
  };

  const chooseSourceForPlan = async (page: number, asset: ImageSourceAsset) => {
    const stableAsset = await stabilizeImageSource(asset, `plan_source_${page}_${Date.now()}`);
    setPlanSourceMap((items) => {
      const existing = items[page] ?? [];
      if (existing.some((item) => (item.storageUrl ?? item.url) === (stableAsset.storageUrl ?? stableAsset.url))) return items;
      return { ...items, [page]: [...existing, stableAsset] };
    });
  };

  const removeSourceFromPlan = (page: number, assetUrl: string) => {
    setPlanSourceMap((items) => ({ ...items, [page]: (items[page] ?? []).filter((item) => item.url !== assetUrl) }));
  };

  const removeSourceAsset = (asset: ImageSourceAsset) => {
    if (asset.source === "本地上传") setLocalImageSources((items) => items.filter((item) => item.url !== asset.url));
    if (asset.source === "素材库") setLibraryImageSources((items) => items.filter((item) => item.url !== asset.url));
    if (asset.source === "产品素材库") setProductImageSources((items) => items.filter((item) => item.url !== asset.url));
    setPlanSourceMap((items) => Object.fromEntries(Object.entries(items).map(([page, sources]) => [page, sources.filter((item) => item.url !== asset.url)])));
  };

  const viewReferenceRow = (row: ReferenceRow) => {
    if (!row.copy && !row.media?.length) {
      setFeedback("这条记录还没有可查看的解析内容，请重新解析。");
      return;
    }
    const nextParsed = {
      platform: row.platform,
      title: row.title,
      author: row.author,
      copy: row.copy ?? "",
      url: row.url ?? "",
      media: row.media ?? []
    };
    setParsedReference(nextParsed);
    setReferenceUrl(row.url ?? referenceUrl);
    setDraftTitle(row.title);
    setSelectedTitle(row.title);
    if (row.copy) setDraftCopy(row.copy);
    setFeedback("已打开这条参考内容的解析结果。");
  };

  const deleteReferenceRow = (row: ReferenceRow) => {
    setReferenceRows((rows) => {
      const nextRows = rows.filter((item) => item.id !== row.id);
      persistReferenceRows(nextRows);
      return nextRows;
    });
    if (parsedReference?.url && row.url === parsedReference.url) setParsedReference(null);
    setFeedback(`已删除解析记录：${row.title}`);
  };

  const loadMaterialImages = async () => {
    const assets = await Promise.all(readMaterialLibrary().map(hydrateMaterialAsset));
    const images = flattenMaterialImages(assets);
    setMaterialPickerAssets(images);
    setSelectedMaterialUrls(libraryImageSources.map((item) => item.url));
    setMaterialPickerOpen(true);
    setFeedback(images.length ? `已打开素材库选择器，共 ${images.length} 张图片素材。` : "素材库里暂时没有可选择的图片素材。");
  };

  const confirmMaterialPicker = async () => {
    const selected = await Promise.all(materialPickerAssets
      .filter((asset) => selectedMaterialUrls.includes(asset.url))
      .map((asset, index) => stabilizeImageSource(asset, `material_source_${Date.now()}_${index}`)));
    setLibraryImageSources(selected);
    setMaterialPickerOpen(false);
    setFeedback(selected.length ? `已选择 ${selected.length} 张素材库图片，可拖入右侧生成页面。` : "未选择素材库图片。");
  };

  const toggleMaterialPickerAsset = (asset: ImageSourceAsset) => {
    setSelectedMaterialUrls((items) => items.includes(asset.url) ? items.filter((url) => url !== asset.url) : [...items, asset.url]);
  };

  const refreshProductLibraryProducts = async () => {
    const products = await readProductLibraryProducts();
    setProductLibraryProducts(products);
    return products;
  };

  const importProductAssets = async (productId: string) => {
    const products = await refreshProductLibraryProducts();
    setSelectedProductId(productId);
    const selectedIndex = products.findIndex((product, index) => productLibraryKey(product, index) === productId);
    const product = selectedIndex >= 0 ? products[selectedIndex] : null;
    if (!product) {
      setProductImageSources([]);
      setFeedback("请选择产品资料库里的产品。");
      return;
    }
    const assets = await Promise.all(productAssetsForPool(product).map((asset, index) => stabilizeImageSource(asset, `product_source_${Date.now()}_${index}`)));
    setProductImageSources(assets);
    const imageCount = assets.filter((asset) => asset.type === "image").length;
    const videoCount = assets.filter((asset) => asset.type === "video").length;
    setFeedback(assets.length ? `已导入「${product.name}」的产品素材：图片 ${imageCount} 张，视频 ${videoCount} 条。` : `「${product.name}」暂时没有图片或视频素材，请先在产品资料库补充。`);
  };

  const dragSourceAsset = (event: DragEvent, asset: ImageSourceAsset) => {
    event.dataTransfer.setData("application/json", JSON.stringify(asset));
    event.dataTransfer.effectAllowed = "copy";
  };

  const dropSourceAssetToPlan = (event: DragEvent, page: number) => {
    event.preventDefault();
    const rawAsset = event.dataTransfer.getData("application/json");
    if (!rawAsset) return;
    try {
      const asset = JSON.parse(rawAsset) as ImageSourceAsset;
      if (asset?.type === "image" && asset.url) {
        void chooseSourceForPlan(page, asset);
        setFeedback(`已把 ${asset.name} 拖入 P${page}。`);
      }
    } catch {
      setFeedback("拖入素材失败，请重新拖拽图片。");
    }
  };

  const imageUrlForModelRequest = async (url: string) => {
    if (url.startsWith("data:image/") || /^https?:\/\//i.test(url)) return url;
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  };

  const generateSinglePlanImage = async (page: number) => {
    const plan = imagePlanItems.find((item) => item.page === page);
    if (!plan) return;
    const count = Math.max(1, Math.min(10, Number(planCountMap[page] || "1")));
    const provider = planProviderMap[page] ?? imageProvider;
    const previousPageImageUrls = generatedImages.filter((image) => image.planPage === page).map(generatedImageKey);
    setGeneratingImagePages((items) => ({ ...items, [page]: provider }));
    setImagePlanItems((items) => items.map((item) => item.page === page ? { ...item, status: "generating" as const } : item));
    setFeedback(`P${page} 正在调用 ${provider} 生成图片，真实模型通常需要 30-90 秒；其他页面可以继续生成。`);
    try {
      const selectedSources = planSourceMap[page] ?? [];
      const sourceImageUrls = await Promise.all(selectedSources.map((item) => imageUrlForModelRequest(item.url).catch(() => "")));
      const response = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          sourceImages: selectedSources.map((item) => item.name),
          sourceImageUrls: sourceImageUrls.filter(Boolean),
          prompt: planPromptMap[page] ?? "",
          size: planSizeMap[page] || "3:4",
          count,
          plan
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.message || data?.error || "图片接口返回异常");
      const result = data?.data ?? data;
      const imageUrls = extractGeneratedImageUrls((result as { images?: unknown } | undefined)?.images ?? result);
      if (!imageUrls.length && !provider.includes("仅生成提示词")) throw new Error("模型接口已返回，但未解析到图片 URL / base64。请查看服务日志中的 raw 返回格式。");
      const nextImages = (imageUrls.length ? imageUrls : Array.from({ length: count }, (_, index) => mockSvg(`P${page}-${index + 1}`, index % 2 ? "#ecfeff" : "#fff7ed"))).slice(0, count).map((url, index) => ({
        id: `generated_${page}_${Date.now()}_${index}`,
        planPage: page,
        url,
        provider
      }));
      if (previousPageImageUrls.length) {
        setFinishedImageAssignments((items) => {
          let changed = false;
          const previousUrls = new Set(previousPageImageUrls);
          const next = Object.fromEntries(Object.entries(items).map(([workIndex, urls]) => {
            const filteredUrls = urls.filter((url) => !previousUrls.has(url));
            if (filteredUrls.length !== urls.length) changed = true;
            return [workIndex, filteredUrls];
          }));
          return changed ? next : items;
        });
      }
      setGeneratedImages((items) => [...nextImages, ...items.filter((item) => item.planPage !== page)]);
      setImagePlanItems((items) => items.map((item) => item.page === page ? { ...item, status: "done" as const } : item));
      setFeedback(imageUrls.length ? `P${page} 已通过 ${provider} 生成 ${nextImages.length} 张图片。` : `P${page} 已生成本地提示词占位图。`);
    } catch (error) {
      setImagePlanItems((items) => items.map((item) => item.page === page ? { ...item, status: "failed" as const } : item));
      setFeedback(error instanceof Error ? `P${page} 生成失败：${error.message}` : `P${page} 生成失败。`);
    } finally {
      setGeneratingImagePages((items) => {
        const next = { ...items };
        delete next[page];
        return next;
      });
    }
  };

  const addImagePlanPage = () => {
    const nextPage = Math.max(0, ...imagePlanItems.map((item) => item.page)) + 1;
    setImagePlanItems((items) => [...items, {
      ...imagePlans[(nextPage - 1) % imagePlans.length],
      page: nextPage,
      type: `自定义图 ${nextPage}`,
      use: "自定义新增页面",
      title: draftTitle,
      copy: draftCopy.slice(0, 40),
      status: "pending" as const
    }]);
    setActiveImagePage(nextPage);
    setFeedback(`已新增 P${nextPage} 页面。`);
  };

  const deleteImagePlanPage = (page: number) => {
    if (imagePlanItems.length <= 1) {
      setFeedback("至少保留一个生成页面。");
      return;
    }
    setImagePlanItems((items) => items.filter((item) => item.page !== page));
    setGeneratedImages((items) => items.filter((item) => item.planPage !== page));
    setPlanSourceMap((items) => {
      const next = { ...items };
      delete next[page];
      return next;
    });
    setPlanPromptMap((items) => {
      const next = { ...items };
      delete next[page];
      return next;
    });
    setPlanProviderMap((items) => {
      const next = { ...items };
      delete next[page];
      return next;
    });
    setGeneratingImagePages((items) => {
      const next = { ...items };
      delete next[page];
      return next;
    });
    setActiveImagePage((current) => current === page ? imagePlanItems.find((item) => item.page !== page)?.page ?? 1 : current);
    setFeedback(`已删除 P${page} 页面。`);
  };

  const reorderImagePlanPage = (sourcePage: number, targetPage: number) => {
    if (sourcePage === targetPage) return;
    setImagePlanItems((current) => {
      const ordered = [...current].sort((a, b) => a.page - b.page);
      const sourceIndex = ordered.findIndex((item) => item.page === sourcePage);
      const targetIndex = ordered.findIndex((item) => item.page === targetPage);
      if (sourceIndex < 0 || targetIndex < 0) return current;

      const moved = [...ordered];
      const [sourceItem] = moved.splice(sourceIndex, 1);
      moved.splice(targetIndex, 0, sourceItem);
      const oldToNew = new Map<number, number>();
      moved.forEach((item, itemIndex) => oldToNew.set(item.page, itemIndex + 1));

      const remapRecord = <T,>(record: Record<number, T>) => {
        const next: Record<number, T> = {};
        Object.entries(record).forEach(([oldPage, value]) => {
          const nextPage = oldToNew.get(Number(oldPage));
          if (nextPage) next[nextPage] = value as T;
        });
        return next;
      };

      setPlanSourceMap((items) => remapRecord(items));
      setPlanPromptMap((items) => remapRecord(items));
      setPlanSizeMap((items) => remapRecord(items));
      setPlanCountMap((items) => remapRecord(items));
      setPlanProviderMap((items) => remapRecord(items));
      setGeneratingImagePages((items) => remapRecord(items));
      setGeneratedImages((items) => items.map((image) => ({ ...image, planPage: oldToNew.get(image.planPage) ?? image.planPage })));
      setActiveImagePage(oldToNew.get(sourcePage) ?? sourcePage);
      setFeedback(`已调整页面顺序，并按新顺序重新编号。`);

      return moved.map((item, itemIndex) => ({
        ...item,
        page: itemIndex + 1,
        type: item.type.startsWith("自定义图") ? `自定义图 ${itemIndex + 1}` : item.type
      }));
    });
  };

  const toggleLocalSaveSelection = (imageUrl: string) => {
    setLocalSaveSelectedUrls((items) => items.includes(imageUrl) ? items.filter((url) => url !== imageUrl) : [...items, imageUrl]);
  };

  const saveImageProjectLocally = async () => {
    if (!localSaveSelectedUrls.length) {
      setFeedback("请先勾选要保存的图片。");
      return;
    }
    setLocalSaveSaving(true);
    try {
      const selectedImages = localSaveSelectedUrls.flatMap((imageUrl) => {
        const image = generatedImages.find((item) => generatedImageKey(item) === imageUrl);
        return image ? [image] : [];
      });
      const pageCounts = new Map<number, number>();
      const files = [];
      let readFailures = 0;
      for (const image of selectedImages) {
        try {
          const blob = await imageUrlToBlob(generatedImageKey(image));
          const nextIndex = (pageCounts.get(image.planPage) ?? 0) + 1;
          pageCounts.set(image.planPage, nextIndex);
          const prefix = image.planPage > 0 ? `P${image.planPage}` : "本地";
          files.push({ name: `${prefix}_${nextIndex}.${imageExtension(blob)}`, blob });
        } catch {
          readFailures += 1;
        }
      }

      if (!files.length) throw new Error("勾选的图片均无法读取，请重新生成或上传。");
      if (localSaveDirectory) {
        const result = await writeBlobFiles(localSaveDirectory, files);
        const failed = result.failed + readFailures;
        setFeedback(`已保存 ${result.saved} 张图片到 ${localSaveDirectory.name}${failed ? `，${failed} 张失败` : ""}。`);
        if (result.saved) setSaveDialogOpen(false);
        return;
      }

      files.forEach((file) => downloadBlob(file.blob, file.name));
      setFeedback(`当前浏览器不支持直接写入文件夹，已下载 ${files.length} 张所选图片${readFailures ? `，${readFailures} 张读取失败` : ""}。`);
      setSaveDialogOpen(false);
    } catch (error) {
      setFeedback(error instanceof Error ? `保存失败：${error.message}` : "保存失败，请重试。");
    } finally {
      setLocalSaveSaving(false);
    }
  };

  const openFinishedPreview = () => {
    setFinishedImageAssignments({});
    setExpandedPreviewWork(0);
    setPreviewImagePageFilter("全部");
    setFinishedPreviewOpen(true);
  };

  const toggleFinishedImageAssignment = (workIndex: number, imageUrl: string) => {
    setFinishedImageAssignments((items) => {
      const current = items[workIndex] ?? [];
      const next = current.includes(imageUrl)
        ? current.filter((url) => url !== imageUrl)
        : [...current, imageUrl];
      return { ...items, [workIndex]: next };
    });
  };

  const reorderFinishedImageAssignment = (workIndex: number, sourceUrl: string, targetUrl: string) => {
    setFinishedImageAssignments((items) => reorderAssignedImages(items, workIndex, sourceUrl, targetUrl));
  };

  const uploadFinishedImages = async (workIndex: number, files: FileList | null) => {
    const imageFiles = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const uploaded = await Promise.all(imageFiles.map(async (file, index) => {
      const storageUrl = await persistImageFile(file, `finished_upload_${Date.now()}_${workIndex}_${index}`);
      const url = await resolveImageRef(storageUrl);
      return {
        id: `finished_upload_${Date.now()}_${workIndex}_${index}`,
        planPage: 0,
        url: url || URL.createObjectURL(file),
        storageUrl,
        provider: "本地上传"
      } satisfies GeneratedImagePreview;
    }));
    setGeneratedImages((items) => [...uploaded, ...items]);
    setFinishedImageAssignments((items) => ({
      ...items,
      [workIndex]: [...(items[workIndex] ?? []), ...uploaded.map(generatedImageKey)]
    }));
    setFeedback(`已为作品 ${workIndex + 1} 上传并选择 ${uploaded.length} 张本地图片。`);
  };

  const chooseLocalSaveFolder = async () => {
    const pickerWindow = window as Window & { showDirectoryPicker?: () => Promise<WritableDirectoryLike> };
    if (pickerWindow.showDirectoryPicker) {
      try {
        const handle = await pickerWindow.showDirectoryPicker();
        setLocalSaveDirectory(handle);
        setSavePath(handle.name);
        setFeedback(`已选择本地保存文件夹：${handle.name}`);
        return;
      } catch {
        return;
      }
    }
    setLocalSaveDirectory(null);
    setSavePath("浏览器默认下载目录");
    setFeedback("当前浏览器不支持直接写入文件夹，确认保存后会下载所选图片。");
  };

  const compactFinishedItems = async (items: unknown[]) => Promise.all(items.map(async (item) => {
    if (!item || typeof item !== "object") return item;
    const record = item as { id?: string; mediaUrls?: string[]; pages?: Array<{ images?: string[] }> };
    return {
      ...record,
      mediaUrls: Array.isArray(record.mediaUrls) ? await persistImageRefs(record.mediaUrls, `legacy_${record.id ?? Date.now()}`) : record.mediaUrls,
      pages: Array.isArray(record.pages) ? record.pages.map((page) => ({ ...page, images: [] })) : record.pages
    };
  }));

  const saveFinishedContent = async (kind: "image" | "video", status = "需复查") => {
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const imagePages = [...imagePlanItems].sort((a, b) => a.page - b.page).map((plan) => ({
      page: plan.page,
      title: planPromptMap[plan.page] ? `P${plan.page}` : plan.title,
      copy: plan.copy,
      prompt: planPromptMap[plan.page] ?? "",
      provider: planProviderMap[plan.page] ?? imageProvider,
      images: [],
      sourceImages: (planSourceMap[plan.page] ?? []).map((source) => source.url)
    }));
    const current = await compactFinishedItems(JSON.parse(window.localStorage.getItem(FINISHED_CONTENT_STORAGE_KEY) || "[]") as unknown[]);
    if (kind === "image") {
      const assignments = finishedImageAssignments;
      const imageItems = await Promise.all(selectedBatchDrafts.map(async (draft, workIndex) => {
        const mediaUrls = await persistImageRefs((assignments[workIndex] ?? []).filter(Boolean), `finished_${Date.now()}_${workIndex + 1}`);
        return {
          id: `CP-${Date.now()}-${workIndex + 1}`,
          title: draft.title,
          summary: draft.copy.slice(0, 80),
          body: draft.copy,
          platform: parsedReference?.platform ?? "小红书",
          platformBadge: "RED",
          account: accounts.find((account) => account.id === targetAccount)?.name ?? "本地账号",
          type: contentType,
          mediaCount: `${mediaUrls.length || imagePlanItems.length} 张图`,
          mediaKind: kind,
          mediaUrls,
          pages: imagePages.map((page) => ({
            ...page,
            title: `作品${workIndex + 1} · P${page.page}`,
            copy: draft.copy.slice(0, 80),
            images: []
          })),
          referenceSources: parsedReference ? [{ title: parsedReference.title, url: parsedReference.url, platform: parsedReference.platform, media: parsedReference.media }] : [],
          tags: draft.tags,
          duplicateRate: 0,
          duplicateLabel: "待检测",
          lowFlowRisk: "低",
          status,
          localPath: `outputs/content/${Date.now()}_${workIndex + 1}_${draft.title}`,
          createdAt: now,
          updatedAt: now,
          prompts: imagePlanItems.map((item) => planPromptMap[item.page] ?? ""),
          negativePrompts: imagePlanItems.map((item) => item.negativePrompt),
          checkAdvice: ["已从批量图文生产流程保存"],
          reviewNotes: [`${now} 批量保存到成品内容库`]
        };
      }));
      window.localStorage.setItem(FINISHED_CONTENT_STORAGE_KEY, JSON.stringify([...imageItems, ...current]));
      setFeedback(`已保存 ${imageItems.length} 条图文成品到成品内容库。`);
      return;
    }
    const mediaUrls = generatedVideos.map((video) => video.url).filter(Boolean);
    const item = {
      id: `CP-${Date.now()}`,
      title: selectedVideoTitle,
      summary: draftVoiceover.slice(0, 80),
      body: draftVoiceover,
      platform: parsedVideoReference?.platform ?? "小红书",
      platformBadge: "RED",
      account: accounts.find((account) => account.id === targetAccount)?.name ?? "本地账号",
      type: "短视频",
      mediaCount: `${shotPlans.filter((shot) => shot.selected).length} 个镜头`,
      mediaKind: kind,
      mediaUrls,
      pages: [],
      referenceSources: parsedReference ? [{ title: parsedReference.title, url: parsedReference.url, platform: parsedReference.platform, media: parsedReference.media }] : [],
      tags: trafficTags.slice(0, 5),
      duplicateRate: 0,
      duplicateLabel: "待检测",
      lowFlowRisk: "低",
      status,
      localPath: `outputs/video/${Date.now()}_${selectedVideoTitle}`,
      createdAt: now,
      updatedAt: now,
      prompts: shotPlans.map((item) => item.prompt),
      negativePrompts: shotPlans.map((item) => item.negativePrompt),
      checkAdvice: ["已从内容生产流程保存，等待进入审核检测"],
      reviewNotes: [`${now} 保存到成品内容库`]
    };
    window.localStorage.setItem(FINISHED_CONTENT_STORAGE_KEY, JSON.stringify([item, ...current]));
    setFeedback(`已保存到成品内容库：${item.title}`);
  };

  const confirmSaveFinishedImage = async () => {
    setFinishedSaving(true);
    try {
      await saveFinishedContent("image", "需复查");
      setFinishedPreviewOpen(false);
      window.location.href = "/content-library";
    } catch (error) {
      const message = error instanceof DOMException && error.name === "QuotaExceededError"
        ? "保存失败：图片数据太大，浏览器本地存储空间不足。请减少生成图片数量，或先删除成品内容库里的旧记录。"
        : error instanceof Error ? `保存失败：${error.message}` : "保存失败，请重试。";
      setFeedback(message);
      window.alert(message);
    } finally {
      setFinishedSaving(false);
    }
  };

  const saveVideoToContentLibrary = async () => {
    await saveFinishedContent("video", "需复查");
    setVideoFinishedPreviewOpen(false);
    window.location.href = "/content-library";
  };

  const uploadPromptFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setImagePromptText(await file.text());
    setFeedback(`已导入提示词文件：${file.name}`);
  };

  const generateImagePreviews = async () => {
    setFeedback(`正在通过 ${imageProvider} 生成图片：POST /api/image/generate`);
    try {
      await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: imageProvider,
          productImage: productImage?.name,
          prompt: imagePromptText,
          size: imageSize,
          count: Number(generateCount),
          plans: imagePlanItems
        })
      });
    } catch {
      // Mock preview still renders when no API key or local adapter is unavailable.
    }
    const variations = Math.max(1, Math.min(10, Number(generateCount) || 1));
    const nextImages = imagePlanItems.flatMap((plan) => Array.from({ length: variations }, (_, index) => ({
      id: `generated_${plan.page}_${Date.now()}_${index}`,
      planPage: plan.page,
      url: mockSvg(`P${plan.page}-${index + 1}`, index % 2 ? "#ecfeff" : "#fff7ed"),
      provider: imageProvider
    })));
    setGeneratedImages(nextImages);
    setImagePlanItems((items) => items.map((item) => ({ ...item, status: "done" as const })));
    setFeedback(`图片生成完成：已为 ${imagePlanItems.length} 张规划图生成可视化结果。`);
  };

  const importReferenceText = async () => {
    const [rawTitle, ...copyLines] = uploadText.split(/\r?\n/);
    const title = rawTitle.trim() || "手动导入参考标题";
    const copy = copyLines.join("\n").trim() || "手动导入正文为空，请继续补充参考正文。";
    const media: ParsedReferenceMedia[] = [];
    const row: ReferenceRow = {
      id: `text_${Date.now()}`,
      platform: "文本导入",
      title,
      author: "手动整理",
      time: new Date().toISOString().slice(0, 10),
      likes: "-",
      saves: "-",
      comments: "-",
      status: "已导入文本",
      reason: ""
    };
    setParsedReference({ platform: "小红书文本导入", title, author: "手动整理", copy, url: "", media });
    setReferenceRows((rows) => {
      const nextRows = [{ ...row, copy, media }, ...rows].slice(0, 3);
      persistReferenceRows(nextRows);
      return nextRows;
    });
    setSelectedTitle(title);
    setDraftTitle(title);
    setDraftCopy(copy);
    setImagePlanItems([{ ...defaultImagePlan, title, copy: copy.slice(0, 40) }]);
    setActiveImagePage(1);
    setImageCount("1 张");
    setUploadOpen(false);
    setFeedback("已导入标题文本：第一行作为标题，第二行开始作为正文。点击“发布文案生成”可生成候选。");
  };

  return (
    <>
      <PageHeader
        title="图文生产状态"
        description="从公开参考链接解析、发布文案生成到图片生成，全流程仅在本地模拟与保存。"
      />

      <div className="rounded-md bg-orange-50 px-4 py-3 text-sm text-orange-700">{feedback}</div>

      {tab === "图文内容" ? (
        <section className="space-y-5">
          <StepNav steps={imageSteps} value={imageStep} onChange={setImageStep} />

          {imageStep === "发布文案生成" ? (
            <div className="grid gap-5 2xl:grid-cols-[1.05fr_0.85fr_0.9fr_1fr] xl:grid-cols-2">
              <Card>
                <CardHeader title="参考内容输入区" subtitle="粘贴公开参考链接，后续通过 adapter 自动识别平台；也支持手动导入标题正文。" />
                <CardBody className="space-y-4">
                  <label className="flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm text-muted">
                    <Link2 className="h-4 w-4 text-orange-600" />
                    <input value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} className="w-full outline-none" placeholder="粘贴小红书参考链接" />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button icon={<FileText className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>上传标题文本</Button>
                    <Button variant="primary" icon={<UploadCloud className="h-4 w-4" />} disabled={referenceParsing} onClick={() => void parseReference()}>{referenceParsing ? "OpenCLI采集中..." : "开始解析"}</Button>
                  </div>
                  {referenceParsing ? (
                    <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-4 text-sm text-orange-700">正在打开复制链接并调用 OpenCLI 采集标题、正文、图片和视频，请稍等...</div>
                  ) : null}
                  {parsedReference ? (
                    <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-ink">{parsedReference.title}</p>
                          <p className="mt-1 text-xs text-muted">{platformShortName(parsedReference.platform)} · {parsedReference.author}</p>
                        </div>
                        <StatusBadge status="approved" label="已解析" />
                      </div>
                      <div className="mt-3 max-h-44 overflow-y-auto rounded-md bg-white/80 px-3 py-2 text-sm leading-6 text-ink">{parsedReference.copy}</div>
                      {parsedReference.media.length ? (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {parsedReference.media.map((media) => (
                          <div key={media.name} className="relative overflow-hidden rounded-md border border-white bg-white">
                            {media.type === "video" ? (
                              <video src={media.url} className="h-24 w-full object-cover" muted playsInline />
                            ) : (
                              <button onClick={() => setPreviewImage({ id: media.url, planPage: 0, url: media.url, provider: media.name })} className="block w-full">
                                <img src={media.url} alt={media.name} className="h-24 w-full object-cover transition hover:scale-[1.02]" />
                              </button>
                            )}
                            <span className="absolute left-1 top-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-white">{media.type === "video" ? "视频" : "图文"}</span>
                            <p className="truncate px-2 py-1 text-[11px] text-muted">{media.name}</p>
                          </div>
                        ))}
                      </div>
                      ) : <p className="mt-3 rounded-md bg-white/80 px-3 py-2 text-xs text-muted">OpenCLI 暂未返回可展示的图文素材，标题和正文已采集。</p>}
                      <div className="mt-3 rounded-md bg-white/80 p-3">
                        <p className="text-xs font-medium text-muted">仿写指令</p>
                        <div className="mt-2 grid gap-2">
                          <input
                            value={imitationProduct}
                            onChange={(event) => setImitationProduct(event.target.value)}
                            className="h-9 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300"
                            placeholder="产品名"
                          />
                          <textarea
                            value={imitationPrompt}
                            onChange={(event) => setImitationPrompt(event.target.value)}
                            className="min-h-20 rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300"
                            placeholder="提示词（选填）：给 DeepSeek 的额外要求，例如语气、卖点、禁用词、风格"
                          />
                        </div>
                      </div>
                      <Button className="mt-3 w-full" variant="primary" icon={<Sparkles className="h-4 w-4" />} disabled={imitationLoading} onClick={() => void generateImitationCandidates()}>
                        {imitationLoading ? "发布文案生成中..." : "发布文案生成"}
                      </Button>
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    {referenceRows.map((item) => (
                      <div key={item.id} className="rounded-lg border border-line p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-ink">{item.title}</p>
                            <p className="mt-1 text-xs text-muted">{item.platform} · {item.author} · {item.time}</p>
                          </div>
                          <StatusBadge status={item.status === "已解析" || item.status === "已导入文本" ? "approved" : item.status === "解析失败" ? "rejected" : "pending"} label={item.status} />
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted">
                          <span>点赞 {item.likes}</span>
                          <span>收藏 {item.saves}</span>
                          <span>评论 {item.comments}</span>
                        </div>
                        {item.reason ? <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">失败原因：{item.reason}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.url ? <a className="inline-flex h-8 items-center justify-center rounded-md border border-line bg-white px-2 text-xs font-medium text-ink transition hover:bg-orange-50" href={item.url} target="_blank" rel="noreferrer">查看原作品</a> : null}
                          <Button className="h-8 px-2 text-xs" onClick={() => viewReferenceRow(item)}>查看解析</Button>
                          <Button className="h-8 px-2 text-xs" onClick={() => { if (item.url) void parseReference(item.url); }}>重新解析</Button>
                          <Button className="h-8 px-2 text-xs" variant="danger" onClick={() => deleteReferenceRow(item)}>删除</Button>
                          {item.status === "解析失败" ? <Button className="h-8 px-2 text-xs" onClick={() => setUploadOpen(true)}>手动粘贴标题正文</Button> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>

              <Card className="overflow-hidden xl:col-span-1 2xl:col-span-2">
                <CardHeader title="完整作品候选（10条）" subtitle="每条包含标题、文案和关键词；点击后同步到右侧当前作品。" />
                <CardBody className="max-h-[680px] overflow-y-auto bg-slate-50 p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    {batchCandidates.map((item, index) => {
                      const usedIndex = selectedBatchDrafts.findIndex((draft) => draft.title === item.title && draft.copy === item.copy);
                      return (
                      <button key={`${item.id}-${index}`} onClick={() => selectBatchCandidate(item)} className={cn("relative rounded-lg border bg-white p-3 text-left transition hover:border-orange-200 hover:bg-orange-50/40", usedIndex >= 0 ? "border-orange-300 bg-orange-50/50 ring-1 ring-orange-100" : "border-line")}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700">{index + 1}</span>
                          <div className="flex flex-wrap justify-end gap-1">
                            {usedIndex >= 0 ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">已选到作品 {usedIndex + 1}</span> : null}
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-muted">{item.style}</span>
                          </div>
                        </div>
                        <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-ink">{item.title}</h3>
                        <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted">{item.copy}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {item.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700">{tag}</span>)}
                        </div>
                      </button>
                      );
                    })}
                  </div>
                  <Button className="mt-3 w-full bg-white" onClick={() => void generateImitationCandidates()}>重新生成 10 条</Button>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title={`选中标题与完整文案（${selectedBatchDrafts.length}条）`} subtitle="默认 1 条，可新增；有几条作品，最后就打包几条成品。" action={<Button className="h-8 px-3 text-xs" onClick={addSelectedBatchDraft}>新增作品</Button>} />
                <CardBody className="space-y-3">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {selectedBatchDrafts.map((item, index) => (
                      <button key={`jump-${item.id}`} onClick={() => setActiveBatchIndex(index)} className={cn("h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition", activeBatchIndex === index ? "border-orange-300 bg-orange-500 text-white" : "border-line bg-white text-muted hover:bg-orange-50")}>作品 {index + 1}</button>
                    ))}
                  </div>
                  {selectedBatchDrafts[activeBatchIndex] ? (() => {
                    const item = selectedBatchDrafts[activeBatchIndex];
                    const index = activeBatchIndex;
                    return (
                    <div key={item.id} className="rounded-lg border border-orange-300 bg-orange-50/50 p-3 transition">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold text-ink">作品 {index + 1}</p>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs text-muted ring-1 ring-line">{item.style}</span>
                          {selectedBatchDrafts.length > 1 ? <button onClick={(event) => { event.stopPropagation(); removeSelectedBatchDraft(index); }} className="rounded-full px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">删除</button> : null}
                        </div>
                      </div>
                      <label className="block"><FieldLabel count={`${item.title.length}/30`}>选中标题</FieldLabel><input value={item.title} onChange={(event) => updateBatchDraft(index, { title: event.target.value })} className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" /></label>
                      <label className="mt-3 block"><FieldLabel count={`${item.copy.length}/2000`}>完整文案</FieldLabel><textarea value={item.copy} onChange={(event) => updateBatchDraft(index, { copy: event.target.value })} className="min-h-36 w-full rounded-md border border-line px-3 py-2 text-sm leading-7 outline-none focus:border-orange-300" /></label>
                      <div className="mt-3">
                        <p className="mb-2 text-xs font-medium text-muted">关键词库</p>
                        <div className="mb-2 flex gap-2">
                          <input value={customKeywordDraft} onChange={(event) => setCustomKeywordDraft(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300" placeholder="自己填写关键词" />
                          <Button className="h-9 px-3 text-xs" onClick={addCustomKeyword}>添加</Button>
                        </div>
                        <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto rounded-md border border-line bg-white p-2">
                          {visibleKeywordLibrary.map((tag) => {
                            const checked = item.tags.includes(tag);
                            return (
                              <span key={tag} className={cn("group inline-flex items-center overflow-hidden rounded-full text-xs font-medium ring-1 transition", checked ? "bg-orange-50 text-orange-700 ring-orange-100" : "bg-slate-50 text-muted ring-line hover:bg-orange-50 hover:text-orange-700")}>
                                <button onClick={(event) => { event.stopPropagation(); toggleBatchKeyword(index, tag); }} className="px-3 py-1">{tag}</button>
                                <button onClick={(event) => { event.stopPropagation(); deleteKeywordFromLibrary(tag); }} className="border-l border-current/15 px-2 py-1 text-[11px] hover:bg-white/70" title={`删除${tag}`}>×</button>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    );
                  })() : null}
                  <div className="grid gap-2 md:grid-cols-2">
                    <Button onClick={() => void generateImitationCandidates()}>重新生成文案</Button>
                    <Button variant="primary" onClick={() => { setImageStep("图片生成"); setFeedback(`已保存 ${selectedBatchDrafts.length} 条文案，并进入图片生成。`); }}>保存并进入下一步</Button>
                  </div>
                </CardBody>
              </Card>
            </div>
          ) : null}

          {imageStep === "图片生成" ? (
            <div className="grid h-[calc(100vh-170px)] min-h-[640px] gap-5 overflow-hidden xl:grid-cols-[0.38fr_1fr]">
              <Card className="flex min-h-0 flex-col overflow-hidden">
                <CardHeader title="参考素材池" subtitle="链接解析素材、本地上传素材和素材库素材都可以拖到右侧生成页。" />
                <CardBody className="min-h-0 flex-1 space-y-4 overflow-hidden">
                  <input id="local-reference-images" type="file" accept="image/*" multiple className="hidden" onChange={(event) => void uploadLocalReferenceImages(event.target.files)} />
                  <div className="h-full space-y-4 overflow-y-auto pr-1">
                    <AssetSection title="链接解析素材" assets={(parsedReference?.media ?? []).filter((item) => item.type === "image").map((item) => ({ ...item, source: "链接解析" as const }))} emptyText="还没有链接解析图片。" onDrag={dragSourceAsset} onPreview={(asset) => setPreviewImage({ id: asset.url, planPage: 0, url: asset.url, provider: asset.name })} />
                    <AssetSection
                      title="产品素材库"
                      assets={productImageSources}
                      emptyText="请选择产品资料库里的产品，系统会自动导入该产品的图片和视频。"
                      headerExtra={
                        <select
                          value={selectedProductId}
                          onFocus={refreshProductLibraryProducts}
                          onChange={(event) => void importProductAssets(event.target.value)}
                          className="h-9 w-full rounded-md border border-line bg-white px-3 text-sm text-ink outline-none focus:border-orange-300"
                        >
                          <option value="">选择产品素材</option>
                          {productLibraryProducts.map((product, index) => (
                            <option key={productLibraryKey(product, index)} value={productLibraryKey(product, index)}>
                              {product.name}{product.category ? ` · ${product.category}` : ""}
                            </option>
                          ))}
                        </select>
                      }
                      onDrag={dragSourceAsset}
                      onPreview={(asset) => asset.type === "image" ? setPreviewImage({ id: asset.url, planPage: 0, url: asset.url, provider: asset.name }) : setFeedback("视频素材已导入产品素材库，可在后续视频流程中使用。")}
                      onDelete={removeSourceAsset}
                    />
                    <AssetSection title="本地上传素材" assets={localImageSources} emptyText="暂无本地素材，请点右上角选择本地图片。" actionLabel="选择本地图片" onEmptyClick={() => document.getElementById("local-reference-images")?.click()} onDrag={dragSourceAsset} onPreview={(asset) => setPreviewImage({ id: asset.url, planPage: 0, url: asset.url, provider: asset.name })} onDelete={removeSourceAsset} />
                    <AssetSection title="素材库素材" assets={libraryImageSources} emptyText="暂无素材库图片，请点右上角打开素材库选择。" actionLabel="打开素材库选择" onEmptyClick={() => void loadMaterialImages()} onDrag={dragSourceAsset} onPreview={(asset) => setPreviewImage({ id: asset.url, planPage: 0, url: asset.url, provider: asset.name })} onDelete={removeSourceAsset} />
                  </div>
                </CardBody>
              </Card>

              <div className="grid min-h-0 items-stretch gap-4 xl:grid-cols-[96px_minmax(0,1fr)]">
                <div className="z-10 flex min-h-0 flex-col justify-center gap-2 overflow-y-auto rounded-lg border border-line bg-white/95 p-2 shadow-sm backdrop-blur">
                  {imagePlanItems.map((item) => {
                    const hasSource = Boolean(planSourceMap[item.page]?.length);
                    const isActive = activeImagePage === item.page;
                    const statusClass = isActive
                      ? "border-orange-700 bg-orange-700 text-white shadow-sm"
                      : item.status === "done"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : item.status === "failed"
                          ? "border-orange-200 bg-orange-50 text-orange-700"
                          : item.status === "generating"
                            ? "border-orange-300 bg-orange-500 text-white"
                            : hasSource
                              ? "border-orange-200 bg-orange-50 text-orange-700"
                              : "border-line bg-white text-muted hover:bg-slate-50";
                    const dotClass = item.status === "done"
                      ? "bg-emerald-500"
                      : item.status === "failed"
                        ? "bg-orange-500"
                        : item.status === "generating"
                          ? "bg-orange-500"
                          : "border border-slate-300 bg-white";
                    return (
                      <button
                        key={item.page}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData("application/x-image-plan-page", String(item.page));
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingImagePage(item.page);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourcePage = Number(event.dataTransfer.getData("application/x-image-plan-page"));
                          if (sourcePage) reorderImagePlanPage(sourcePage, item.page);
                          setDraggingImagePage(null);
                        }}
                        onDragEnd={() => setDraggingImagePage(null)}
                        onClick={() => {
                          setActiveImagePage(item.page);
                          document.getElementById(`image-plan-${item.page}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                        className={cn("inline-flex h-9 cursor-grab items-center justify-center gap-2 rounded-full border px-3 text-xs font-medium transition active:cursor-grabbing", statusClass, draggingImagePage === item.page ? "opacity-60" : "")}
                        title="拖动可调整页面顺序"
                      >
                        <span className={cn("h-2 w-2 rounded-full", dotClass)} />
                        P{item.page}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => { event.stopPropagation(); deleteImagePlanPage(item.page); }}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); deleteImagePlanPage(item.page); } }}
                          className={cn("ml-1 grid h-4 w-4 place-items-center rounded-full text-[10px] transition", item.status === "generating" ? "text-white/80 hover:bg-white/20" : "text-current hover:bg-black/10")}
                          title={`删除 P${item.page}`}
                        >
                          ×
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="min-h-0 min-w-0 overflow-y-auto pr-1">
                <div className="space-y-5 pb-20">
                {[...imagePlanItems].sort((a, b) => a.page - b.page).map((item) => {
                  const selectedSources = planSourceMap[item.page] ?? [];
                  const planImages = generatedImages.filter((image) => image.planPage === item.page);
                  const pageGeneratingProvider = generatingImagePages[item.page];
                  const pageProvider = planProviderMap[item.page] ?? imageProvider;
                  return (
                    <div key={item.page} id={`image-plan-${item.page}`} className="scroll-mt-4">
                    <Card className={cn("overflow-hidden", planImages.length ? "ring-1 ring-emerald-200" : undefined)}>
                      <CardHeader title={`P${item.page} · ${item.type}`} subtitle={item.use} />
                      <CardBody className="space-y-4">
                        <div className="grid items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                          <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropSourceAssetToPlan(event, item.page)} className="min-h-[258px] rounded-lg border border-dashed border-orange-200 bg-orange-50/50 p-3">
                            <p className="mb-2 text-sm font-medium text-ink">拖入 / 添加的参考图片（可多张）</p>
                            {selectedSources.length ? (
                              <div className="grid grid-cols-2 gap-2">
                                {selectedSources.map((source) => (
                                  <div key={source.url} className="relative overflow-hidden rounded-md border border-white bg-white">
                                    <button onClick={() => setPreviewImage({ id: source.url, planPage: item.page, url: source.url, provider: source.name })} className="block w-full">
                                      <img src={source.url} alt={source.name} className="aspect-[3/4] w-full object-cover" />
                                    </button>
                                    <button onClick={() => removeSourceFromPlan(item.page, source.url)} className="absolute right-1 top-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-white">删除</button>
                                    <p className="truncate px-2 py-1 text-xs text-muted">{source.source} · {source.name}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex h-44 items-center justify-center rounded-md bg-white px-4 text-center text-sm text-muted">从左侧素材池拖入一张或多张参考图</div>
                            )}
                          </div>
                          <div className="space-y-3">
                            <label className="block text-sm font-medium text-ink">提示词<textarea value={planPromptMap[item.page] ?? ""} onChange={(event) => setPlanPromptMap((items) => ({ ...items, [item.page]: event.target.value }))} className="mt-2 min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></label>
                            <div className="grid gap-3 md:grid-cols-3">
                              <label className="block text-sm font-medium text-ink">生成张数<select value={planCountMap[item.page] ?? "1"} onChange={(event) => setPlanCountMap((items) => ({ ...items, [item.page]: event.target.value }))} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-muted outline-none">{Array.from({ length: 10 }, (_, countIndex) => <option key={countIndex + 1}>{countIndex + 1}</option>)}</select></label>
                              <label className="block text-sm font-medium text-ink">图片比例<select value={planSizeMap[item.page] ?? "3:4"} onChange={(event) => setPlanSizeMap((items) => ({ ...items, [item.page]: event.target.value }))} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-muted outline-none"><option>3:4</option><option>9:16</option><option>1:1</option><option>4:3</option><option>16:9</option></select></label>
                              <label className="block text-sm font-medium text-ink">模型<select value={pageProvider} onChange={(event) => setPlanProviderMap((items) => ({ ...items, [item.page]: event.target.value as ImageProvider }))} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-muted outline-none">{imageProviders.map((provider) => <option key={provider}>{provider}</option>)}</select></label>
                            </div>
                            <Button variant="primary" icon={<ImagePlus className="h-4 w-4" />} disabled={Boolean(pageGeneratingProvider)} onClick={() => void generateSinglePlanImage(item.page)}>
                              {pageGeneratingProvider ? "生成中..." : planImages.length ? "重新生成" : "生成图片"}
                            </Button>
                          </div>
                        </div>
                        <div>
                          <p className="mb-2 text-sm font-medium text-ink">生成结果</p>
                          {pageGeneratingProvider ? (
                            <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-emerald-200 bg-emerald-50/70 text-sm text-emerald-800">
                              <span className="font-medium">图片生成中...</span>
                              <span className="mt-1 text-xs">正在等待 {pageGeneratingProvider} 返回结果，通常需要 30-90 秒</span>
                            </div>
                          ) : planImages.length ? (
                            <div className="flex gap-3 overflow-x-auto pb-2">
                              {planImages.map((image) => (
                                <button key={image.id} onClick={() => setPreviewImage(image)} className="w-56 shrink-0 overflow-hidden rounded-lg border border-line bg-slate-50 text-left transition hover:border-orange-200 hover:shadow-sm">
                                  <img src={image.url} alt={`P${item.page} 生成结果`} className="h-72 w-full object-cover" />
                                  <p className="truncate px-2 py-1 text-xs text-muted">{image.provider}</p>
                                </button>
                              ))}
                            </div>
                          ) : <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-muted">生成后图片会显示在这里，可横向滑动选择</div>}
                        </div>
                      </CardBody>
                    </Card>
                    </div>
                  );
                })}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button onClick={addImagePlanPage}>新增页面</Button>
                  <Button variant="primary" onClick={() => {
                    setLocalSaveSelectedUrls([]);
                    setLocalSaveDirectory(null);
                    setSavePath("尚未选择文件夹");
                    setSaveDialogOpen(true);
                  }}>保存本地</Button>
                  <Button variant="success" onClick={openFinishedPreview}>预览并打包成品内容</Button>
                </div>
                </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="space-y-5">
          <StepNav steps={videoSteps} value={videoStep} onChange={setVideoStep} />

          {videoStep === "发布文案生成" ? (
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
                <Card>
                  <CardHeader title="发布文案生成" subtitle="本地上传视频和公开链接解析视频都作为拆解来源，二选一即可。" />
                  <CardBody className="space-y-4">
                    <input id="reference-video-upload" type="file" accept="video/*" className="hidden" onChange={(event) => uploadReferenceVideo(event.target.files)} />
                    <label htmlFor="reference-video-upload" className="flex h-52 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-orange-200 bg-orange-50 text-center transition hover:bg-orange-100/70">
                      {localReferenceVideo ? (
                        <video src={localReferenceVideo.url} className="h-full w-full rounded-lg object-cover" controls />
                      ) : (
                        <>
                          <UploadCloud className="h-10 w-10 text-orange-600" />
                          <p className="mt-3 text-sm font-medium text-ink">上传对标视频</p>
                          <p className="mt-1 text-xs text-muted">点击后直接从本地文件夹选择视频</p>
                        </>
                      )}
                    </label>
                    {localReferenceVideo ? <p className="truncate text-xs text-muted">已选择：{localReferenceVideo.name}</p> : null}
                    <label className="block text-sm font-medium text-ink">
                      粘贴视频参考链接
                      <input value={videoReferenceUrl} onChange={(event) => setVideoReferenceUrl(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" placeholder="粘贴小红书参考链接" />
                    </label>
                    <Button className="w-full" disabled={videoReferenceParsing} onClick={() => void parseVideoReferenceLink()}>{videoReferenceParsing ? "OpenCLI采集中..." : "解析视频链接"}</Button>
                    {videoReferenceParsing ? <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-4 text-sm text-orange-700">正在打开复制链接并调用 OpenCLI 采集标题、口播、图片和视频，请稍等...</div> : null}
                    {parsedVideoReference ? (
                      <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-ink">{parsedVideoReference.title}</p>
                            <p className="mt-1 text-xs text-muted">{platformShortName(parsedVideoReference.platform)} · {parsedVideoReference.author}</p>
                          </div>
                          <StatusBadge status="approved" label="已解析" />
                        </div>
                        <div className="mt-3 max-h-36 overflow-y-auto rounded-md bg-white/80 px-3 py-2 text-sm leading-6 text-ink">{parsedVideoReference.copy}</div>
                        {parsedVideoReference.media.length ? (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {parsedVideoReference.media.slice(0, 6).map((media, index) => (
                            <div key={`${media.name}-${index}`} className="overflow-hidden rounded-md border border-white bg-white">
                              {media.type === "video" ? <video src={media.url} className="h-32 w-full object-cover" controls playsInline /> : <img src={media.url} alt={media.name} className="h-32 w-full object-cover" />}
                              <p className="truncate px-2 py-1 text-[11px] text-muted">对标素材{index + 1}</p>
                            </div>
                          ))}
                        </div>
                        ) : <p className="mt-3 rounded-md bg-white/80 px-3 py-2 text-xs text-muted">OpenCLI 暂未返回可展示的图片或视频素材，标题和文案已采集。</p>}
                      </div>
                    ) : null}
                    <Button className="w-full" variant="primary" disabled={videoImitationLoading || (!localReferenceVideo && !parsedVideoReference)} onClick={() => void generateVideoImitationCandidates()}>
                      {videoImitationLoading ? "拆解视频中..." : "拆解视频"}
                    </Button>
                  </CardBody>
                </Card>
                <div className="grid gap-5 xl:grid-cols-3">
                  <Card className="xl:col-span-1">
                    <CardHeader title="标题候选（10条）" subtitle="拆解视频后由 DeepSeek 生成。" />
                    <CardBody className="max-h-[560px] space-y-2 overflow-y-auto">
                      {videoTitleOptions.map((item, index) => (
                        <button key={`${item.title}-${index}`} onClick={() => setSelectedVideoTitle(item.title)} className={cn("w-full rounded-lg border p-3 text-left text-sm", selectedVideoTitle === item.title ? "border-orange-300 bg-orange-50 text-orange-800" : "border-line hover:bg-slate-50")}>
                          <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700">{index + 1}</span>
                          {item.title}
                          <div className="mt-2 text-xs text-muted">评分 {item.score} · {item.tag}</div>
                        </button>
                      ))}
                    </CardBody>
                  </Card>
                  <Card className="xl:col-span-1">
                    <CardHeader title="文案候选（与标题联动）" subtitle="选择后同步到右侧口播文案。" />
                    <CardBody className="max-h-[560px] space-y-3 overflow-y-auto">
                      {videoCopyOptions.map((item) => (
                        <button key={item.id} onClick={() => selectVideoCopy(item.id)} className={cn("w-full rounded-lg border p-4 text-left transition", selectedVideoCopyId === item.id ? "border-orange-300 bg-orange-50" : "border-line bg-white hover:bg-slate-50")}>
                          <div className="flex items-center justify-between"><span className="font-semibold text-orange-700">{item.id}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-muted">{item.style}</span></div>
                          <p className="mt-2 text-sm leading-6 text-ink">{item.summary}</p>
                        </button>
                      ))}
                    </CardBody>
                  </Card>
                  <Card className="xl:col-span-1">
                    <CardHeader title="选中标题与完整文案（可编辑）" subtitle="确认后进入视频脚本生成。" />
                    <CardBody className="space-y-4">
                      <label className="block"><FieldLabel count={`${selectedVideoTitle.length}/30`}>选中标题</FieldLabel><input value={selectedVideoTitle} onChange={(event) => setSelectedVideoTitle(event.target.value)} className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" /></label>
                      <label className="block"><FieldLabel count={`${draftVoiceover.length}/2000`}>完整文案 / 口播方向</FieldLabel><textarea value={draftVoiceover} onChange={(event) => setDraftVoiceover(event.target.value)} className="min-h-48 w-full rounded-md border border-line px-3 py-2 text-sm leading-7 outline-none focus:border-orange-300" /></label>
                      <Button className="w-full" variant="primary" onClick={() => { setVideoStep("视频脚本生成"); setFeedback("已保存视频发布文案，并进入视频脚本生成。"); }}>保存并进入下一步</Button>
                    </CardBody>
                  </Card>
                </div>
              </div>
            </div>
          ) : null}

          {videoStep === "视频脚本生成" ? (
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
                <Card>
                  <CardHeader title="GPT 视频脚本生成" subtitle="先拆解原脚本，再基于提示词和参考图生成新脚本。" />
                  <CardBody className="space-y-4">
                    <label className="block"><FieldLabel>已选标题</FieldLabel><input value={selectedVideoTitle} onChange={(event) => setSelectedVideoTitle(event.target.value)} className="h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" /></label>
                    <label className="block"><FieldLabel>口播文案</FieldLabel><textarea value={draftVoiceover} onChange={(event) => setDraftVoiceover(event.target.value)} className="min-h-32 w-full rounded-md border border-line px-3 py-2 text-sm leading-7 outline-none focus:border-orange-300" /></label>
                    <label className="block"><FieldLabel>脚本生成提示词</FieldLabel><textarea value={scriptPrompt} onChange={(event) => setScriptPrompt(event.target.value)} className="min-h-32 w-full rounded-md border border-line px-3 py-2 text-sm leading-7 outline-none focus:border-orange-300" /></label>
                    <div className="flex flex-wrap gap-2">
                      <input id="video-script-prompt-file" type="file" accept=".txt,.md" className="hidden" onChange={(event) => void uploadScriptPromptFile(event.target.files)} />
                      <label htmlFor="video-script-prompt-file" className={actionLinkClass}>上传提示词</label>
                      <input id="video-script-reference-images" type="file" accept="image/*" multiple className="hidden" onChange={(event) => uploadScriptReferenceImages(event.target.files)} />
                      <label htmlFor="video-script-reference-images" className={actionLinkClass}>上传多图参考</label>
                    </div>
                    {scriptReferenceImages.length ? (
                      <div className="grid grid-cols-3 gap-2">
                        {scriptReferenceImages.map((asset) => <img key={asset.url} src={asset.url} alt={asset.name} className="aspect-[3/4] rounded-md object-cover" />)}
                      </div>
                    ) : null}
                    <div className="grid gap-2 md:grid-cols-2">
                      <Button variant="primary" onClick={() => void decomposeVideoScript()}>GPT 拆解原脚本</Button>
                      <Button variant="success" onClick={() => void rewriteVideoScript()}>GPT 生成新脚本</Button>
                    </div>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="原脚本 / 新脚本预览" subtitle={`已选择 ${selectedShotCount} / ${scriptRows.length} 个镜头`} action={<div className="flex gap-2"><Button onClick={() => { setScriptRows((rows) => rows.map((row) => ({ ...row, selected: true }))); setShotPlans((shots) => shots.map((shot) => ({ ...shot, selected: true }))); }}>全选</Button><Button onClick={() => { setScriptRows((rows) => rows.map((row) => ({ ...row, selected: false }))); setShotPlans((shots) => shots.map((shot) => ({ ...shot, selected: false }))); }}>取消全选</Button></div>} />
                  <CardBody className="p-0">
                    <DataTable headers={["是否生成", "时间", "画面描述", "人物动作", "音效", "口播"]} className="rounded-none border-0 shadow-none">{scriptRows.map((row) => <tr key={row.id}><td className="px-4 py-3"><input type="checkbox" checked={row.selected} onChange={(event) => toggleScriptRow(row.id, event.target.checked)} className="h-4 w-4 accent-orange-500" /></td><td className="px-4 py-3 text-muted">{row.time}</td><td className="px-4 py-3 text-ink">{row.scene}</td><td className="px-4 py-3 text-muted">{row.action}</td><td className="px-4 py-3 text-muted">{row.audio}</td><td className="min-w-72 px-4 py-3 text-muted">{row.voiceover}</td></tr>)}</DataTable>
                    <div className="flex flex-wrap gap-3 border-t border-line p-4"><Button variant="primary" onClick={() => { setVideoStep("视频素材生成"); setFeedback("已保存视频脚本，并进入视频素材生成。"); }}>保存并进入下一步</Button><Button onClick={() => void rewriteVideoScript()}>重新生成脚本</Button></div>
                  </CardBody>
                </Card>
              </div>
            </div>
          ) : null}

          {videoStep === "视频素材生成" ? (
            <div className="grid gap-5 xl:grid-cols-[0.36fr_1fr]">
              <Card>
                <CardHeader title="视频素材生成设置" subtitle="通过本地 API 调用 Seedance 2.0 adapter；无 Key 时走 mock。" />
                <CardBody className="space-y-4">
                  <input id="video-script-upload" type="file" accept=".txt,.md" className="hidden" onChange={(event) => void uploadVideoScriptFile(event.target.files)} />
                  <label htmlFor="video-script-upload" className={actionLinkClass}>上传脚本</label>
                  <label className="block text-sm font-medium text-ink">生成脚本<textarea value={draftVoiceover} onChange={(event) => setDraftVoiceover(event.target.value)} className="mt-2 min-h-40 w-full rounded-md border border-line px-3 py-2 text-sm leading-7 outline-none focus:border-orange-300" /></label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block text-sm font-medium text-ink">视频比例<select value={videoRatio} onChange={(event) => setVideoRatio(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-muted outline-none"><option>9:16</option><option>3:4</option><option>1:1</option><option>16:9</option></select></label>
                    <label className="block text-sm font-medium text-ink">生成数量<select value={videoGenerateCount} onChange={(event) => setVideoGenerateCount(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-muted outline-none"><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
                  </div>
                  <label className="block text-sm font-medium text-ink">视频生成接口<select value={videoProvider} onChange={(event) => setVideoProvider(event.target.value as VideoProvider)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-muted outline-none">{videoProviders.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <input id="video-generate-reference-images" type="file" accept="image/*" multiple className="hidden" onChange={(event) => uploadScriptReferenceImages(event.target.files)} />
                  <label htmlFor="video-generate-reference-images" className={actionLinkClass}>上传参考图</label>
                  {scriptReferenceImages.length ? (
                    <div className="grid grid-cols-3 gap-2">
                      {scriptReferenceImages.map((asset) => <img key={asset.url} src={asset.url} alt={asset.name} className="aspect-[3/4] rounded-md object-cover" />)}
                    </div>
                  ) : null}
                  <Button className="w-full" variant="primary" onClick={() => void generateSingleVideoShot(activeVideoPage)}>视频生成</Button>
                  <Button className="w-full">保存本地</Button>
                  <Button className="w-full" variant="success" onClick={() => setVideoFinishedPreviewOpen(true)}>预览并打包成品内容</Button>
                </CardBody>
              </Card>
              <div>
                <div className="sticky top-3 z-10 mb-3 flex flex-wrap gap-2 rounded-lg border border-line bg-white/95 p-2 shadow-sm backdrop-blur">
                  {shotPlans.map((shot) => {
                    const hasGenerated = generatedVideos.some((item) => item.shotNo === shot.no);
                    return (
                      <button key={shot.no} onClick={() => setActiveVideoPage(shot.no)} className={cn("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition", activeVideoPage === shot.no ? "border-orange-300 bg-orange-500 text-white" : hasGenerated ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-white text-muted hover:bg-slate-50")}>
                        <span className={cn("h-2 w-2 rounded-full", activeVideoPage === shot.no ? "bg-white" : hasGenerated ? "bg-emerald-500" : "bg-slate-300")} />
                        P{shot.no}
                      </button>
                    );
                  })}
                </div>
                {shotPlans.filter((shot) => shot.no === activeVideoPage).map((shot) => {
                  const shotVideos = generatedVideos.filter((item) => item.shotNo === shot.no);
                  return (
                    <Card key={shot.id}>
                      <CardHeader title={`P${shot.no} · ${shot.title}`} subtitle={shot.scene} />
                      <CardBody className="space-y-4">
                        <div className="grid gap-4 lg:grid-cols-[0.55fr_0.45fr]">
                          <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={shot.selected} onChange={(event) => setShotPlans((shots) => shots.map((item) => item.id === shot.id ? { ...item, selected: event.target.checked } : item))} className="h-4 w-4 accent-orange-500" />纳入本次生成</label>
                            <label className="block text-sm font-medium text-ink">视频提示词<textarea defaultValue={shot.prompt} className="mt-2 min-h-32 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></label>
                            <label className="block text-sm font-medium text-ink">反向提示词<textarea defaultValue={shot.negativePrompt} className="mt-2 min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></label>
                            <div className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-muted"><span className="font-medium text-ink">口播重点：</span>{shot.voiceFocus}<br /><span className="font-medium text-ink">预计时长：</span>{shot.duration}</div>
                          </div>
                          <div>
                            <p className="mb-2 text-sm font-medium text-ink">生成结果</p>
                            {shotVideos.length ? (
                              <div className="flex gap-3 overflow-x-auto pb-2">
                                {shotVideos.map((video) => (
                                  <button key={video.id} onClick={() => setPreviewVideo(video)} className="w-48 shrink-0 overflow-hidden rounded-lg border border-line bg-slate-50 text-left transition hover:border-orange-200 hover:shadow-sm">
                                    {video.url ? <video src={video.url} className="h-64 w-full object-cover" muted playsInline /> : <img src={mockSvg(`视频 P${shot.no}`, "#eef2ff")} alt={`P${shot.no} 视频生成结果`} className="h-64 w-full object-cover" />}
                                    <p className="truncate px-2 py-1 text-xs text-muted">{video.provider}</p>
                                  </button>
                                ))}
                              </div>
                            ) : <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-muted">点击左侧“视频生成”后，结果会显示在这里</div>}
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : null}

          {false ? (
            <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
              <Card>
                <CardHeader title="剪辑素材来源" subtitle="从素材库选择或上传本地视频，仅生成本地剪辑方案，不自动发布。" />
                <CardBody className="space-y-4">
                  {["从素材库选择", "上传本地视频"].map((item, index) => (
                    <label key={item} className="flex items-center gap-3 rounded-lg border border-line p-3 text-sm text-ink">
                      <input type="checkbox" defaultChecked={index === 0} className="h-4 w-4 accent-orange-500" />
                      {item}
                    </label>
                  ))}
                  <div className="grid gap-2 md:grid-cols-2">
                    <Button>打开素材库选择</Button>
                    <Button>选择本地视频</Button>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="剪辑方式与参数" subtitle="生成本地剪辑方案，不自动控制剪辑软件。" />
                <CardBody className="space-y-4">
                  <div className="grid gap-2">
                    {["混剪", "固定模板剪辑", "口播剪辑", "产品展示剪辑"].map((item, index) => (
                      <label key={item} className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-ink">
                        <input type="radio" name="editMode" defaultChecked={index === 0} className="h-4 w-4 accent-orange-500" />
                        {item}
                      </label>
                    ))}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-xs font-medium text-muted">成片比例<select className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink"><option>9:16</option><option>3:4</option><option>1:1</option></select></label>
                    <label className="text-xs font-medium text-muted">成片时长<select className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink"><option>30s</option><option>15s</option><option>45s</option><option>60s</option></select></label>
                    <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" defaultChecked className="h-4 w-4 accent-orange-500" />自动加字幕</label>
                    <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-orange-500" />自动配音</label>
                    <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" defaultChecked className="h-4 w-4 accent-orange-500" />保留原声</label>
                    <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" defaultChecked className="h-4 w-4 accent-orange-500" />加背景音乐</label>
                    <label className="text-xs font-medium text-muted">转场风格<select className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink"><option>自然切换</option><option>轻快闪切</option><option>柔和淡入</option></select></label>
                    <label className="text-xs font-medium text-muted">字幕样式<select className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink"><option>白底黑字</option><option>橙色重点词</option><option>口播字幕</option></select></label>
                    <label className="text-xs font-medium text-muted md:col-span-2">封面生成方式<select className="mt-1 h-9 w-full rounded-md border border-line px-3 text-sm text-ink"><option>使用第一镜头生成封面</option><option>上传封面</option><option>根据标题生成封面提示词</option></select></label>
                  </div>
                  <label className="block text-sm font-medium text-ink">剪辑提示词<textarea defaultValue="节奏轻快，保留真实口播感，先痛点后流程，结尾做收藏引导。" className="mt-2 min-h-28 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></label>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Button variant="primary">自动生成剪辑</Button>
                    <Button>保存本地</Button>
                    <Button>导出内容包</Button>
                    <Button variant="success">提交审核</Button>
                  </div>
                </CardBody>
              </Card>
            </div>
          ) : null}
        </section>
      )}

      {previewImage ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4" onClick={() => setPreviewImage(null)}>
          <div className="max-h-[92vh] max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">{generatedImagePageLabel(previewImage)} 图片预览</p>
                <p className="text-xs text-muted">{previewImage.provider}</p>
              </div>
              <button onClick={() => setPreviewImage(null)} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-slate-100">关闭</button>
            </div>
            <div className="max-h-[82vh] overflow-auto bg-slate-50 p-4">
              <img src={previewImage.url} alt={`${generatedImagePageLabel(previewImage)} 图片预览`} className="mx-auto max-h-[76vh] max-w-full rounded-md object-contain" />
            </div>
          </div>
        </div>
      ) : null}

      {previewVideo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={() => setPreviewVideo(null)}>
          <div className="max-h-[92vh] max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">P{previewVideo.shotNo} 视频生成结果</p>
                <p className="text-xs text-muted">{previewVideo.provider}</p>
              </div>
              <button onClick={() => setPreviewVideo(null)} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-slate-100">关闭</button>
            </div>
            <div className="max-h-[82vh] overflow-auto bg-slate-50 p-4">
              {previewVideo.url ? <video src={previewVideo.url} controls className="mx-auto max-h-[76vh] max-w-full rounded-md object-contain" /> : <img src={mockSvg(`视频 P${previewVideo.shotNo}`, "#eef2ff")} alt={`P${previewVideo.shotNo} 视频生成结果`} className="mx-auto max-h-[76vh] max-w-full rounded-md object-contain" />}
            </div>
          </div>
        </div>
      ) : null}

      {materialPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">从素材库选择图片</h2>
                <p className="mt-1 text-sm text-muted">只会把勾选的素材加入左侧“素材库素材”。</p>
              </div>
              <button onClick={() => setMaterialPickerOpen(false)} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-slate-100">关闭</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {materialPickerAssets.length ? (
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {materialPickerAssets.map((asset) => {
                    const checked = selectedMaterialUrls.includes(asset.url);
                    return (
                      <button
                        key={asset.url}
                        onClick={() => toggleMaterialPickerAsset(asset)}
                        className={cn("relative overflow-hidden rounded-lg border bg-white text-left transition", checked ? "border-orange-400 ring-2 ring-orange-100" : "border-line hover:border-orange-200")}
                      >
                        <img src={asset.url} alt={asset.name} className="aspect-[3/4] w-full object-cover" />
                        <span className={cn("absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-xs font-bold", checked ? "bg-orange-500 text-white" : "bg-white/90 text-muted")}>{checked ? "✓" : ""}</span>
                        <p className="truncate px-2 py-2 text-xs text-muted">{asset.name}</p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-muted">素材库暂无可选择图片。</div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-4">
              <p className="text-sm text-muted">已选择 {selectedMaterialUrls.length} 张</p>
              <div className="flex gap-2">
                <Button onClick={() => setMaterialPickerOpen(false)}>取消</Button>
                <Button variant="primary" onClick={() => void confirmMaterialPicker()}>确认选择</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {finishedPreviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">成品内容入库前预览</h2>
                <p className="mt-1 text-sm text-muted">确认文案，并只在需要调整的作品里展开图片池选择图片。</p>
              </div>
              <button onClick={() => setFinishedPreviewOpen(false)} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-slate-100">关闭</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                {selectedBatchDrafts.map((work, workIndex) => {
                  const selectedUrls = finishedImageAssignments[workIndex] ?? [];
                  const workImages = selectedUrls.flatMap((imageUrl) => {
                    const image = generatedImages.find((item) => generatedImageKey(item) === imageUrl);
                    return image ? [image] : [];
                  });
                  const pageOptions = ["全部", ...Array.from(new Set(generatedImages.filter((image) => image.planPage > 0).map((image) => `P${image.planPage}`)))];
                  const visibleImages = [...generatedImages]
                    .sort((a, b) => a.planPage - b.planPage || a.id.localeCompare(b.id))
                    .filter((image) => previewImagePageFilter === "全部" || generatedImagePageLabel(image) === previewImagePageFilter);
                  const expanded = expandedPreviewWork === workIndex;
                  return (
                    <div key={work.id} className="overflow-hidden rounded-lg border border-line bg-white">
                      <div className="border-b border-line bg-slate-50 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-muted">作品 {workIndex + 1}</p>
                            <h3 className="mt-1 line-clamp-2 text-base font-semibold text-ink">{work.title}</h3>
                          </div>
                          <Button className="h-8 px-3 text-xs" onClick={() => setExpandedPreviewWork(expanded ? -1 : workIndex)}>{expanded ? "收起" : "选图"}</Button>
                        </div>
                      </div>
                      <div className="space-y-3 p-4">
                        <div className="max-h-40 overflow-y-auto rounded-lg border border-line bg-white p-3 text-sm leading-7 text-ink whitespace-pre-wrap">{work.copy}</div>
                        <div className="flex flex-wrap gap-2">
                          {work.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-700">{tag}</span>
                          ))}
                        </div>
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-xs font-medium text-muted">已选 {workImages.length} 张图片</p>
                            {!generatedImages.length ? <span className="text-xs text-orange-600">请先返回生成图片</span> : null}
                          </div>
                           {workImages.length ? (
                             <div className="flex gap-2 overflow-x-auto pb-1">
                              {workImages.map((image) => {
                                const imageKey = generatedImageKey(image);
                                return (
                                  <div
                                    key={`selected-${work.id}-${image.id}`}
                                    draggable
                                    onDragStart={() => setDraggingFinishedImageUrl(imageKey)}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                      event.preventDefault();
                                      if (draggingFinishedImageUrl) reorderFinishedImageAssignment(workIndex, draggingFinishedImageUrl, imageKey);
                                      setDraggingFinishedImageUrl(null);
                                    }}
                                    onDragEnd={() => setDraggingFinishedImageUrl(null)}
                                    className={cn("w-20 shrink-0 cursor-grab overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 text-left active:cursor-grabbing", draggingFinishedImageUrl === imageKey ? "opacity-60" : "")}
                                  >
                                    <button type="button" onClick={() => setPreviewImage(image)} className="block w-full text-left">
                                      <img src={image.url} alt={`已选 ${generatedImagePageLabel(image)}`} className="aspect-[3/4] w-full object-cover" />
                                      <p className="truncate px-1 py-0.5 text-[10px] text-emerald-700">{generatedImagePageLabel(image)}</p>
                                    </button>
                                  </div>
                                );
                              })}
                             </div>
                          ) : (
                            <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-xs text-muted">暂未选择图片</div>
                          )}
                          {expanded ? (
                            <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3">
                              <div className="mb-3 flex flex-wrap items-center gap-2">
                                {pageOptions.map((page) => <button key={`${work.id}-${page}`} onClick={() => setPreviewImagePageFilter(page)} className={cn("h-7 rounded-full border px-3 text-xs transition", previewImagePageFilter === page ? "border-orange-300 bg-orange-500 text-white" : "border-line bg-white text-muted hover:bg-orange-50")}>{page}</button>)}
                                <input id={`finished-image-upload-${workIndex}`} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void uploadFinishedImages(workIndex, event.target.files)} />
                                <Button className="h-7 px-3 text-xs" onClick={() => document.getElementById(`finished-image-upload-${workIndex}`)?.click()}>上传图片</Button>
                              </div>
                              <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1">
                              {visibleImages.map((image) => {
                                const imageKey = generatedImageKey(image);
                                const checked = selectedUrls.includes(imageKey);
                                return (
                                  <div key={`${work.id}-${image.id}`} className={cn("overflow-hidden rounded-lg border bg-slate-50 text-left transition", checked ? "border-emerald-300 ring-2 ring-emerald-100" : "border-line")}>
                                    <button onClick={() => setPreviewImage(image)} className="block w-full">
                                      <img src={image.url} alt={`P${image.planPage} 生成结果`} className="aspect-[3/4] w-full object-cover" />
                                    </button>
                                    <button onClick={() => toggleFinishedImageAssignment(workIndex, imageKey)} className={cn("flex w-full items-center justify-between px-2 py-1 text-xs", checked ? "bg-emerald-50 text-emerald-700" : "bg-white text-muted hover:bg-orange-50 hover:text-orange-700")}>
                                      <span className="truncate">{generatedImagePageLabel(image)} · {image.provider}</span>
                                      <span className={cn("ml-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px]", checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300")}>{checked ? "✓" : ""}</span>
                                    </button>
                                  </div>
                                );
                              })}
                              {!visibleImages.length ? <div className="col-span-4 py-8 text-center text-xs text-muted">暂无图片，可点击上方“上传图片”从本地添加。</div> : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <Button disabled={finishedSaving} onClick={() => setFinishedPreviewOpen(false)}>取消</Button>
              <Button variant="success" disabled={finishedSaving} onClick={confirmSaveFinishedImage}>{finishedSaving ? "保存中..." : "确认保存"}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {videoFinishedPreviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">视频成品入库前预览</h2>
                <p className="mt-1 text-sm text-muted">确认标题、口播文案、脚本镜头和生成视频无误后再打包进成品内容库。</p>
              </div>
              <button onClick={() => setVideoFinishedPreviewOpen(false)} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-slate-100">关闭</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted">标题</p>
                    <h3 className="mt-2 text-lg font-semibold text-ink">{selectedVideoTitle}</h3>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted">口播文案</p>
                    <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-line bg-slate-50 p-3 text-sm leading-7 text-ink whitespace-pre-wrap">{draftVoiceover}</div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted">已选镜头</p>
                    <div className="mt-2 space-y-2">
                      {shotPlans.filter((shot) => shot.selected).map((shot) => (
                        <div key={shot.id} className="rounded-lg border border-line bg-white p-3 text-sm">
                          <p className="font-medium text-ink">P{shot.no} · {shot.title}</p>
                          <p className="mt-1 line-clamp-2 text-muted">{shot.scene}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted">生成视频</p>
                  {generatedVideos.length ? (
                    <div className="mt-2 grid max-h-[560px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                      {generatedVideos.map((video) => (
                        <button key={video.id} onClick={() => setPreviewVideo(video)} className="overflow-hidden rounded-lg border border-line bg-slate-50 text-left">
                          <video src={video.url} className="aspect-[9/16] w-full object-cover" muted playsInline />
                          <p className="px-2 py-1 text-xs text-muted">P{video.shotNo} · {video.provider}</p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 flex h-48 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-muted">还没有生成视频，仍可保存脚本文案版本。</div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <Button onClick={() => setVideoFinishedPreviewOpen(false)}>取消</Button>
              <Button variant="success" onClick={saveVideoToContentLibrary}>确认保存</Button>
            </div>
          </div>
        </div>
      ) : null}

      {saveDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-soft">
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold text-ink">选择图片并保存到本地</h2>
              <p className="mt-1 text-sm text-muted">只会保存你勾选的图片，然后写入你选择的文件夹。</p>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {generatedImages.length ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {generatedImages.map((image) => {
                    const imageKey = generatedImageKey(image);
                    const checked = localSaveSelectedUrls.includes(imageKey);
                    return (
                      <button key={`local-save-${image.id}`} type="button" onClick={() => toggleLocalSaveSelection(imageKey)} className={cn("relative overflow-hidden rounded-lg border bg-slate-50 text-left transition", checked ? "border-emerald-400 ring-2 ring-emerald-100" : "border-line hover:border-orange-200")}>
                        <img src={image.url} alt={`${generatedImagePageLabel(image)} 保存预览`} className="aspect-[3/4] w-full object-cover" />
                        <span className={cn("absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-xs font-bold", checked ? "bg-emerald-500 text-white" : "bg-white/90 text-muted")}>{checked ? "✓" : ""}</span>
                        <p className="truncate px-2 py-1 text-xs text-muted">{generatedImagePageLabel(image)} · {image.provider}</p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50 text-sm text-muted">还没有可保存的生成图片。</div>
              )}
              <div className="rounded-lg border border-line bg-slate-50 p-4">
                <p className="text-xs font-medium text-muted">已选 {localSaveSelectedUrls.length} 张 · 当前保存位置</p>
                <p className="mt-2 break-all text-sm font-medium text-ink">{savePath}</p>
                <Button className="mt-3" icon={<FolderOpen className="h-4 w-4" />} onClick={() => void chooseLocalSaveFolder()}>{directoryPickerSupported ? "选择文件夹" : "使用浏览器下载"}</Button>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <Button disabled={localSaveSaving} onClick={() => setSaveDialogOpen(false)}>取消</Button>
              <Button variant="primary" disabled={localSaveSaving || !localSaveSelectedUrls.length || (directoryPickerSupported && !localSaveDirectory)} onClick={() => void saveImageProjectLocally()}>{localSaveSaving ? "保存中..." : "确认保存"}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-soft">
            <div className="border-b border-line px-5 py-4"><h2 className="text-base font-semibold text-ink">上传标题文本</h2><p className="mt-1 text-sm text-muted">请按格式粘贴：第一行：标题；第二行开始：正文。</p></div>
            <div className="space-y-4 p-5">
              <textarea value={uploadText} onChange={(event) => setUploadText(event.target.value)} className="min-h-56 w-full rounded-md border border-line px-3 py-2 text-sm leading-7 outline-none focus:border-orange-300" />
              <div className="grid gap-3 md:grid-cols-2"><Button>上传 txt 文件</Button><Button>上传 docx 文件</Button></div>
              <div className="flex justify-end gap-2"><Button onClick={() => setUploadOpen(false)}>取消</Button><Button variant="primary" onClick={() => void importReferenceText()}>确认导入</Button></div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
