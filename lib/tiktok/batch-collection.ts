import { createCollectionApi, hasCollectionKey, providerLabel, type CollectionApiOptions, type CollectionProvider } from "./collection-api";
import { countryOptions } from "./countries";
import { TikTokServiceError } from "./errors";
import { buildSearchKeywords, hasSunscreenEvidence, needsSunscreenEvidence } from "./search-keywords";
import { collectionLimits, defaultFilters, evaluateVideo, extractVideoRows, normalizeVideo, record, type TikTokVideo, type VideoFilters } from "./videos";

export type CollectionProgress = {
  scanned: number; unique: number; matched: number; pending: number; target: number;
  requests: number; elapsedMs: number; keywordsSearched: number; videos: TikTokVideo[];
};
export type BatchOptions = CollectionApiOptions & { onProgress?: (progress: CollectionProgress) => void };

export function validateBatchInput(input: unknown, options: CollectionApiOptions = {}) {
  const body = record(input), keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword || keyword.length > 1000 || keyword.split(/[\n,，]+/).filter(v => v.trim()).some(v => v.trim().length > 100)) throw new TikTokServiceError("请输入搜索关键词，每行最多100字，总计最多1000字");
  if (body.target !== 20 && body.target !== 50) throw new TikTokServiceError("目标合格数请选择20或50条");
  const source = record(body.filters);
  if (source.region !== undefined && typeof source.region !== "string") throw new TikTokServiceError("请选择有效的搜索地区");
  const region = typeof source.region === "string" ? source.region.trim().toUpperCase() : "MY";
  if (!countryOptions.some(option => option.code === region)) throw new TikTokServiceError("请选择有效的搜索地区");
  const filters: VideoFilters = { ...defaultFilters, ...source, region } as VideoFilters;
  if (![filters.maxFollowers, filters.minViews].every(n => Number.isSafeInteger(n) && n > 0)
    || ![3, 7].includes(filters.days) || !Number.isFinite(filters.minRatio) || filters.minRatio <= 0
    || (filters.maxRatio !== null && (!Number.isFinite(filters.maxRatio) || filters.maxRatio < filters.minRatio))
    || typeof filters.category !== "string" || filters.category.length > 100) throw new TikTokServiceError("粉丝、播放、时间或倍数筛选条件无效");
  const excludeIds = body.excludeIds ?? [];
  if (!Array.isArray(excludeIds) || excludeIds.length > 5000 || excludeIds.some(id => typeof id !== "string" || !/^\d+$/.test(id))) throw new TikTokServiceError("已采集视频编号无效或超过5000条，请导出后清理候选");
  if (!hasCollectionKey(options)) throw new TikTokServiceError("尚未配置 TIKHUB_API_KEY 或 SCRAPECREATORS_API_KEY", 503);
  return { keyword, filters, target: body.target, excludeIds: excludeIds as string[] };
}

type Task = { kind: "search"; keyword: string; offset: number; page: number; provider?: CollectionProvider; priority: number; retry: number }
  | { kind: "profile"; key: string; username: string; secUid?: string; priority: number; retry: number }
  | { kind: "detail" | "category"; video: TikTokVideo; secUid?: string; priority: number; retry: number };
type Profile = { followers: number; evidence: Record<string, unknown> };
type CachedProfile = { waiters: Array<{ video: TikTokVideo; secUid?: string }>; value?: Profile; failed?: boolean };

