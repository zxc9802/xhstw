import { countryOptions } from "./countries";

export type TikTokVideo = {
  id: string;
  url: string;
  author: string;
  description: string;
  followers: number | null;
  views: number | null;
  publishedAt: string | null;
  country: string | null;
  searchRegion?: string;
  hasProductLink: boolean | null;
  category: string | null;
  duration: number | null;
  transcript: string;
  capturedAt: string;
  source: string;
  evidence: Record<string, unknown>;
};

export type VideoFilters = {
  region: string;
  maxFollowers: number;
  minViews: number;
  days: 3 | 7;
  minRatio: number;
  maxRatio: number | null;
  category: string;
};

export const defaultFilters: VideoFilters = {
  region: "MY", maxFollowers: 20000, minViews: 50000, days: 7,
  minRatio: 3, maxRatio: null, category: ""
};

export const collectionLimits = { candidates: 5000, requests: 300, milliseconds: 360000, pages: 5, concurrency: 6 };

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function count(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function date(value: unknown): string | null {
  if (typeof value === "number" && value > 0 && value < 1e12) return new Date(value * 1000).toISOString();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T.*(?:Z|[+-]\d{2}:\d{2})$)/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function productLink(row: Record<string, unknown>): boolean | null {
  if (typeof row.hasProductLink === "boolean") return row.hasProductLink;
  if (row.hasProductLink === "true" || row.hasProductLink === "false") return row.hasProductLink === "true";
  if (!Array.isArray(row.anchors)) return null;
  if (row.anchors.length === 0) return false;
  for (const value of row.anchors) {
    const anchor = record(value);
    let extra = record(anchor.extra);
    if (typeof anchor.extra === "string") {
      try { extra = record(JSON.parse(anchor.extra)); } catch { /* 非 JSON 的锚点不能证明带货。 */ }
    }
    if (text(extra.product_id) || text(anchor.product_id)) return true;
  }
  return null;
}

export function normalizeVideo(input: unknown, capturedAt = new Date().toISOString(), source = "用户导入"): TikTokVideo {
  const row = record(input);
  const author = record(row.author);
  const statistics = record(row.statistics);
  const media = record(row.video);
  const rawId = row.id ?? row.aweme_id;
  if (typeof rawId !== "string" || !/^\d+$/.test(rawId)) throw new Error("视频 ID 必须为精确数字字符串，不能使用数字类型");
  const username = text(author.unique_id) || text(row.author) || text(row.username);
  const url = text(row.url) || (username ? `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${rawId}` : "");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("需要完整 TikTok 视频链接"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.tiktok.com") throw new Error("需要 https://www.tiktok.com 的 TikTok 视频链接");
  const urlId = parsed.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/)?.[1];
  if (!urlId) throw new Error("仅支持单条 TikTok 视频链接，图文或短链接请先打开完整地址");
  if (urlId !== rawId) throw new Error("视频 ID 与链接不一致");
  const urlAuthor = decodeURIComponent(parsed.pathname.split("/")[1].slice(1));
  if (username && username.toLowerCase() !== urlAuthor.toLowerCase()) throw new Error("视频作者与链接不一致");
  const country = text(row.country) || text(row.region_code);
  const msDuration = count(media.duration);
  const capture = row.capturedAt === undefined ? capturedAt : date(row.capturedAt);
  if (!capture) throw new Error("采集时间需要有效 ISO 日期");
  return {
    id: rawId, url: parsed.toString(), author: username || urlAuthor,
    description: text(row.description) || text(row.desc),
    followers: count(row.followers ?? author.follower_count), views: count(row.views ?? statistics.play_count),
    publishedAt: date(row.publishedAt ?? row.create_time),
    country: country ? (country.toLowerCase() === "malaysia" ? "MY" : country.toUpperCase()) : null,
    ...(typeof row.searchRegion === "string" && countryOptions.some(option => option.code === row.searchRegion) ? { searchRegion: row.searchRegion } : {}),
    hasProductLink: productLink(row), category: text(row.category) || null,
    duration: count(row.duration) ?? (msDuration === null ? null : msDuration / 1000),
    transcript: text(row.transcript), capturedAt: capture, source: text(row.source) || source,
    evidence: Object.keys(record(row.evidence)).length ? record(row.evidence) : row
  };
}

export function evaluateVideo(video: TikTokVideo, filters: VideoFilters, now = new Date()) {
  const rejected: string[] = [];
  const missing: string[] = [];
  const ratio = video.views !== null && video.followers !== null && video.followers > 0 ? video.views / video.followers : null;
  if (video.searchRegion && video.searchRegion !== filters.region) rejected.push("搜索地区与当前选择不同");
  if (video.evidence.verificationPending === true) missing.push("来源资料待核实");
  if (video.followers === null) missing.push("缺少粉丝数");
  else if (video.followers > filters.maxFollowers) rejected.push("粉丝数超过上限");
  if (video.views === null) missing.push("缺少播放量");
  else if (video.views < filters.minViews) rejected.push("播放量未达下限");
  if (video.followers === 0) missing.push("粉丝为零，无法计算倍数");
  if (ratio !== null && (ratio < filters.minRatio || (filters.maxRatio !== null && ratio > filters.maxRatio))) rejected.push("播放/粉丝比不在范围内");
  const posted = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
  if (!Number.isFinite(posted)) missing.push("缺少有效发布时间");
  else if (posted > now.getTime()) missing.push("发布时间在未来，需核实");
  else if (now.getTime() - posted > filters.days * 86400000) rejected.push(`超过近 ${filters.days} 天`);
  if (filters.category.trim()) {
    if (!video.category) missing.push("类目待核实");
    else if (video.category.toLowerCase() !== filters.category.trim().toLowerCase()) rejected.push("类目不符合");
  }
  return { status: rejected.length ? "excluded" as const : missing.length ? "pending" as const : "matched" as const, reasons: [...rejected, ...missing], ratio };
}

export function mergeVideos(existing: TikTokVideo[], incoming: TikTokVideo[]) {
  const rows = new Map(existing.map((row) => [row.id, row]));
  for (const row of incoming) {
    const previous = rows.get(row.id);
    if (!previous || Date.parse(row.capturedAt) >= Date.parse(previous.capturedAt)) rows.set(row.id, row);
  }
  return [...rows.values()];
}

// 空 aweme_list 不能遮盖视频搜索实际返回的 search_item_list。
export function extractVideoRows(input: unknown): unknown[] {
  if (Array.isArray(input)) return input.map((value) => record(value).aweme_info ?? value);
  const row = record(input);
  if (row.aweme_id || row.id) return [input];
  for (const key of ["videos", "aweme_list", "search_item_list", "items", "data", "aweme_detail"]) {
    if (row[key] !== undefined) {
      const found = extractVideoRows(row[key]);
      if (found.length) return found;
    }
  }
  return [];
}

function parseCsv(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(cell.replace(/\r$/, "")); cell = "";
      if (char === "\n") { rows.push(row); row = []; }
    } else cell += char;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift()?.map((value) => value.trim()) ?? [];
  if (!headers.includes("id")) throw new Error("CSV 需要 id 列，请下载导入模板");
  return rows.filter((values) => values.some((value) => value.trim())).map((values) => {
    if (values.length !== headers.length) throw new Error("CSV 列数不一致");
    return Object.fromEntries(headers.map((key, index) => [key, values[index]]));
  });
}

export function importVideos(input: string, format: "json" | "csv", capturedAt = new Date().toISOString()) {
  if (input.length > 5_000_000) throw new Error("导入文件请控制在 5 MB 内");
  const parsed = format === "csv" ? parseCsv(input.replace(/^\uFEFF/, "")) : JSON.parse(input.replace(/^\uFEFF/, ""));
  const envelope = record(parsed);
  if (envelope.code !== undefined && envelope.code !== 200) throw new Error("原始数据的业务状态不是成功");
  const rows = extractVideoRows(parsed);
  if (!rows.length) throw new Error("未找到视频记录，请使用 JSON/CSV 模板");
  if (rows.length > 500) throw new Error("单次最多导入 500 条");
  let videos: TikTokVideo[] = [];
  const errors: string[] = [];
  let duplicates = 0;
  rows.forEach((row, index) => {
    try {
      const video = normalizeVideo(row, capturedAt);
      if (videos.some((existing) => existing.id === video.id)) duplicates++;
      videos = mergeVideos(videos, [video]);
    } catch (error) { errors.push(`第 ${index + 1} 条：${error instanceof Error ? error.message : "记录无效"}`); }
  });
  return { videos, errors, duplicates };
}
