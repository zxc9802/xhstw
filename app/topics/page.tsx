"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { topics as initialTopics } from "@/lib/mock/data";
import { createXhsExtensionClient, type XhsCollectTask, type XhsExtensionClient } from "@/lib/xhs-extension-client";
import { mergeExtensionTopics, resolveTopicMedia, stripTopicLocalMedia, topicMediaAssetKeys } from "@/lib/xhs-extension-topics";
import { createXhsTopicMediaStore, type XhsTopicMediaStore } from "@/lib/xhs-topic-media-store";
import type { Topic } from "@/types/topic";

const topicTabs = ["小红书"] as const;
const actionLinkClass = "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink transition hover:border-orange-200 hover:bg-orange-50";
const defaultKeywords = ["防晒", "防晒喷雾", "油皮防晒", "敏感肌防晒", "通勤护肤", "军训防晒", "美白防晒", "夏季护肤"];
const TOPIC_STORAGE_KEY = "content-production-studio-xhs.topic-rows";
const REJECTED_TOPIC_STORAGE_KEY = "content-production-studio-xhs.rejected-topics";
const DELETED_TOPIC_STORAGE_KEY = "content-production-studio-xhs.deleted-topics";
const KEYWORDS_STORAGE_KEY = "content-production-studio-xhs.topic-keywords";
type CollectDateRange = "全部" | "一天内" | "一周内" | "半年内";
type ExtensionStatus = "checking" | "ready" | "missing" | "outdated";

const extensionStatusText: Record<ExtensionStatus, string> = {
  checking: "正在检测本机抓取扩展",
  ready: "本机抓取已连接",
  missing: "未安装本机抓取扩展",
  outdated: "抓取扩展版本过低"
};

type TopicMediaPreview = {
  title: string;
  url: string;
  type: "image" | "video";
  name?: string;
  posterUrl?: string;
};

function noteIdFromUrl(url?: string) {
  if (!url) return "";
  return url.match(/(?:explore|discovery\/item|search_result)\/([0-9a-fA-F]+)/)?.[1]
    || url.match(/\/([0-9a-fA-F]{16,32})(?:[?#]|$)/)?.[1]
    || "";
}

function topicUrl(item: Topic) {
  if (!item.url) return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(item.title)}`;
  const noteId = noteIdFromUrl(item.url);
  if (!noteId || item.platform !== "小红书") return item.url;
  try {
    const parsed = new URL(item.url);
    const next = new URL(`https://www.xiaohongshu.com/explore/${noteId}`);
    for (const key of ["xsec_token", "xsec_source"]) {
      const value = parsed.searchParams.get(key);
      if (value) next.searchParams.set(key, value);
    }
    if (!next.searchParams.get("xsec_source")) next.searchParams.set("xsec_source", "pc_search");
    return next.toString();
  } catch {
    return `https://www.xiaohongshu.com/explore/${noteId}`;
  }
}

function displayMediaUrl(url?: string) {
  return url || "";
}

function isXhsHttpsUrl(value: string): value is string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"));
  } catch {
    return false;
  }
}

function topicCoverUrl(item: Topic) {
  if (!item.coverUrl) return "";
  if (item.coverUrl.includes("_cover.png")) return "";
  if (item.platform !== "小红书") return item.coverUrl;
  if (!item.coverUrl.includes("/api/reference/media")) return item.coverUrl;
  const noteId = noteIdFromUrl(item.url);
  if (!noteId) return item.coverUrl;
  const decodedCover = decodeURIComponent(item.coverUrl).replace(/\\/g, "/");
  return decodedCover.includes(`xiaohongshu-downloads/${noteId}/`) ? item.coverUrl : "";
}

