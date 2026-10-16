import { TikTokServiceError } from "./errors";
import { extractVideoRows, mergeVideos, normalizeVideo, record, type TikTokVideo } from "./videos";
import { getTikTokRewriteConfig } from "./rewrite";
import { countryOptions } from "./countries";
import { createCollectionApi, hasCollectionKey, providerLabel, type CollectionApiOptions, type CollectionProvider } from "./collection-api";

function videoEvidence(value: unknown) {
  const row = record(value), author = record(row.author), video = record(row.video);
  return {
    aweme_id: row.aweme_id, aweme_type: row.aweme_type, image_post_info: row.image_post_info ? true : undefined,
    desc: row.desc, create_time: row.create_time,
    author: { unique_id: author.unique_id, sec_uid: author.sec_uid, follower_count: author.follower_count },
    statistics: row.statistics, video: { duration: video.duration }
  };
}

export function getTikTokCapabilities() {
  return {
    collection: hasCollectionKey(),
    production: Boolean(getTikTokRewriteConfig().apiKey),
    productionModel: getTikTokRewriteConfig().model,
    visualAnalysis: hasCollectionKey() && Boolean(getTikTokRewriteConfig().apiKey),
    transcription: hasCollectionKey() && Boolean(getTikTokRewriteConfig().apiKey)
  };
}