export async function collectBatch(input: unknown, options: BatchOptions = {}) {
  const { keyword, filters, target, excludeIds } = validateBatchInput(input, options);
  const started = Date.now(), capturedAt = new Date(started).toISOString();
  const keywords = buildSearchKeywords(keyword, filters.region), topical = needsSunscreenEvidence(keyword);
  const warnings = new Set<string>(), seen = new Set<string>(), excluded = new Set(excludeIds), profiles = new Map<string, CachedProfile>();
  const retained = new Map<string, TikTokVideo>();
  const evidencePages: Array<Record<string, unknown>> = [];
  const queue: Task[] = keywords.map(word => ({ kind: "search", keyword: word, offset: 0, page: 0, priority: 1, retry: 0 }));
  let active = 0, concurrency = collectionLimits.concurrency, pauseUntil = 0, scanned = 0, rejected = 0, searchCalls = 0, successfulSearches = 0;
  let stopReason = "", firstSearchError: unknown, lastProgress = 0, lastMatched = -1, fatal: unknown;
  const rejectedReasons: Record<string, number> = {};
  const searchedKeywords = new Set<string>();
  const abort = AbortSignal.timeout(collectionLimits.milliseconds);
  const api = createCollectionApi({ ...options, maxRequests: Math.min(options.maxRequests ?? Infinity, target === 50 ? collectionLimits.requests * 2 : collectionLimits.requests),
    signal: options.signal ? AbortSignal.any([options.signal, abort]) : abort,
    onFallback: message => warnings.add(message), onRateLimit: () => {
      concurrency = Math.max(1, Math.floor(concurrency / 2)); pauseUntil = Date.now() + 2000;
      warnings.add("上游限流，已降低并发继续采集");
    } });
  const matched = () => [...retained.values()].filter(video => evaluateVideo(video, filters).status === "matched");
  const videos = () => [...matched().slice(0, target), ...[...retained.values()].filter(video => evaluateVideo(video, filters).status === "pending").slice(0, 100)];
  function progress(force = false) {
    const found = matched().length;
    if (!force && found === lastMatched && Date.now() - lastProgress < 2000) return;
    lastProgress = Date.now(); lastMatched = found;
    const rows = videos();
    options.onProgress?.({ scanned, unique: seen.size, matched: Math.min(found, target), pending: rows.length - Math.min(found, target), target,
      requests: api.requestCount, elapsedMs: Date.now() - started, keywordsSearched: searchedKeywords.size, videos: rows });
  }
  function reject(reasons: string[]) {
    rejected++;
    for (const reason of reasons) rejectedReasons[reason] = (rejectedReasons[reason] ?? 0) + 1;
  }
  function keep(video: TikTokVideo) {
    const assessment = evaluateVideo(video, filters);
    if (assessment.status === "excluded") reject(assessment.reasons);
    else retained.set(video.id, video);
    if (matched().length >= target) stopReason = "target_reached";
  }
  function markPending(video: TikTokVideo) { keep({ ...video, evidence: { ...video.evidence, verificationPending: true } }); }
  function applyProfile(video: TikTokVideo, secUid: string | undefined, profile: Profile) {
    video.followers = profile.followers;
    video.evidence.profile = profile.evidence;
    if (evaluateVideo(video, { ...filters, category: "" }).status === "excluded") { reject(evaluateVideo(video, filters).reasons); return; }
    queue.push({ kind: "detail", video, secUid, priority: 0, retry: 0 });
  }
  function enrich(video: TikTokVideo, secUid?: string) {
    const key = `${video.author.toLowerCase()}:${secUid ?? ""}`, cached = profiles.get(key);
    if (cached?.value) applyProfile(video, secUid, cached.value);
    else if (cached?.failed) markPending({ ...video, followers: null });
    else if (cached) cached.waiters.push({ video, secUid });
    else {
      profiles.set(key, { waiters: [{ video, secUid }] });
      queue.push({ kind: "profile", key, username: video.author, secUid, priority: 0, retry: 0 });
    }
  }
  function failed(task: Task) {
    if (task.kind === "profile") {
      const cached = profiles.get(task.key)!; cached.failed = true;
      for (const { video } of cached.waiters) markPending({ ...video, followers: null });
    } else if (task.kind !== "search") markPending(task.video);
  }
  async function execute(task: Task) {
    try {
      if (task.kind === "search") {
        searchCalls++; searchedKeywords.add(task.keyword);
        const response = await api.request("fetch_video_search_result", { keyword: task.keyword, region: filters.region, offset: task.offset, count: 20, sort_type: 1, publish_time: 7 }, task.provider);
        const { data, provider, offset } = response;
        if (!["data", "aweme_list", "search_item_list", "videos"].some(key => Array.isArray(data[key]))) throw new TikTokServiceError("搜索响应缺少视频列表", 502);
        successfulSearches++;
        const rows = extractVideoRows(data); scanned += rows.length;
        evidencePages.push({ keyword: task.keyword, region: filters.region, offset, provider, returned: rows.length, cursor: data.cursor, hasMore: data.has_more });
        let added = 0;
        for (const value of rows) {
          const row = record(value), author = record(row.author);
          if (typeof row.aweme_id !== "string" || seen.has(row.aweme_id)) continue;
          seen.add(row.aweme_id); added++;
          if (excluded.has(row.aweme_id)) continue;
          if (row.image_post_info || row.aweme_type === 150) { reject(["图文作品"]); continue; }
          let video: TikTokVideo;
          try { video = normalizeVideo(row, capturedAt, providerLabel(provider)); }
          catch { warnings.add("部分搜索行身份无效，已跳过"); continue; }
          video.searchRegion = filters.region; video.country = null; video.hasProductLink = null;
          if (video.followers === 0) video.followers = null;
          video.evidence = { search: { keyword: task.keyword, region: filters.region, provider, id: video.id, username: video.author, secUid: author.sec_uid, followers: video.followers, views: video.views, publishedAt: video.publishedAt } };
          const assessment = evaluateVideo(video, { ...filters, category: "" });
          if (assessment.status === "excluded") { reject(assessment.reasons); continue; }
          if (topical && !hasSunscreenEvidence(video.description)) { reject(["原文缺少明确防晒主题，未计入命中"]); continue; }
          enrich(video, typeof author.sec_uid === "string" ? author.sec_uid : undefined);
        }
        const next = data.cursor ?? data.offset;
        if (![true, false, 0, 1].includes(data.has_more as boolean | number)) warnings.add("部分关键词未提供有效分页状态，搜索范围待核实");
        else if ([true, 1].includes(data.has_more as boolean | number) && rows.length) {
          if (Number.isSafeInteger(next) && Number(next) > offset && added && task.page + 1 < collectionLimits.pages) {
            queue.push({ ...task, offset: Number(next), page: task.page + 1, provider, retry: 0, priority: 2 });
          } else warnings.add("部分关键词达到页数上限或分页重复，已停止翻页");
        }
      } else if (task.kind === "profile") {
        const { data, provider } = await api.request("handler_user_profile", { unique_id: task.username });
        const user = record(data.user ?? data);
        if (typeof user.unique_id !== "string" || user.unique_id.toLowerCase() !== task.username.toLowerCase()
          || (task.secUid && user.sec_uid !== task.secUid)) throw new TikTokServiceError(`@${task.username} 作者身份不一致，粉丝数待核实`, 502);
        if (!Number.isSafeInteger(user.follower_count) || Number(user.follower_count) < 0) throw new TikTokServiceError("粉丝数缺失，待核实", 502);
        const profile = { followers: Number(user.follower_count), evidence: { provider, username: user.unique_id, secUid: user.sec_uid, followers: user.follower_count, capturedAt: new Date().toISOString() } };
        const cached = profiles.get(task.key)!; cached.value = profile;
        for (const { video, secUid } of cached.waiters) applyProfile(video, secUid, profile);
      } else if (task.kind === "detail") {
        const { data, provider } = await api.request("fetch_one_video_v3", { aweme_id: task.video.id, username: task.video.author, region: filters.region });
        const row = record(extractVideoRows(data).find(row => record(row).aweme_id === task.video.id)), author = record(row.author);
        if (typeof author.unique_id !== "string" || author.unique_id.toLowerCase() !== task.video.author.toLowerCase()
          || (task.secUid && author.sec_uid !== task.secUid)) throw new TikTokServiceError("视频详情作者身份不一致", 502);
        if (row.image_post_info || row.aweme_type === 150) { reject(["图文作品"]); return; }
        const video = { ...normalizeVideo(row, new Date().toISOString(), providerLabel(provider)), followers: task.video.followers, country: null, hasProductLink: null,
          searchRegion: filters.region, evidence: { ...task.video.evidence, detail: { provider, id: row.aweme_id, username: author.unique_id, secUid: author.sec_uid, statistics: row.statistics, publishedAt: row.create_time } } };
        if (topical && !hasSunscreenEvidence(video.description)) { markPending(video); return; }
        if (filters.category && evaluateVideo(video, { ...filters, category: "" }).status === "matched") queue.push({ kind: "category", video, secUid: task.secUid, priority: 0, retry: 0 });
        else keep(video);
      } else {
        const { data, provider } = await api.request("web/fetch_post_detail_v2", { itemId: task.video.id, region: filters.region });
        const item = record(record(data.itemInfo).itemStruct), author = record(item.author);
        if (item.id !== task.video.id || typeof author.uniqueId !== "string" || author.uniqueId.toLowerCase() !== task.video.author.toLowerCase()
          || (task.secUid && author.secUid !== task.secUid)) throw new TikTokServiceError("内容类目身份不一致", 502);
        const labels = Array.isArray(item.diversificationLabels) ? item.diversificationLabels.filter(value => typeof value === "string" && value.trim()) : [];
        keep({ ...task.video, category: typeof labels[0] === "string" ? labels[0] : null, evidence: { ...task.video.evidence, category: { provider, id: item.id, labels } } });
      }
    } catch (error) {
      warnings.add(error instanceof TikTokServiceError ? error.message : "上游采集失败，部分字段待核实");
      if (task.kind === "search") firstSearchError ??= error;
      if (task.kind === "search" && task.retry === 0 && !api.exhausted) queue.push({ ...task, retry: 1, priority: 3 });
      else failed(task);
    } finally { progress(); }
  }
  progress(true);
  await new Promise<void>(resolve => {
    function pump() {
      if (!stopReason && (Date.now() - started >= collectionLimits.milliseconds - 20000 || abort.aborted || options.signal?.aborted)) stopReason = "time_limit";
      if (!stopReason && api.exhausted) stopReason = "request_limit";
      if (!stopReason && seen.size >= collectionLimits.candidates) stopReason = "candidate_limit";
      if (stopReason) { if (!active) resolve(); return; }
      if (!queue.length && !active) { stopReason = "queries_exhausted"; resolve(); return; }
      if (pauseUntil > Date.now()) { setTimeout(pump, pauseUntil - Date.now()); return; }
      queue.sort((a, b) => a.priority - b.priority);
      while (queue.length && active < concurrency && !stopReason) {
        active++;
        void execute(queue.shift()!).catch(error => { fatal = error; stopReason = "internal_error"; }).finally(() => { active--; pump(); });
      }
    }
    pump();
  });
  if (fatal) throw fatal;
  if (!successfulSearches && firstSearchError) throw firstSearchError;
  if (matched().length < target) warnings.add(`本轮找到 ${matched().length}/${target} 条合格视频，${stopReason === "queries_exhausted" ? "当前关键词搜索已完成" : "已达到本轮采集上限"}；未用不符合或待核实数据补足。`);
  progress(true);
  return { videos: videos(), warnings: [...warnings], scanned, hasMore: stopReason !== "queries_exhausted", nextOffset: null,
    capturedAt, evidencePages, keyword, country: filters.region, region: filters.region, provider: undefined,
    sample: "多关键词直接搜索并后台筛选，非全站覆盖", filters,
    stats: { target, matched: Math.min(matched().length, target), unique: seen.size, rejected, rejectedReasons, requests: api.requestCount,
      searchCalls, keywordsSearched: searchedKeywords.size, elapsedMs: Date.now() - started, stopReason } };
}