function coverKindFromUrl(url: string): "image" | "video" | undefined {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }
  if (/\.(?:mp4|mov|webm|m4v)(?:[&#?]|$)/i.test(decoded)) return "video";
  if (/\.(?:jpg|jpeg|png|webp|gif)(?:[&#?]|$)/i.test(decoded)) return "image";
  return undefined;
}

function topicCoverKind(item: Topic) {
  const coverUrl = topicCoverUrl(item);
  return item.coverType ?? coverKindFromUrl(coverUrl) ?? "image";
}

function topicMediaKind(item: Topic): "图文" | "视频" {
  if (item.mediaType) return item.mediaType;
  if (item.coverType === "video" || topicCoverKind(item) === "video") return "视频";
  return item.contentType.includes("视频") ? "视频" : "图文";
}

function buildGenerationHref(item: Topic) {
  const params = new URLSearchParams();
  params.set("tab", "image");
  params.set("prefill", "1");
  params.set("referenceUrl", topicUrl(item));
  params.set("title", item.title);
  params.set("platform", item.platform);
  params.set("sourceAccount", item.sourceAccount);
  params.set("contentType", item.contentType);
  params.set("likes", item.likes);
  params.set("fetchedAt", item.fetchedAt);
  params.set("keyword", item.keyword ?? "");
  params.set("copy", topicCopy(item));
  const media = topicMediaItems(item).slice(0, 6);
  if (media.length) {
    params.set("coverUrl", media[0].url);
    params.set("media", JSON.stringify(media));
  }
  return `/content?${params.toString()}`;
}

function topicMediaItems(item: Topic) {
  const media = item.media?.filter((mediaItem) => mediaItem.url) ?? [];
  if (media.length) return media;
  const coverUrl = topicCoverUrl(item);
  return coverUrl ? [{ type: topicCoverKind(item), url: coverUrl, name: "封面" }] : [];
}

function topicCopy(item: Topic) {
  const text = item.parsedContent?.trim();
  if (text && !text.startsWith("OpenCLI 搜索关键词")) return text;
  return `关键词：${item.keyword || "小红书"}\n参考标题：${item.title}`;
}

function metricValue(value: string | undefined) {
  const text = String(value ?? "").toLowerCase();
  const numeric = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  if (text.includes("万") || text.includes("w")) return numeric * 10000;
  if (text.includes("k")) return numeric * 1000;
  return numeric;
}

function normalizeDate(value: string) {
  const match = value.match(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}/);
  if (!match) return "";
  const [year, month, day] = match[0].replace(/\//g, "-").split("-");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function dateBefore(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

function topicDate(item: Topic) {
  const normalized = normalizeDate(item.fetchedAt);
  if (normalized) return normalized;
  if (item.fetchedAt.includes("OpenCLI")) return new Date().toISOString().slice(0, 10);
  return "";
}

function topicTimeValue(item: Topic) {
  const normalizedDate = topicDate(item);
  const parsed = Date.parse(item.fetchedAt.replace(/-/g, "/"));
  if (Number.isFinite(parsed)) return parsed;
  if (normalizedDate) return Date.parse(normalizedDate);
  return 0;
}

export default function TopicsPage() {
  const extensionClientRef = useRef<XhsExtensionClient | null>(null);
  const topicMediaStoreRef = useRef<XhsTopicMediaStore | null>(null);
  const [platform, setPlatform] = useState<(typeof topicTabs)[number]>("小红书");
  const [keyword, setKeyword] = useState("");
  const [topicRows, setTopicRows] = useState<Topic[]>(initialTopics);
  const [hydrated, setHydrated] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [savedKeywords, setSavedKeywords] = useState<string[]>(defaultKeywords);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [collectLimit, setCollectLimit] = useState("");
  const [collectMediaType, setCollectMediaType] = useState<"全部" | "图文" | "视频">("全部");
  const [collectDateRange, setCollectDateRange] = useState<CollectDateRange>("全部");
  const [collectMethod, setCollectMethod] = useState<"浏览量" | "点赞量" | "评论量" | "收藏量">("浏览量");
  const [listMode, setListMode] = useState<"all" | "approved" | "deleted" | "rejected">("all");
  const [rejectedTopics, setRejectedTopics] = useState<Topic[]>([]);
  const [deletedTopics, setDeletedTopics] = useState<Topic[]>([]);
  const [previewMedia, setPreviewMedia] = useState<TopicMediaPreview | null>(null);
  const [sortMode, setSortMode] = useState<"最新采集" | "浏览量" | "点赞量" | "评论量" | "收藏量">("最新采集");
  const [topicKeywordFilter, setTopicKeywordFilter] = useState("全部关键词");
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>("checking");
  const [feedback, setFeedback] = useState("正在检测本机抓取扩展，抓取结果只保存在当前浏览器。");
  const [localMediaUrls, setLocalMediaUrls] = useState<Map<string, string>>(new Map());
  const listSourceRows = useMemo(() => {
    return listMode === "rejected" ? rejectedTopics : listMode === "deleted" ? deletedTopics : topicRows;
  }, [deletedTopics, listMode, rejectedTopics, topicRows]);
  const availableTopicKeywords = useMemo(() => {
    return Array.from(new Set(listSourceRows
      .filter((item) => item.platform === platform)
      .map((item) => item.keyword)
      .filter((item): item is string => Boolean(item))))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [listSourceRows, platform]);
  const filteredTopics = useMemo(() => {
    return listSourceRows
      .filter((item) => item.platform === platform && item.title.includes(keyword))
      .filter((item) => topicKeywordFilter === "全部关键词" ? true : item.keyword === topicKeywordFilter)
      .filter((item) => listMode === "approved" ? item.status === "approved" : true)
      .sort((a, b) => {
        if (sortMode === "最新采集") return 0;
        const field = sortMode === "浏览量" ? "views" : sortMode === "点赞量" ? "likes" : sortMode === "评论量" ? "comments" : "saves";
        const diff = metricValue((b as Topic & { views?: string })[field]) - metricValue((a as Topic & { views?: string })[field]);
        if (diff) return diff;
        const timeDiff = topicTimeValue(b) - topicTimeValue(a);
        if (timeDiff) return timeDiff;
        return b.id.localeCompare(a.id);
      });
  }, [keyword, listMode, listSourceRows, platform, sortMode, topicKeywordFilter]);

  useEffect(() => {
    if (topicKeywordFilter !== "全部关键词" && !availableTopicKeywords.includes(topicKeywordFilter)) {
      setTopicKeywordFilter("全部关键词");
    }
  }, [availableTopicKeywords, topicKeywordFilter]);

  useEffect(() => {
    const mediaStore = createXhsTopicMediaStore();
    topicMediaStoreRef.current = mediaStore;
    const client = createXhsExtensionClient(window, undefined, mediaStore);
    extensionClientRef.current = client;
    let mounted = true;
    void mediaStore.cleanupIncomplete()
      .then(() => client.detect())
      .then(() => {
        if (!mounted) return;
        setExtensionStatus("ready");
        setFeedback("本机抓取扩展已连接，抓取结果只会保存在当前浏览器。");
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (message.includes("incompatible") || message.includes("upgrade")) {
          setExtensionStatus("outdated");
          setFeedback("本机抓取扩展版本过低，请更新扩展后刷新页面。");
        } else {
          setExtensionStatus("missing");
          setFeedback("未检测到本机抓取扩展，或本机媒体存储无法初始化，请检查后刷新页面。");
        }
      });
    return () => {
      mounted = false;
      extensionClientRef.current = null;
      topicMediaStoreRef.current = null;
      client.dispose();
    };
  }, []);

  useEffect(() => {
    const storedTopics = window.localStorage.getItem(TOPIC_STORAGE_KEY);
    const storedRejected = window.localStorage.getItem(REJECTED_TOPIC_STORAGE_KEY);
    const storedDeleted = window.localStorage.getItem(DELETED_TOPIC_STORAGE_KEY);
    const storedKeywords = window.localStorage.getItem(KEYWORDS_STORAGE_KEY);
    if (storedTopics) {
      const parsedTopics = (JSON.parse(storedTopics) as Topic[]).filter((item) => item.platform === "小红书");
      setTopicRows(parsedTopics);
    }
    if (storedRejected) setRejectedTopics((JSON.parse(storedRejected) as Topic[]).filter((item) => item.platform === "小红书"));
    if (storedDeleted) setDeletedTopics((JSON.parse(storedDeleted) as Topic[]).filter((item) => item.platform === "小红书"));
    if (storedKeywords) {
      const parsedKeywords = JSON.parse(storedKeywords) as string[];
      setSavedKeywords(Array.from(new Set([...defaultKeywords, ...parsedKeywords])).filter(Boolean));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(TOPIC_STORAGE_KEY, JSON.stringify(topicRows));
  }, [hydrated, topicRows]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(REJECTED_TOPIC_STORAGE_KEY, JSON.stringify(rejectedTopics));
  }, [hydrated, rejectedTopics]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(DELETED_TOPIC_STORAGE_KEY, JSON.stringify(deletedTopics));
  }, [deletedTopics, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(KEYWORDS_STORAGE_KEY, JSON.stringify(savedKeywords));
  }, [hydrated, savedKeywords]);

  useEffect(() => {
    if (!hydrated || !topicMediaStoreRef.current) return;
    let cancelled = false;
    const created: string[] = [];
    const keys = Array.from(new Set([...topicRows, ...rejectedTopics].flatMap(topicMediaAssetKeys)));
    void Promise.all(keys.map(async (key) => {
      try {
        const blob = await topicMediaStoreRef.current!.getBlob(key);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        created.push(url);
        return [key, url] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (cancelled) {
        for (const url of created) URL.revokeObjectURL(url);
        return;
      }
      setLocalMediaUrls(new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [hydrated, rejectedTopics, topicRows]);

  const collectXhsHotTopics = async (keywordOverride?: string[]) => {
    const activeKeywords = Array.from(new Set((keywordOverride?.length ? keywordOverride : selectedKeywords).map((item) => item.trim()).filter(Boolean)));
    const requestedLimit = Number(collectLimit);
    if (extensionStatus !== "ready" || !extensionClientRef.current) {
      setFeedback(extensionStatus === "outdated" ? "抓取扩展版本过低，请更新扩展后刷新页面。" : "未检测到本机抓取扩展，请安装或启用扩展后刷新页面。");
      return;
    }
    if (!activeKeywords.length) {
      setFeedback("请先在弹窗里选择至少一个关键词，再开始抓取。");
      return;
    }
    if (activeKeywords.some((item) => item.length > 40)) {
      setFeedback("每个关键词最多 40 个字符，请缩短后再抓取。");
      return;
    }
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) {
      setFeedback("请先填写每个关键词要抓取的数量。");
      return;
    }
    const activeLimit = requestedLimit;
    if (navigator.storage) {
      await navigator.storage.persist().catch(() => false);
      const estimate = await navigator.storage.estimate().catch(() => null);
      if (estimate?.quota && (estimate.usage ?? 0) >= estimate.quota) {
        setFeedback("本机浏览器存储空间不足，请先清理空间后再抓取。");
        return;
      }
    }
    setCollectOpen(false);
    setCollecting(true);
    setFeedback(`正在通过本机浏览器抓取：每个关键词 ${activeLimit} 篇，时间：${collectDateRange}，方式：${collectMethod}，类型：${collectMediaType}。`);
    try {
      const task: XhsCollectTask = {
        requestId: crypto.randomUUID(),
        queries: activeKeywords,
        limitPerQuery: activeLimit,
        mediaType: collectMediaType,
        dateRange: collectDateRange,
        sortBy: collectMethod,
        existingUrls: [...topicRows, ...deletedTopics, ...rejectedTopics]
          .map(topicUrl)
          .filter(isXhsHttpsUrl)
          .slice(0, 2_000)
      };
      const result = await extensionClientRef.current.collect(task, (progress) => {
        setFeedback(`${progress.message}（${progress.completed}/${progress.total}）`);
      });
      setTopicRows((rows) => mergeExtensionTopics(rows, result.topics, activeKeywords, rejectedTopics));
      setPlatform("小红书");
      setListMode("all");
      setKeyword("");
      setTopicKeywordFilter("全部关键词");
      setSortMode("最新采集");
      setCollectOpen(false);
      setSelectedKeywords([]);
      setFeedback(result.topics.length
        ? `${result.message}，本地媒体成功 ${result.mediaCompleted} 个、失败 ${result.mediaFailed} 个。`
        : (result.message || "这次没有新增内容：可能已经重复，或当前筛选条件下没有新笔记。"));
    } catch (error) {
      const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
      if (code === "EXTENSION_DISCONNECTED") setExtensionStatus("missing");
      setFeedback(error instanceof Error ? `本机浏览器抓取失败：${error.message}` : "本机浏览器抓取失败。");
    } finally {
      setCollecting(false);
    }
  };

  const approveTopic = (item: Topic) => {
    setTopicRows((rows) => rows.map((row) => row.id === item.id ? { ...row, status: "approved" } : row));
    setFeedback(`已保留选题：${item.title}`);
  };

  const cancelApproveTopic = (item: Topic) => {
    setTopicRows((rows) => rows.map((row) => row.id === item.id ? { ...row, status: "pending" } : row));
    setFeedback(`已取消保留：${item.title}`);
  };

  const rejectTopic = (item: Topic) => {
    const nextItem: Topic = { ...item, status: "rejected" };
    setRejectedTopics((items) => [nextItem, ...items.filter((row) => topicUrl(row) !== topicUrl(item))]);
    setDeletedTopics((items) => items.filter((row) => topicUrl(row) !== topicUrl(item)));
    setTopicRows((rows) => rows.filter((row) => row.id !== item.id));
    setFeedback(`已拒绝选题：${item.title}。以后采集会跳过这篇。`);
  };

  const deleteTopic = async (item: Topic) => {
    const remaining = [...topicRows, ...rejectedTopics, ...deletedTopics]
      .filter((row) => topicUrl(row) !== topicUrl(item));
    const retainedKeys = new Set(remaining.flatMap(topicMediaAssetKeys));
    const keysToDelete = topicMediaAssetKeys(item).filter((key) => !retainedKeys.has(key));
    try {
      await topicMediaStoreRef.current?.deleteAssets(keysToDelete);
    } catch (error) {
      setFeedback(error instanceof Error ? `删除本地媒体失败：${error.message}` : "删除本地媒体失败。");
      return;
    }
    const nextItem: Topic = { ...stripTopicLocalMedia(item), status: "pending" };
    setDeletedTopics((items) => [nextItem, ...items.filter((row) => topicUrl(row) !== topicUrl(item))]);
    setTopicRows((rows) => rows.filter((row) => topicUrl(row) !== topicUrl(item)));
    setFeedback(`已删除选题及其本地媒体：${item.title}。不会加入拒绝名单。`);
  };

  const restoreDeletedTopic = (item: Topic) => {
    setDeletedTopics((items) => items.filter((row) => topicUrl(row) !== topicUrl(item)));
    setTopicRows((rows) => [{ ...item, status: "pending" }, ...rows.filter((row) => topicUrl(row) !== topicUrl(item))]);
    setListMode("all");
    setFeedback(`已取消删除并恢复选题：${item.title}`);
  };

  const restoreRejectedTopic = (item: Topic) => {
    setRejectedTopics((items) => items.filter((row) => topicUrl(row) !== topicUrl(item)));
    setTopicRows((rows) => [{ ...item, status: "pending" }, ...rows.filter((row) => topicUrl(row) !== topicUrl(item))]);
    setListMode("all");
    setFeedback(`已取消拒绝并恢复选题：${item.title}`);
  };

  const toggleKeyword = (value: string) => {
    setSelectedKeywords((items) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value]);
  };

  const addCustomKeywords = (text: string) => {
    const incoming = text.split(/[\n,，、\s]+/).map((item) => item.trim()).filter(Boolean);
    if (!incoming.length) return;
    setSavedKeywords((items) => Array.from(new Set([...items, ...incoming])));
    setSelectedKeywords((items) => Array.from(new Set([...items, ...incoming])));
    setKeywordDraft("");
  };

  const deleteKeyword = (value: string) => {
    setSavedKeywords((items) => items.filter((item) => item !== value));
    setSelectedKeywords((items) => items.filter((item) => item !== value));
  };

  const openTopicPreview = (item: Topic) => {
    const url = topicUrl(item);
    const popup = window.open(url, "content-production-xhs-preview", "popup=yes,width=1180,height=820,left=120,top=80");
    popup?.focus();
    setFeedback(popup ? `已弹出查看：${item.title}` : "浏览器拦截了弹窗，请允许本站弹出窗口后再点击查看。");
  };

  return (
    <>
      <PageHeader
        title="爆款选题库"
        description="使用当前浏览器的小红书登录状态采集公开内容，结果仅保存在本机，不自动发布。"
        action={<div className="flex flex-wrap items-center justify-end gap-2"><span className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${extensionStatus === "ready" ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-orange-50 text-orange-700 ring-orange-100"}`}>{extensionStatusText[extensionStatus]}</span><Button variant="primary" onClick={() => { setSelectedKeywords([]); setKeywordDraft(""); setCollectLimit(""); setCollectDateRange("全部"); setCollectMethod("浏览量"); setCollectOpen(true); }} disabled={collecting || extensionStatus !== "ready"}>{collecting ? "抓取中..." : "抓取"}</Button></div>}
      />

      <div className="rounded-md bg-orange-50 px-4 py-3 text-sm text-orange-700">{feedback}</div>
      <div className="flex flex-wrap gap-2">
        <Button variant={listMode === "all" ? "primary" : "secondary"} onClick={() => setListMode("all")}>全部选题</Button>
        <Button variant={listMode === "approved" ? "primary" : "secondary"} onClick={() => setListMode("approved")}>全部保留</Button>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">{listMode === "approved" ? "全部保留" : "选题列表"}</h2>
            <p className="mt-1 text-sm text-muted">{listMode === "approved" ? "保留下来的图文在这里继续做爆款裂变。" : "抓取结果按卡片展示，一行最多五条，方便快速挑选。"}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select value={topicKeywordFilter} onChange={(event) => setTopicKeywordFilter(event.target.value)} className="h-9 rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">
              <option value="全部关键词">全部关键词</option>
              {availableTopicKeywords.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as "最新采集" | "浏览量" | "点赞量" | "评论量" | "收藏量")} className="h-9 rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">
              <option>最新采集</option>
              <option>浏览量</option>
              <option>点赞量</option>
              <option>评论量</option>
              <option>收藏量</option>
            </select>
            <span className="flex h-9 w-64 max-w-full items-center gap-2 rounded-md border border-line bg-white px-3">
              <Search className="h-4 w-4 text-muted" />
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="w-full text-sm outline-none" placeholder="搜索标题关键词" />
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-sm text-muted ring-1 ring-line">共 {filteredTopics.length} 条</span>
          </div>
        </div>
        {filteredTopics.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredTopics.map((item) => (
              <TopicCard
                key={item.id}
                item={item}
                localMediaUrls={localMediaUrls}
                mode={listMode === "approved" || item.status === "approved" ? "approved" : "candidate"}
                listMode={listMode === "approved" ? "approved" : "all"}
                onPreview={() => openTopicPreview(item)}
                onMediaPreview={(media) => setPreviewMedia({ title: item.title, url: media.url, type: media.type, name: media.name, posterUrl: media.posterUrl })}
                onApprove={() => approveTopic(item)}
                onCancelApprove={() => cancelApproveTopic(item)}
                onDelete={() => void deleteTopic(item)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">
            暂无内容。可以点击右上角“抓取”，选择关键词和数量后采集。
          </div>
        )}
      </section>

      {collectOpen ? (
        <CollectModal
          keywords={savedKeywords}
          selectedKeywords={selectedKeywords}
          keywordDraft={keywordDraft}
          collectLimit={collectLimit}
          collectMediaType={collectMediaType}
          collectDateRange={collectDateRange}
          collectMethod={collectMethod}
          collecting={collecting}
          extensionStatus={extensionStatus}
          onKeywordDraftChange={setKeywordDraft}
          onToggleKeyword={toggleKeyword}
          onDeleteKeyword={deleteKeyword}
          onAddKeywords={() => addCustomKeywords(keywordDraft)}
          onCollectLimitChange={setCollectLimit}
          onCollectMediaTypeChange={setCollectMediaType}
          onCollectDateRangeChange={setCollectDateRange}
          onCollectMethodChange={setCollectMethod}
          onCollect={() => void collectXhsHotTopics()}
          onClose={() => setCollectOpen(false)}
        />
      ) : null}

      {previewMedia ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">{previewMedia.title}</h2>
                <p className="mt-1 text-sm text-muted">{previewMedia.name || "采集图片"}</p>
              </div>
              <button onClick={() => setPreviewMedia(null)} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-4">
              {previewMedia.type === "video"
                ? <video src={previewMedia.url} poster={displayMediaUrl(previewMedia.posterUrl)} className="max-h-[78vh] max-w-full bg-black object-contain" controls autoPlay />
                : <img src={displayMediaUrl(previewMedia.url)} alt={previewMedia.name || previewMedia.title} className="max-h-[78vh] max-w-full object-contain" referrerPolicy="no-referrer" />}
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
}

function TopicCard({
  item,
  localMediaUrls,
  mode,
  listMode,
  onPreview,
  onMediaPreview,
  onApprove,
  onCancelApprove,
  onDelete
}: {
  item: Topic;
  localMediaUrls: ReadonlyMap<string, string>;
  mode: "candidate" | "approved";
  listMode: "all" | "approved";
  onPreview: () => void;
  onMediaPreview: (media: { type: "image" | "video"; url: string; name?: string; posterUrl?: string }) => void;
  onApprove: () => void;
  onCancelApprove: () => void;
  onDelete: () => void;
}) {
  const mediaItems = resolveTopicMedia(item, localMediaUrls).filter((media) => media.url);
  const copy = topicCopy(item);
  const mediaKind = topicMediaKind(item);
  const keywordTags = Array.from(new Set((item.keyword ? [item.keyword] : []).concat(copy.match(/#[\p{L}\p{N}_-]+/gu) ?? []))).slice(0, 8);
  return (
    <article className="flex min-h-[560px] flex-col overflow-hidden rounded-lg border border-line bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-base font-semibold leading-6 text-ink">{item.title}</h3>
          <p className="mt-1 truncate text-xs text-muted">{item.platform} · {item.sourceAccount.replace(/^OpenCLI · /, "")} · {item.fetchedAt}</p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">{mode === "approved" ? "已保留" : mediaKind}</span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid grid-cols-3 gap-2 text-sm text-muted">
          <span>点赞 {item.likes || "-"}</span>
          <span>收藏 {item.saves || "-"}</span>
          <span>评论 {item.comments || "-"}</span>
        </div>

        <div className="max-h-44 min-h-32 overflow-y-auto rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-ink">
          <p className="whitespace-pre-line">{copy}</p>
          {keywordTags.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {keywordTags.map((tag) => <span key={tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-100">{tag}</span>)}
            </div>
          ) : null}
        </div>

        <div className="mt-auto">
          {mediaItems.length ? (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {mediaItems.map((media, index) => (
                <button key={`${media.url}-${index}`} onClick={() => onMediaPreview(media)} className="relative h-56 w-44 shrink-0 overflow-hidden rounded-md border border-line bg-slate-100 text-left transition hover:border-orange-300 hover:shadow-sm">
                  {media.type === "video" && !media.posterUrl
                    ? <video src={media.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                    : <img src={displayMediaUrl(media.type === "video" ? media.posterUrl || media.url : media.url)} alt={media.name || item.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />}
                  <span className="absolute left-2 top-2 rounded bg-slate-950/70 px-2 py-0.5 text-xs font-medium text-white">{media.type === "video" ? "视频" : "图片"}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-orange-200 bg-orange-50 px-4 text-center text-sm text-orange-700">
              暂无采集图片
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-line p-3">
        <button className={actionLinkClass} onClick={onPreview}>查看</button>
        <Button className="w-full" variant="danger" onClick={onDelete}>删除</Button>
        {listMode === "approved" ? (
          <Link className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-orange-500 px-3 text-sm font-medium text-white shadow-sm transition hover:bg-orange-600" href={buildGenerationHref(item)}>爆款裂变</Link>
        ) : mode === "approved" ? (
          <Button className="w-full" onClick={onCancelApprove}>取消保留</Button>
        ) : (
          <Button className="w-full" variant="primary" onClick={onApprove}>保留</Button>
        )}
      </div>
    </article>
  );
}

function CollectModal({
  keywords,
  selectedKeywords,
  keywordDraft,
  collectLimit,
  collectMediaType,
  collectDateRange,
  collectMethod,
  collecting,
  extensionStatus,
  onKeywordDraftChange,
  onToggleKeyword,
  onDeleteKeyword,
  onAddKeywords,
  onCollectLimitChange,
  onCollectMediaTypeChange,
  onCollectDateRangeChange,
  onCollectMethodChange,
  onCollect,
  onClose
}: {
  keywords: string[];
  selectedKeywords: string[];
  keywordDraft: string;
  collectLimit: string;
  collectMediaType: "全部" | "图文" | "视频";
  collectDateRange: CollectDateRange;
  collectMethod: "浏览量" | "点赞量" | "评论量" | "收藏量";
  collecting: boolean;
  extensionStatus: ExtensionStatus;
  onKeywordDraftChange: (value: string) => void;
  onToggleKeyword: (value: string) => void;
  onDeleteKeyword: (value: string) => void;
  onAddKeywords: () => void;
  onCollectLimitChange: (value: string) => void;
  onCollectMediaTypeChange: (value: "全部" | "图文" | "视频") => void;
  onCollectDateRangeChange: (value: CollectDateRange) => void;
  onCollectMethodChange: (value: "浏览量" | "点赞量" | "评论量" | "收藏量") => void;
  onCollect: () => void;
  onClose: () => void;
}) {
  const requestedLimit = Number(collectLimit);
  const canCollect = extensionStatus === "ready" && selectedKeywords.length > 0 && Number.isSafeInteger(requestedLimit) && requestedLimit > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
      <div className="w-full max-w-3xl rounded-lg border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div><h2 className="text-lg font-semibold text-ink">本机浏览器采集小红书爆款</h2><p className="mt-1 text-sm text-muted">确认后会自动打开一个可见的小红书标签页，并使用当前浏览器的登录状态。</p></div>
          <button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm font-medium text-ink">
              每个关键词采集数量
              <input
                type="number"
                min={1}
                value={collectLimit}
                placeholder="自己填写数量"
                onChange={(event) => onCollectLimitChange(event.target.value)}
                className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300"
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              内容类型
              <select
                value={collectMediaType}
                onChange={(event) => onCollectMediaTypeChange(event.target.value as "全部" | "图文" | "视频")}
                className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300"
              >
                <option>全部</option>
                <option>图文</option>
                <option>视频</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-ink">
              抓取时间
              <select
                value={collectDateRange}
                onChange={(event) => onCollectDateRangeChange(event.target.value as CollectDateRange)}
                className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300"
              >
                <option>全部</option>
                <option>一天内</option>
                <option>一周内</option>
                <option>半年内</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-ink">
              抓取方式
              <select
                value={collectMethod}
                onChange={(event) => onCollectMethodChange(event.target.value as "浏览量" | "点赞量" | "评论量" | "收藏量")}
                className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-orange-300"
              >
                <option>浏览量</option>
                <option>点赞量</option>
                <option>评论量</option>
                <option>收藏量</option>
              </select>
            </label>
          </div>

          <KeywordGroup
            title="关键词"
            keywords={keywords}
            selectedKeywords={selectedKeywords}
            onToggleKeyword={onToggleKeyword}
            onDeleteKeyword={onDeleteKeyword}
          />

          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <label className="block text-sm font-medium text-ink">添加关键词</label>
            <textarea value={keywordDraft} onChange={(event) => onKeywordDraftChange(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" placeholder="一行一个关键词，或用空格、逗号分隔" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={onAddKeywords}>添加关键词</Button>
            </div>
          </div>
          <div className="rounded-lg bg-orange-50 px-4 py-3 text-sm text-orange-700">
            本次抓取：{selectedKeywords.length ? selectedKeywords.join(" / ") : "请选择关键词"}；每个关键词 {collectLimit ? `${collectLimit} 篇` : "请填写数量"}；时间：{collectDateRange}；方式：{collectMethod}；类型：{collectMediaType}
          </div>
          {selectedKeywords.length === 0 || !Number.isSafeInteger(requestedLimit) || requestedLimit <= 0 ? <div className="text-sm text-orange-700">请选择至少一个关键词，并填写每个关键词的抓取数量。</div> : null}
          {extensionStatus !== "ready" ? <div className="text-sm text-red-600">本机抓取扩展未连接，暂时不能开始抓取。</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={collecting || !canCollect} onClick={onCollect}>{collecting ? "抓取中..." : "开始抓取"}</Button>
        </div>
      </div>
    </div>
  );
}

function KeywordGroup({
  title,
  keywords,
  selectedKeywords,
  onToggleKeyword,
  onDeleteKeyword
}: {
  title: string;
  keywords: string[];
  selectedKeywords: string[];
  onToggleKeyword: (value: string) => void;
  onDeleteKeyword: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {keywords.map((keyword) => (
          <span key={keyword} className={`group inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-sm font-medium ring-1 transition ${selectedKeywords.includes(keyword) ? "bg-orange-500 text-white ring-orange-500" : "bg-white text-muted ring-line hover:bg-orange-50 hover:text-orange-700"}`}>
            <button type="button" onClick={() => onToggleKeyword(keyword)}>{keyword}</button>
            <button
              type="button"
              aria-label={`删除关键词 ${keyword}`}
              onClick={() => onDeleteKeyword(keyword)}
              className={`grid h-5 w-5 place-items-center rounded-full text-xs transition ${selectedKeywords.includes(keyword) ? "text-white/80 hover:bg-white/20 hover:text-white" : "text-muted hover:bg-orange-100 hover:text-orange-700"}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