export async function collectTikTokVideos(input: unknown, options: CollectionApiOptions = {}) {
  const body = record(input);
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  const urls = Array.isArray(body.urls) ? body.urls : [];
  const limit = body.limit ?? 20;
  const offset = body.offset ?? 0;
  const days = body.days ?? 7;
  const country = body.country === undefined ? "MY" : typeof body.country === "string" ? body.country.trim().toUpperCase() : null;
  if (country === null || (country !== "" && !countryOptions.some(option => option.code === country))) throw new TikTokServiceError("请选择有效的账号国家或国家不限");
  const region = country || "MY";
  if (!keyword && !urls.length) throw new TikTokServiceError("请输入关键词或完整视频链接");
  if (keyword.length > 100 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) throw new TikTokServiceError("关键词最多 100 字，每批采集 1–50 条候选");
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || ![3, 7].includes(days as number)) throw new TikTokServiceError("分页或时间范围无效");
  if (body.provider !== undefined && (typeof body.provider !== "string" || !["scrapecreators", "tikhub"].includes(body.provider))) throw new TikTokServiceError("采集来源无效，请重新开始采集");
  if (Number(offset) > 0 && body.provider === undefined) throw new TikTokServiceError("下一批需要携带采集来源，请重新开始采集");
  if (urls.length > 20) throw new TikTokServiceError("一次最多采集 20 个视频链接");
  const linkRows = urls.map((url) => {
    if (typeof url !== "string") throw new TikTokServiceError("视频链接格式无效");
    const id = url.match(/\/video\/(\d+)/)?.[1];
    try { return normalizeVideo({ id, url }); } catch (error) { throw new TikTokServiceError(error instanceof Error ? error.message : "视频链接无效"); }
  });
  if (!hasCollectionKey(options)) throw new TikTokServiceError("尚未配置 SCRAPECREATORS_API_KEY 或 TIKHUB_API_KEY，无法真实采集；可先导入 JSON/CSV", 503);
  const capturedAt = new Date().toISOString();
  const deadline = Date.now() + 110000;
  const warnings: string[] = [];
  const evidencePages: Array<{ offset: number; response: unknown }> = [];
  const rowProviders = new WeakMap<object, CollectionProvider>();
  const dataProviders = new WeakMap<object, CollectionProvider>();
  let searchProvider = body.provider as CollectionProvider | undefined, searchOffset = Number(offset);
  const api = createCollectionApi({ ...options, signal: AbortSignal.timeout(110000), onFallback: message => warnings.push(message) });

  async function request(endpoint: string, params: Record<string, string | number>) {
    if (Date.now() >= deadline) throw new TikTokServiceError("本批采集达到时间上限，未完成字段请下一批核实", 502);
    const result = await api.request(endpoint, params, endpoint === "fetch_general_search_result" ? searchProvider : undefined);
    dataProviders.set(result.data, result.provider);
    if (endpoint === "fetch_general_search_result") {
      searchProvider = result.provider; searchOffset = result.offset;
    }
    for (const row of extractVideoRows(result.data)) if (row && typeof row === "object") rowProviders.set(row, result.provider);
    return result.data;
  }

  async function detailVideo(id: string, username: string) {
    const data = await request("fetch_one_video_v3", { aweme_id: id, username, region });
    const row = extractVideoRows(data).find((value) => record(value).aweme_id === id);
    if (!row) throw new Error("详情视频 ID 与请求不一致");
    const author = record(record(row).author);
    if (typeof author.unique_id !== "string" || author.unique_id.toLowerCase() !== username.toLowerCase()) throw new Error("详情作者与请求链接不一致");
    return row;
  }

  const userCache = new Map<string, Promise<{ followers: number | null; country: string | null; evidence: Record<string, unknown> }>>();
  function userFacts(username: string, secUid: unknown) {
    const key = username.toLowerCase();
    const cacheKey = `${key}:${typeof secUid === "string" ? secUid : ""}`;
    const cached = userCache.get(cacheKey);
    if (cached) return cached;
    const pending = (async () => {
      const [profileResult, countryResult] = await Promise.allSettled([
        request("handler_user_profile", { unique_id: username }),
        request("fetch_user_country_by_username", { username })
      ]);
      let followers: number | null = null, country: string | null = null;
      const evidence: Record<string, unknown> = {};
      if (profileResult.status === "fulfilled") {
        const profile = record(profileResult.value.user ?? profileResult.value);
        evidence.profile = { provider: dataProviders.get(profileResult.value), unique_id: profile.unique_id, sec_uid: profile.sec_uid, follower_count: profile.follower_count };
        if (typeof profile.unique_id === "string" && profile.unique_id.toLowerCase() === key
          && !(typeof secUid === "string" && typeof profile.sec_uid === "string" && profile.sec_uid !== secUid)) {
          if (Number.isSafeInteger(profile.follower_count) && Number(profile.follower_count) >= 0) followers = Number(profile.follower_count);
        } else warnings.push(`@${username} 粉丝接口作者不一致，粉丝数待核实`);
      } else warnings.push(`@${username}：${profileResult.reason instanceof Error ? profileResult.reason.message : "粉丝数读取失败"}`);
      if (countryResult.status === "fulfilled") {
        const data = countryResult.value;
        evidence.country = { provider: dataProviders.get(data), username: data.username, sec_user_id: data.sec_user_id, country: data.country };
        if (typeof data.username === "string" && data.username.toLowerCase() === key
          && !(typeof secUid === "string" && typeof data.sec_user_id === "string" && data.sec_user_id !== secUid)) {
          if (typeof data.country === "string" && /^[A-Za-z]{2}$/.test(data.country)) country = data.country.toUpperCase();
        } else warnings.push(`@${username} 国家接口作者不一致，国家待核实`);
      } else warnings.push(`@${username}：${countryResult.reason instanceof Error ? countryResult.reason.message : "账号国家读取失败"}`);
      return { followers, country, evidence };
    })();
    userCache.set(cacheKey, pending);
    return pending;
  }

  let rawRows: unknown[] = [], nextOffset: number | null = null, hasMore = false;
  const detailedIds = new Set<string>();
  if (linkRows.length) {
    for (const link of linkRows) {
      try {
        const row = await detailVideo(link.id, link.author);
        rawRows.push(row);
        detailedIds.add(link.id);
      } catch (error) { warnings.push(`${link.id}：${error instanceof Error ? error.message : "详情读取失败"}`); }
    }
  } else {
    let cursor = Number(offset);
    const seen = new Set<string>();
    for (let page = 0; page < 5 && rawRows.length < Number(limit); page++) {
      let data: Record<string, unknown>;
      try {
        data = await request("fetch_general_search_result", { keyword, region, offset: cursor, count: Math.min(20, Number(limit) - rawRows.length), sort_type: 1, publish_time: 7 });
        cursor = searchOffset;
      } catch (error) {
        if (!rawRows.length) throw error;
        warnings.push(error instanceof Error ? error.message : "后续页读取失败");
        hasMore = true; nextOffset = cursor; break;
      }
      if (!Array.isArray(data.data) && !Array.isArray(data.aweme_list) && !Array.isArray(data.videos)) throw new TikTokServiceError("TikHub 搜索响应缺少视频列表，需核实接口结构", 502);
      const rows = extractVideoRows(data);
      if (rows.length > Number(limit) - rawRows.length) warnings.push(`上游本页返回 ${rows.length} 条，本批最多处理剩余 ${Number(limit) - rawRows.length} 条；超出部分未处理，可提高每批数量后重新采集`);
      evidencePages.push({ offset: cursor, response: { provider: searchProvider, status_code: data.status_code, has_more: data.has_more, cursor: data.cursor, offset: data.offset, videos: rows.map(videoEvidence) } });
      let added = 0;
      for (const value of rows) {
        const id = record(value).aweme_id;
        if (typeof id !== "string") { warnings.push("搜索行缺少精确字符串视频 ID，已跳过"); continue; }
        if (seen.has(id)) continue;
        seen.add(id); rawRows.push(value); added++;
        if (rawRows.length >= Number(limit)) break;
      }
      if (![true, false, 0, 1].includes(data.has_more as boolean | number)) {
        warnings.push("上游未提供有效分页状态，本次搜索完整性待核实"); hasMore = true; nextOffset = null; break;
      }
      hasMore = data.has_more === true || data.has_more === 1;
      if (!hasMore) { nextOffset = null; break; }
      const next = data.cursor ?? data.offset;
      if (!Number.isSafeInteger(next) || Number(next) <= cursor || !added) {
        warnings.push("搜索分页或视频重复，已停止继续请求"); nextOffset = null; break;
      }
      cursor = Number(next); nextOffset = cursor;
    }
  }

  let videos: TikTokVideo[] = [];
  // 每组四条，避免用户资料请求同时涌入上游服务。
  for (let i = 0; i < rawRows.length; i += 4) {
    const results = await Promise.allSettled(rawRows.slice(i, i + 4).map(async (value) => {
      let row = record(value);
      if (row.image_post_info || row.aweme_type === 150) throw new Error("图文作品已跳过");
      let video = normalizeVideo(row, capturedAt, providerLabel(rowProviders.get(row) ?? "tikhub"));
      if (!detailedIds.has(video.id)) {
        try {
          row = record(await detailVideo(video.id, video.author));
          video = normalizeVideo(row, capturedAt, providerLabel(rowProviders.get(row) ?? "tikhub"));
        } catch (error) { warnings.push(`${video.id}：${error instanceof Error ? error.message : "详情补采失败"}`); }
      }
      if (row.image_post_info || row.aweme_type === 150) throw new Error("图文作品已跳过");
      const [facts, webResult] = await Promise.all([
        userFacts(video.author, record(row.author).sec_uid),
        request("web/fetch_post_detail_v2", { itemId: video.id, region }).then(data => ({ data, error: null })).catch(error => ({ data: null, error }))
      ]);
      let category: string | null = null;
      const webEvidence: Record<string, unknown> = {};
      if (webResult.data) {
        const item = record(record(webResult.data.itemInfo).itemStruct), author = record(item.author);
        if (item.id === video.id && typeof author.uniqueId === "string" && author.uniqueId.toLowerCase() === video.author.toLowerCase()
          && !(typeof record(row.author).sec_uid === "string" && typeof author.secUid === "string" && author.secUid !== record(row.author).sec_uid)) {
          const labels = Array.isArray(item.diversificationLabels) ? item.diversificationLabels.filter(value => typeof value === "string" && value.trim()) : [];
          category = typeof labels[0] === "string" ? labels[0] : null;
          Object.assign(webEvidence, { provider: dataProviders.get(webResult.data), id: item.id, author: { uniqueId: author.uniqueId, secUid: author.secUid }, diversificationLabels: labels });
        } else warnings.push(`${video.id} Web 详情身份不一致，内容类目待核实`);
      } else warnings.push(`${video.id}：${webResult.error instanceof Error ? webResult.error.message : "内容类目读取失败"}`);
      return { ...video, followers: facts.followers ?? (video.followers !== null && video.followers > 0 ? video.followers : null), country: facts.country,
        hasProductLink: null, category, evidence: { video: { provider: rowProviders.get(row), ...videoEvidence(row) }, user: facts.evidence, web: webEvidence } };
    }));
    for (const result of results) {
      if (result.status === "fulfilled") videos = mergeVideos(videos, [result.value]);
      else warnings.push(result.reason instanceof Error ? result.reason.message : "视频记录无效");
    }
  }
  return { videos, warnings, scanned: rawRows.length, hasMore, nextOffset, capturedAt, evidencePages, keyword, country, provider: searchProvider, sample: "关键词或指定链接样本，非全站覆盖" };
}
