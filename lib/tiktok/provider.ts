import { TikTokServiceError } from "./errors";
import { extractVideoRows, mergeVideos, normalizeVideo, record, type TikTokVideo } from "./videos";
import { getTikTokRewriteConfig } from "./rewrite";
import { countryOptions } from "./countries";

const baseUrl = "https://api.tikhub.io/api/v1/tiktok/";

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
    collection: Boolean(process.env.TIKHUB_API_KEY?.trim()),
    production: Boolean(getTikTokRewriteConfig().apiKey),
    productionModel: getTikTokRewriteConfig().model,
    visualAnalysis: Boolean(process.env.TIKHUB_API_KEY?.trim()) && Boolean(getTikTokRewriteConfig().apiKey),
    transcription: Boolean(process.env.TIKHUB_API_KEY?.trim()) && Boolean(getTikTokRewriteConfig().apiKey)
  };
}

export async function collectTikTokVideos(input: unknown, options: { apiKey?: string; fetcher?: typeof fetch } = {}) {
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
  if (urls.length > 20) throw new TikTokServiceError("一次最多采集 20 个视频链接");
  const linkRows = urls.map((url) => {
    if (typeof url !== "string") throw new TikTokServiceError("视频链接格式无效");
    const id = url.match(/\/video\/(\d+)/)?.[1];
    try { return normalizeVideo({ id, url }); } catch (error) { throw new TikTokServiceError(error instanceof Error ? error.message : "视频链接无效"); }
  });
  const apiKey = options.apiKey ?? process.env.TIKHUB_API_KEY?.trim();
  if (!apiKey) throw new TikTokServiceError("尚未配置 TIKHUB_API_KEY，无法真实采集；可先导入 JSON/CSV", 503);
  const fetcher = options.fetcher ?? fetch;
  const capturedAt = new Date().toISOString();
  const deadline = Date.now() + 110000;
  const warnings: string[] = [];
  const evidencePages: Array<{ offset: number; response: unknown }> = [];

  async function request(endpoint: string, params: Record<string, string | number>) {
    if (Date.now() >= deadline) throw new TikTokServiceError("本批采集达到时间上限，未完成字段请下一批核实", 502);
    const url = new URL(endpoint.startsWith("web/") ? endpoint : `app/v3/${endpoint}`, baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let response: Response;
    try {
      response = await fetcher(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now()))) });
    } catch { throw new TikTokServiceError(`TikHub ${endpoint} 连接失败或超时`, 502); }
    if (!response.ok) throw new TikTokServiceError(`TikHub ${endpoint} HTTP ${response.status}，请检查服务权限与额度`, 502);
    const envelope = record(await response.json().catch(() => null));
    if (envelope.code !== 200) throw new TikTokServiceError(`TikHub ${endpoint} 业务状态异常`, 502);
    const data = record(envelope.data);
    for (const key of ["status_code", "statusCode"]) {
      if (data[key] !== undefined && data[key] !== 0) throw new TikTokServiceError(`TikHub ${endpoint} 上游业务状态异常`, 502);
    }
    return data;
  }

  async function detailVideo(id: string, username: string) {
    const data = await request("fetch_one_video_v3", { aweme_id: id, region });
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
        evidence.profile = { unique_id: profile.unique_id, sec_uid: profile.sec_uid, follower_count: profile.follower_count };
        if (typeof profile.unique_id === "string" && profile.unique_id.toLowerCase() === key
          && !(typeof secUid === "string" && typeof profile.sec_uid === "string" && profile.sec_uid !== secUid)) {
          if (Number.isSafeInteger(profile.follower_count) && Number(profile.follower_count) >= 0) followers = Number(profile.follower_count);
        } else warnings.push(`@${username} 粉丝接口作者不一致，粉丝数待核实`);
      } else warnings.push(`@${username}：${profileResult.reason instanceof Error ? profileResult.reason.message : "粉丝数读取失败"}`);
      if (countryResult.status === "fulfilled") {
        const data = countryResult.value;
        evidence.country = { username: data.username, sec_user_id: data.sec_user_id, country: data.country };
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
        data = await request("fetch_general_search_result", { keyword, offset: cursor, count: Math.min(20, Number(limit) - rawRows.length), sort_type: 1, publish_time: 7 });
      } catch (error) {
        if (!rawRows.length) throw error;
        warnings.push(error instanceof Error ? error.message : "后续页读取失败");
        hasMore = true; nextOffset = cursor; break;
      }
      if (!Array.isArray(data.data) && !Array.isArray(data.aweme_list) && !Array.isArray(data.videos)) throw new TikTokServiceError("TikHub 搜索响应缺少视频列表，需核实接口结构", 502);
      const rows = extractVideoRows(data);
      evidencePages.push({ offset: cursor, response: { status_code: data.status_code, has_more: data.has_more, cursor: data.cursor, offset: data.offset, videos: rows.map(videoEvidence) } });
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
      let video = normalizeVideo(row, capturedAt, "TikHub App V3");
      if (!detailedIds.has(video.id)) {
        try {
          row = record(await detailVideo(video.id, video.author));
          video = normalizeVideo(row, capturedAt, "TikHub App V3");
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
          Object.assign(webEvidence, { id: item.id, author: { uniqueId: author.uniqueId, secUid: author.secUid }, diversificationLabels: labels });
        } else warnings.push(`${video.id} Web 详情身份不一致，内容类目待核实`);
      } else warnings.push(`${video.id}：${webResult.error instanceof Error ? webResult.error.message : "内容类目读取失败"}`);
      return { ...video, followers: facts.followers ?? (video.followers !== null && video.followers > 0 ? video.followers : null), country: facts.country,
        hasProductLink: null, category, evidence: { video: videoEvidence(row), user: facts.evidence, web: webEvidence } };
    }));
    for (const result of results) {
      if (result.status === "fulfilled") videos = mergeVideos(videos, [result.value]);
      else warnings.push(result.reason instanceof Error ? result.reason.message : "视频记录无效");
    }
  }
  return { videos, warnings, scanned: rawRows.length, hasMore, nextOffset, capturedAt, evidencePages, keyword, country, sample: "关键词或指定链接样本，非全站覆盖" };
}
