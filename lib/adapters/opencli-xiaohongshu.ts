import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Topic } from "@/types/topic";

const execFileAsync = promisify(execFile);

type OpenCliSearchRow = {
  rank?: number;
  title?: string;
  author?: string;
  author_url?: string;
  likes?: string | number;
  like_count?: string | number;
  views?: string | number;
  view?: string | number;
  view_count?: string | number;
  comments?: string | number;
  comment_count?: string | number;
  saves?: string | number;
  collects?: string | number;
  collect_count?: string | number;
  published_at?: string;
  publish_time?: string;
  created_at?: string;
  date?: string;
  time?: string;
  url?: string;
  type?: string;
  cover?: string;
  cover_url?: string;
  image?: string;
  raw_text?: string;
};

type CollectOptions = {
  query?: string;
  limit?: number;
  mediaType?: "全部" | "图文" | "视频";
  dateRange?: "全部" | "一天内" | "一周内" | "半年内";
  sortBy?: "浏览量" | "点赞量" | "评论量" | "收藏量";
  noDuplicate?: boolean;
  existingUrls?: string[];
};

type LocalMedia = {
  type: "image" | "video";
  url: string;
  name?: string;
  posterUrl?: string;
};

type OpenCliFieldRow = {
  field?: string;
  value?: unknown;
};

const DEFAULT_QUERY = "小红书 爆款 图文";
const OPENCLI_PROFILE = process.env.OPENCLI_PROFILE || "";
const XHS_BROWSER_SESSION = process.env.OPENCLI_XHS_BROWSER_SESSION || "content-production-xhs";

function collectionTime() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getOpenCliBin() {
  return process.env.OPENCLI_BIN || "opencli.cmd";
}

function findOnPath(command: string) {
  if (path.isAbsolute(command) && fs.existsSync(command)) return command;
  const paths = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return paths.map((entry) => path.join(entry, command)).find((candidate) => fs.existsSync(candidate)) || command;
}

function resolveOpenCliInvocation(args: string[]) {
  const resolvedBin = findOnPath(getOpenCliBin());

  if (process.platform === "win32" && resolvedBin.toLowerCase().endsWith(".cmd")) {
    const dir = path.dirname(resolvedBin);
    const nodePath = fs.existsSync(path.join(dir, "node.exe")) ? path.join(dir, "node.exe") : process.execPath;
    const mainPath = path.join(dir, "node_modules", "@jackwener", "opencli", "dist", "src", "main.js");

    if (fs.existsSync(mainPath)) {
      return { file: nodePath, args: [mainPath, ...args], shell: false };
    }
  }

  return { file: resolvedBin, args, shell: process.platform === "win32" };
}

function withOpenCliProfile(args: string[]) {
  return OPENCLI_PROFILE ? ["--profile", OPENCLI_PROFILE, ...args] : args;
}

async function runOpenCliCommand(args: string[], timeout = 90_000) {
  const invocation = resolveOpenCliInvocation(withOpenCliProfile(args));
  const { stdout } = await execFileAsync(
    invocation.file,
    invocation.args,
    { timeout, windowsHide: true, shell: invocation.shell, maxBuffer: 1024 * 1024 * 50 }
  );
  return stdout;
}

async function runOpenCli(args: string[], timeout = 90_000) {
  const invocation = resolveOpenCliInvocation(withOpenCliProfile([...args, "-f", "json", "--site-session", "persistent", "--window", "background", "--keep-tab", "false"]));
  const { stdout } = await execFileAsync(
    invocation.file,
    invocation.args,
    { timeout, windowsHide: true, shell: invocation.shell, maxBuffer: 1024 * 1024 * 50 }
  );
  return stdout;
}

async function runBrowserEval<T>(session: string, script: string, timeout = 120_000): Promise<T> {
  const stdout = await runOpenCliCommand(["browser", session, "eval", script, "--window", "background"], timeout);
  return JSON.parse(stdout) as T;
}

async function closeXhsBrowserSafely(session = XHS_BROWSER_SESSION) {
  try {
    await runOpenCliCommand(["browser", session, "close"], 20_000);
  } catch {
    // Browser cleanup should never make collection fail.
  }
}

async function parkXhsBrowserSafely(session = XHS_BROWSER_SESSION) {
  try {
    await runOpenCliCommand(["browser", session, "open", "http://127.0.0.1:3001/topics", "--window", "background"], 20_000);
  } catch {
    // Parking the browser is only for a cleaner UI; collection has already finished.
  }
}

function createCollectBrowserSession() {
  return `${XHS_BROWSER_SESSION}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function repairMojibake(value: string) {
  if (/[\u4e00-\u9fa5]/.test(value)) return value;
  if (!/[\u0080-\u00ff]/.test(value)) return value;
  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    return /[\u4e00-\u9fa5]/.test(repaired) ? repaired : value;
  } catch {
    return value;
  }
}

function stringifyField(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return repairMojibake(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return repairMojibake(JSON.stringify(value));
}

function parseFieldRows(output: string): OpenCliFieldRow[] {
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed as OpenCliFieldRow[];
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["data", "rows", "results", "items"]) {
        if (Array.isArray(record[key])) return record[key] as OpenCliFieldRow[];
      }
    }
  } catch {
    // Some OpenCLI adapters emit YAML-like rows even when JSON is requested.
  }

  const rows: OpenCliFieldRow[] = [];
  let current: OpenCliFieldRow | null = null;
  for (const line of output.split(/\r?\n/)) {
    const fieldMatch = line.match(/^\s*-\s*field:\s*(.+)\s*$/);
    const valueMatch = line.match(/^\s*value:\s*(.*)\s*$/);
    if (fieldMatch) {
      if (current) rows.push(current);
      current = { field: fieldMatch[1].trim().replace(/^['"]|['"]$/g, "") };
    } else if (valueMatch && current) {
      current.value = valueMatch[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  if (current) rows.push(current);
  return rows;
}

function fieldsFromOutput(output: string) {
  return Object.fromEntries(parseFieldRows(output).map((row) => [String(row.field ?? ""), stringifyField(row.value)]));
}

function pickField(fields: Record<string, string>, keys: string[], fallback = "-") {
  for (const key of keys) {
    const value = fields[key];
    if (value && value !== "undefined" && value !== "null") return value;
  }
  const lowerEntries = Object.entries(fields).map(([key, value]) => [key.toLowerCase(), value] as const);
  for (const key of keys) {
    const found = lowerEntries.find(([field]) => field === key.toLowerCase());
    if (found?.[1] && found[1] !== "undefined" && found[1] !== "null") return found[1];
  }
  return fallback;
}

function pickRows(parsed: unknown): OpenCliSearchRow[] {
  if (Array.isArray(parsed)) return parsed as OpenCliSearchRow[];
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of ["data", "rows", "results", "items"]) {
      if (Array.isArray(record[key])) return record[key] as OpenCliSearchRow[];
    }
  }
  return [];
}

function estimatePriority(likes: string | number | undefined): Topic["priority"] {
  const text = String(likes ?? "");
  if (text.includes("w") || text.includes("万")) return "P0";
  const numeric = Number(text.replace(/[^\d.]/g, ""));
  if (numeric >= 5000) return "P0";
  if (numeric >= 1000) return "P1";
  return "P2";
}

function mediaKindFromUrl(url?: string): "image" | "video" | undefined {
  if (!url) return undefined;
  const cleanUrl = url.split("?")[0].split("#")[0];
  if (/\.(?:mp4|mov|webm|m4v)$/i.test(cleanUrl)) return "video";
  if (/\.(?:jpg|jpeg|png|webp|gif)$/i.test(cleanUrl)) return "image";
  return undefined;
}

function topicMediaTypeFromLocalMedia(media: LocalMedia[], fallback?: Topic["mediaType"]): Topic["mediaType"] {
  if (media.some((item) => item.type === "video")) return "视频";
  if (media.some((item) => item.type === "image")) return "图文";
  return fallback ?? "图文";
}

function inferSearchMediaType(row: OpenCliSearchRow): Topic["mediaType"] {
  const coverType = mediaKindFromUrl(row.cover_url ?? row.cover ?? row.image);
  if (coverType === "video") return "视频";
  return /视频|vlog|口播|测评|video|短视频|播放/i.test(`${row.title ?? ""} ${row.type ?? ""}`) ? "视频" : "图文";
}

function firstValue(...values: Array<string | number | undefined>) {
  const found = values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
  return found === undefined ? "-" : String(found);
}

function metricValue(value: string | number | undefined) {
  const text = String(value ?? "").toLowerCase();
  const numeric = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  if (text.includes("万") || text.includes("w")) return numeric * 10000;
  if (text.includes("k")) return numeric * 1000;
  return numeric;
}

function usableDetailMetric(value?: string) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^20\d{2}$/.test(text) || /^\d{8,}$/.test(text)) return "";
  return text;
}

function normalizeDateText(value?: string) {
  if (!value) return "";
  const text = repairMojibake(value);
  const absolute = text.match(/20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}/);
  if (absolute) {
    const [year, month, day] = absolute[0].replace(/[年月/.]/g, "-").replace(/日/g, "").split("-");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const monthDay = text.match(/(\d{1,2})[-/月.](\d{1,2})/);
  if (monthDay) {
    const year = new Date().getFullYear();
    return `${year}-${monthDay[1].padStart(2, "0")}-${monthDay[2].padStart(2, "0")}`;
  }
  const daysAgo = text.match(/(\d+)\s*天前/);
  if (daysAgo) return dateBefore(Number(daysAgo[1]) + 1);
  if (/昨天/.test(text)) return dateBefore(2);
  if (/今天|刚刚|小时前|分钟前/.test(text)) return collectionTime().slice(0, 10);
  return "";
}

function dateBefore(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

function mergeTopicMedia(topicMedia: LocalMedia[] = [], detailMedia: LocalMedia[] = []) {
  const seen = new Set<string>();
  const merged: LocalMedia[] = [];
  for (const media of [...topicMedia, ...detailMedia]) {
    if (!media.url || seen.has(media.url)) continue;
    seen.add(media.url);
    merged.push(media);
  }
  const firstImage = merged.find((item) => item.type === "image")?.url;
  return merged
    .map((item) => item.type === "video" && firstImage ? { ...item, posterUrl: item.posterUrl || firstImage } : item)
    .sort((a, b) => {
      if (a.type === b.type) return 0;
      return a.type === "image" ? -1 : 1;
    });
}

function dateRangeDays(range?: CollectOptions["dateRange"]) {
  if (range === "一天内") return 1;
  if (range === "一周内") return 7;
  if (range === "半年内") return 183;
  return 0;
}

function xhsDateFilterLabel(range?: CollectOptions["dateRange"]) {
  if (range === "一天内") return "一天内";
  if (range === "一周内") return "一周内";
  if (range === "半年内") return "半年内";
  return "不限";
}

function xhsSortFilterLabel(sortBy?: CollectOptions["sortBy"]) {
  if (sortBy === "点赞量") return "最多点赞";
  if (sortBy === "评论量") return "最多评论";
  if (sortBy === "收藏量") return "最多收藏";
  return "综合";
}

function xhsMediaFilterLabel(mediaType?: CollectOptions["mediaType"]) {
  if (mediaType === "图文") return "图文";
  if (mediaType === "视频") return "视频";
  return "不限";
}

function isWithinDateRange(topic: Topic, range?: CollectOptions["dateRange"]) {
  const days = dateRangeDays(range);
  if (!days) return true;
  const date = normalizeDateText(topic.fetchedAt);
  if (!date) return false;
  return date >= dateBefore(days);
}

function matchesRequestedMediaType(topic: Topic, mediaType: CollectOptions["mediaType"]) {
  if (!mediaType || mediaType === "全部") return true;
  return topic.mediaType === mediaType;
}

function sortTopicsBy(topics: Topic[], sortBy?: CollectOptions["sortBy"]) {
  if (!sortBy) return topics;
  const field = sortBy === "浏览量" ? "views" : sortBy === "点赞量" ? "likes" : sortBy === "评论量" ? "comments" : "saves";
  return [...topics].sort((a, b) => metricValue((b as Topic & { views?: string })[field]) - metricValue((a as Topic & { views?: string })[field]));
}

function extractXiaohongshuNoteId(url?: string) {
  if (!url) return "";
  return url.match(/(?:explore|discovery\/item|search_result)\/([0-9a-fA-F]+)/)?.[1]
    || url.match(/\/([0-9a-fA-F]{16,32})(?:[?#]|$)/)?.[1]
    || "";
}

function normalizeXiaohongshuUrl(url?: string) {
  if (!url) return undefined;
  const noteId = extractXiaohongshuNoteId(url);
  if (!noteId) return url;
  try {
    const parsed = new URL(url);
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

function topicUniqueKey(topic: Pick<Topic, "url" | "title">) {
  return normalizeXiaohongshuUrl(topic.url) ?? topic.title;
}

function uniqueTopics(topics: Topic[], existingUrls: string[] = []) {
  const seen = new Set(existingUrls.map((url) => normalizeXiaohongshuUrl(url) ?? url).filter(Boolean));
  const nextTopics: Topic[] = [];
  for (const topic of topics) {
    const key = topicUniqueKey(topic);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    nextTopics.push(topic);
  }
  return nextTopics;
}

function mediaFromFolder(folder: string): LocalMedia[] {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder)
    .filter((name) => /\.(?:jpg|jpeg|png|webp|gif|mp4|mov)$/i.test(name))
    .filter((name) => !/_cover\.png$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => {
      const type = /\.(?:mp4|mov)$/i.test(name) ? "video" as const : "image" as const;
      const relativePath = path.relative(process.cwd(), path.join(folder, name)).replace(/\\/g, "/");
      return { type, url: `/api/reference/media?path=${encodeURIComponent(relativePath)}`, name };
    });
}

function downloadedMediaForUrl(url?: string): LocalMedia[] {
  const noteId = extractXiaohongshuNoteId(url);
  if (!noteId) return [];
  return mediaFromFolder(path.join(process.cwd(), "xiaohongshu-downloads", noteId));
}

function mediaExtFromContentType(contentType: string, fallbackUrl: string) {
  if (/png/i.test(contentType)) return ".png";
  if (/webp/i.test(contentType)) return ".webp";
  if (/gif/i.test(contentType)) return ".gif";
  if (/mp4/i.test(contentType)) return ".mp4";
  if (/quicktime|mov/i.test(contentType)) return ".mov";
  const cleanUrl = fallbackUrl.split("?")[0].split("#")[0];
  const ext = path.extname(cleanUrl).toLowerCase();
  if (/^\.(jpg|jpeg|png|webp|gif|mp4|mov)$/.test(ext)) return ext;
  return ".jpg";
}

async function saveRemoteMediaForUrl(noteUrl: string, media: LocalMedia[]) {
  const noteId = extractXiaohongshuNoteId(noteUrl);
  if (!noteId) return [];
  const folder = path.join(process.cwd(), "xiaohongshu-downloads", noteId);
  fs.mkdirSync(folder, { recursive: true });

  let savedIndex = fs.existsSync(folder) ? fs.readdirSync(folder).length : 0;
  for (const item of media) {
    if (!/^https?:\/\//i.test(item.url)) continue;
    if (/blob:|avatar|profile|icon|emoji|comment|platform/i.test(item.url)) continue;
    try {
      const response = await fetch(item.url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Referer": "https://www.xiaohongshu.com/"
        }
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      if (!/^image\//i.test(contentType) && !/^video\//i.test(contentType)) continue;
      savedIndex += 1;
      const ext = mediaExtFromContentType(contentType, item.url);
      const filePath = path.join(folder, `${noteId}_${savedIndex}${ext}`);
      if (fs.existsSync(filePath)) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1024) continue;
      fs.writeFileSync(filePath, bytes);
    } catch {
      // A failed media fetch should not discard the whole topic.
    }
  }

  return mediaFromFolder(folder);
}

async function ensureLocalXiaohongshuMedia(url?: string, candidateMedia: LocalMedia[] = []): Promise<LocalMedia[]> {
  if (!url) return [];
  const cached = downloadedMediaForUrl(url);
  if (cached.length) return cached;
  return saveRemoteMediaForUrl(url, candidateMedia);
}

function clearDownloadedMediaForUrl(url?: string) {
  const noteId = extractXiaohongshuNoteId(url);
  if (!noteId) return;
  const root = path.resolve(process.cwd(), "xiaohongshu-downloads");
  const folder = path.resolve(root, noteId);
  if (!folder.startsWith(root) || !fs.existsSync(folder)) return;
  fs.rmSync(folder, { recursive: true, force: true });
}

function pickMetricFromOutput(output: string, names: string[], fallback?: string) {
  const compact = repairMojibake(output).replace(/\s+/g, " ");
  for (const name of names) {
    const match = compact.match(new RegExp(`${name}\\s*[:：]?\\s*([\\d,.]+\\s*(?:万|w|W|k|K|\\+)?)`, "i"));
    if (match?.[1]) return match[1].trim();
  }
  return fallback ?? "-";
}

function walkJson(value: unknown, visit: (key: string, value: unknown) => void, key = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, visit, String(index)));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      visit(childKey, childValue);
      walkJson(childValue, visit, childKey);
    }
  } else {
    visit(key, value);
  }
}

function pickDeepStringFromOutput(output: string, keys: string[], fallback = "") {
  try {
    const parsed = JSON.parse(output);
    const loweredKeys = keys.map((key) => key.toLowerCase());
    let found = "";
    walkJson(parsed, (key, value) => {
      if (found || typeof value !== "string") return;
      if (loweredKeys.includes(key.toLowerCase()) && value.trim()) found = repairMojibake(value.trim());
    });
    if (found) return found;
  } catch {
    // Fall back to regex text extraction below.
  }

  const text = repairMojibake(output);
  for (const key of keys) {
    const match = text.match(new RegExp(`${key}\\s*[:：]\\s*["']?([^"'\n\r]{8,2000})`, "i"));
    if (match?.[1]) return match[1].trim();
  }
  return fallback;
}

function mediaFromDetailOutput(output: string): LocalMedia[] {
  const urls = new Set<string>();
  const addUrl = (value: string) => {
    const clean = repairMojibake(value).replace(/\\u002F/g, "/").replace(/\\\//g, "/");
    if (!/^https?:\/\//i.test(clean)) return;
    if (!/\.(?:jpg|jpeg|png|webp|gif|mp4|mov|m4v|webm)(?:[?#]|$)/i.test(clean)) return;
    if (/avatar|profile|icon|emoji|comment/i.test(clean)) return;
    urls.add(clean);
  };

  try {
    walkJson(JSON.parse(output), (_key, value) => {
      if (typeof value === "string") addUrl(value);
    });
  } catch {
    // Fall back to regex URL extraction below.
  }

  const text = repairMojibake(output).replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) addUrl(match[0]);

  return Array.from(urls).slice(0, 12).map((url, index) => ({
    type: /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(url) ? "video" as const : "image" as const,
    url,
    name: `详情素材 ${index + 1}`
  }));
}

function comparableChunks(value: string) {
  const normalized = repairMojibake(value)
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, " ")
    .trim();
  return Array.from(new Set(normalized.match(/[\p{Script=Han}a-z0-9]{2,}/gu) ?? []))
    .filter((item) => !["小红书", "图文", "视频", "原创"].includes(item));
}

function isLikelySameTitle(expectedTitle: string, actualTitle: string) {
  const expected = comparableChunks(expectedTitle);
  const actual = comparableChunks(actualTitle).join(" ");
  if (!expected.length || !actual) return true;
  if (actual.includes(expected.join("")) || expected.join("").includes(actual.replace(/\s/g, ""))) return true;
  const hits = expected.filter((item) => actual.includes(item)).length;
  if (expected.length <= 2) return hits === expected.length;
  return hits / expected.length >= 0.5;
}

export async function openXiaohongshuInSharedBrowser(url: string) {
  await runOpenCliCommand(["browser", XHS_BROWSER_SESSION, "open", url, "--window", "foreground"], 60_000);
  return { ok: true, message: "已在 OpenCLI 共用浏览器中打开小红书作品。" };
}

async function enrichTopicsSafely(topics: Topic[], session: string) {
  const enriched: Topic[] = [];
  for (const topic of topics) {
    enriched.push(await enrichTopicCover(topic, session).catch(() => topic));
  }
  return enriched;
}

function browserDetailScript(expectedTitle: string) {
  return `
(async () => {
  const expectedTitle = ${JSON.stringify(expectedTitle)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  for (let i = 0; i < 20; i += 1) {
    const text = clean(document.body.innerText || "");
    if (text.includes(expectedTitle.slice(0, Math.min(8, expectedTitle.length))) || document.querySelector("img")) break;
    await sleep(500);
  }
  const bodyText = clean(document.body.innerText || "");
  const title = clean((document.querySelector(".title, [class*=title]") || {}).innerText) || expectedTitle;
  const author = clean((document.querySelector(".author, .username, [class*=author], [class*=user]") || {}).innerText);
  const imgs = Array.from(document.querySelectorAll("img"))
    .map((img) => img.currentSrc || img.src || "")
    .filter((src) => /^https?:\\/\\//.test(src))
    .filter((src) => !/avatar|profile|icon|emoji|comment|platform/i.test(src))
    .filter((src, index, arr) => arr.indexOf(src) === index)
    .slice(0, 10);
  const video = document.querySelector("video");
  const videoSrc = video?.currentSrc || video?.src || "";
  const metaText = bodyText.match(/(?:编辑于|发布于)\\s*(20\\d{2}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}-\\d{1,2}|今天|昨天|\\d+\\s*(?:小时前|分钟前|天前))/)?.[1] || "";
  const dateMatch = metaText ? [metaText] : null;
  const afterTitle = title && bodyText.includes(title) ? bodyText.slice(bodyText.indexOf(title) + title.length) : bodyText;
  const beforeDate = dateMatch && afterTitle.includes(dateMatch[0]) ? afterTitle.slice(0, afterTitle.indexOf(dateMatch[0])) : afterTitle;
  const stopIndexes = [
    beforeDate.search(/编辑于|发布于/),
    beforeDate.search(/共\\s*[\\d.]+\\s*(?:万|w|W|k|K|\\+)?\\s*条评论/),
    beforeDate.search(/猜你喜欢/),
    beforeDate.search(/评论\\s+[\\d.]+\\s*(?:万|w|W|k|K|\\+)?\\s+[\\d.]+/)
  ].filter((index) => index > 0);
  const contentScope = stopIndexes.length ? beforeDate.slice(0, Math.min(...stopIndexes)) : beforeDate;
  const content = clean(contentScope
    .replace(/^\\s*(关注|已关注)\\s*/, "")
    .replace(/^.*?(?=#|\\d{1,2}-\\d{1,2}|20\\d{2})/, (match) => match.length > 120 ? "" : match)
  ).slice(0, 1800);
  const metricNearEnd = bodyText.slice(Math.max(0, bodyText.length - 600));
  const actionMetrics = metricNearEnd.match(/评论\\s+([\\d.]+\\s*(?:万|w|W|k|K|\\+)?)\\s+([\\d.]+\\s*(?:万|w|W|k|K|\\+)?)\\s+([\\d.]+\\s*(?:万|w|W|k|K|\\+)?)/);
  const numbers = Array.from(metricNearEnd.matchAll(/(点赞|赞|收藏|评论)\\s*([\\d.]+\\s*(?:万|w|W|k|K|\\+)?)/g))
    .reduce((acc, match) => ({ ...acc, [match[1]]: match[2] }), {});
  const actionLineMetrics = Array.from(document.querySelectorAll("span, button, div"))
    .filter(visible)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return { text: clean(el.innerText || el.textContent), x: rect.left, y: rect.top, area: rect.width * rect.height };
    })
    .filter((item) => item.x > window.innerWidth * 0.45 && item.y > window.innerHeight * 0.65)
    .filter((item) => /^[\\d.]+\\s*(?:万|w|W|k|K|\\+)?$/.test(item.text))
    .filter((item) => item.area < 5000)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => item.text);
  const looseMetrics = Array.from(metricNearEnd.matchAll(/([\\d.]+\\s*(?:万|w|W|k|K|\\+)?)/g))
    .map((match) => match[1])
    .filter((value) => !/^20\\d{2}$/.test(value) && !/^\\d{8,}$/.test(value));
  return {
    title,
    author,
    content,
    published_at: dateMatch?.[0] || "",
    likes: actionLineMetrics[0] || actionMetrics?.[1] || numbers["点赞"] || numbers["赞"] || looseMetrics[0] || "",
    saves: actionLineMetrics[1] || actionMetrics?.[2] || numbers["收藏"] || looseMetrics[1] || "",
    comments: actionLineMetrics[2] || actionMetrics?.[3] || numbers["评论"] || looseMetrics[2] || "",
    media: [
      ...imgs.map((url, index) => ({ type: "image", url, name: "详情图片 " + (index + 1) })),
      ...(videoSrc ? [{ type: "video", url: videoSrc, name: "详情视频", posterUrl: imgs[0] }] : [])
    ],
    bodyText: bodyText.slice(0, 400)
  };
})()
`;
}

type BrowserDetailResult = {
  title?: string;
  author?: string;
  content?: string;
  published_at?: string;
  likes?: string;
  saves?: string;
  comments?: string;
  media?: LocalMedia[];
};

async function enrichTopicCover(topic: Topic, session: string): Promise<Topic> {
  if (!topic.url) return topic;
  let nextTopic = topic;
  const existingCoverUrl = topic.coverUrl;
  let detailMedia: LocalMedia[] = topic.media ?? [];
  try {
    await runOpenCliCommand(["browser", session, "open", topic.url, "--window", "background"], 60_000);
    const detail = await runBrowserEval<BrowserDetailResult>(session, browserDetailScript(topic.title), 90_000);
    if (!detail.title || isLikelySameTitle(topic.title, detail.title)) {
      const publishedAt = normalizeDateText(detail.published_at);
      detailMedia = detail.media?.length ? detail.media : detailMedia;
      const detailLikes = usableDetailMetric(detail.likes);
      const detailSaves = usableDetailMetric(detail.saves);
      const detailComments = usableDetailMetric(detail.comments);
      const hasRepeatedDetailMetrics = Boolean(detailLikes && detailLikes === detailSaves && detailLikes === detailComments);
      nextTopic = {
        ...nextTopic,
        likes: nextTopic.likes && nextTopic.likes !== "-" ? nextTopic.likes : detailLikes || nextTopic.likes,
        comments: hasRepeatedDetailMetrics ? nextTopic.comments : detailComments || nextTopic.comments,
        saves: hasRepeatedDetailMetrics ? nextTopic.saves : detailSaves || nextTopic.saves,
        fetchedAt: nextTopic.fetchedAt && nextTopic.fetchedAt !== "发布时间待确认" ? nextTopic.fetchedAt : publishedAt || nextTopic.fetchedAt,
        parsedContent: detail.content || nextTopic.parsedContent,
        sourceAccount: detail.author && !/^我$|首页|通知|发布/.test(detail.author) ? `OpenCLI · ${detail.author}` : nextTopic.sourceAccount
      };
    }
  } catch {
    // Search result remains usable if detail fields are unavailable.
  }

  const candidateMedia = mergeTopicMedia(topic.media, detailMedia);
  const localMedia = await ensureLocalXiaohongshuMedia(topic.url, candidateMedia).catch(() => []);
  if (localMedia.length) detailMedia = localMedia;

  const allMedia = localMedia.length ? localMedia : candidateMedia;
  const cover = allMedia[0];
  if (cover) {
    const mediaType = topicMediaTypeFromLocalMedia(allMedia, nextTopic.mediaType);
    return {
      ...nextTopic,
      coverUrl: cover.url,
      coverType: cover.type,
      media: allMedia,
      mediaType,
      contentType: mediaType === "视频" ? "小红书视频" : "小红书图文"
    };
  }

  const existingCoverType = mediaKindFromUrl(existingCoverUrl);
  if (existingCoverUrl) {
    return {
      ...nextTopic,
      coverUrl: existingCoverUrl,
      coverType: existingCoverType,
      media: nextTopic.media,
      mediaType: existingCoverType === "video" ? "视频" : nextTopic.mediaType
    };
  }

  return {
    ...nextTopic,
    coverUrl: existingCoverUrl,
    coverType: existingCoverType,
    media: nextTopic.media,
    mediaType: existingCoverType === "video" ? "视频" : nextTopic.mediaType
  };
}

function normalizeRows(rows: OpenCliSearchRow[], query: string): Topic[] {
  return rows
    .filter((row) => row.title)
    .map((row, index) => {
      const coverUrl = row.cover_url ?? row.cover ?? row.image;
      const mediaType = inferSearchMediaType(row);
      const coverType = mediaKindFromUrl(coverUrl);
      const publishedAt = normalizeDateText(firstValue(row.published_at, row.publish_time, row.created_at, row.date, row.time));
      return {
        id: `opencli_xhs_live_${Date.now()}_${index + 1}`,
        platform: "小红书",
        title: row.title ?? `${query} 参考选题`,
        contentType: mediaType === "视频" ? "小红书视频" : "小红书图文",
        likes: firstValue(row.likes, row.like_count),
        views: firstValue(row.views, row.view, row.view_count),
        comments: firstValue(row.comments, row.comment_count),
        saves: firstValue(row.saves, row.collects, row.collect_count),
        risk: "低",
        priority: estimatePriority(row.likes),
        status: "pending",
        sourceAccount: row.author ? `OpenCLI · ${row.author}` : "OpenCLI 小红书公开搜索",
        fetchedAt: publishedAt || "发布时间待确认",
        url: normalizeXiaohongshuUrl(row.url),
        authorUrl: row.author_url,
        coverUrl,
        coverType,
        media: coverUrl ? [{ type: coverType === "video" ? "video" : "image", url: coverUrl, name: "搜索封面" }] : [],
        mediaType,
        keyword: query,
        parsedContent: `OpenCLI 搜索关键词「${query}」采集到的公开作品，标题为「${row.title ?? ""}」。`
      } satisfies Topic;
    });
}

export async function collectXiaohongshuHotTopics(options: CollectOptions = {}) {
  const query = options.query?.trim() || DEFAULT_QUERY;
  const requestedLimit = Math.max(1, Number(options.limit ?? 12));
  const requestedMediaType = options.mediaType ?? "全部";
  const collectSession = createCollectBrowserSession();

  try {
    let rows: OpenCliSearchRow[] = [];
    let appliedFilterMessage = `小红书页面筛选：类型「${xhsMediaFilterLabel(options.mediaType)}」，发布时间「${xhsDateFilterLabel(options.dateRange)}」，排序「${xhsSortFilterLabel(options.sortBy)}」`;
    const browserResult = await searchXiaohongshuWithPageFilters(query, options, requestedLimit, collectSession);
    rows = browserResult.rows ?? [];
    appliedFilterMessage = `小红书页面筛选：类型「${browserResult.applied.mediaType}」，发布时间「${browserResult.applied.dateRange}」，排序「${browserResult.applied.sortBy}」`;
    const rawTopics = normalizeRows(rows, query);
    const normalizedTopics = (options.noDuplicate === false ? rawTopics : uniqueTopics(rawTopics, options.existingUrls));
    const locallyFilteredTopics = normalizedTopics
      .filter((topic) => matchesRequestedMediaType(topic, requestedMediaType))
      .filter((topic) => isWithinDateRange(topic, options.dateRange));
    const enrichmentBuffer = requestedLimit <= 3
      ? requestedLimit + 2
      : requestedLimit <= 5
        ? requestedLimit + 4
        : Math.max(requestedLimit + 6, Math.ceil(requestedLimit * 1.8));
    const enrichmentCandidateLimit = Math.min(locallyFilteredTopics.length, Math.min(30, enrichmentBuffer));
    const candidates = sortTopicsBy(locallyFilteredTopics, options.sortBy).slice(0, enrichmentCandidateLimit);
    const enrichedTopics = await enrichTopicsSafely(candidates, collectSession);
    const filteredTopics = enrichedTopics
      .filter((topic) => matchesRequestedMediaType(topic, requestedMediaType))
      .filter((topic) => isWithinDateRange(topic, options.dateRange));
    const topics = sortTopicsBy(filteredTopics, options.sortBy).slice(0, requestedLimit);

    if (rawTopics.length > 0 && topics.length === 0) {
      return {
        ok: true,
        mode: "opencli",
        message: options.dateRange && options.dateRange !== "全部"
          ? `这次没有新增内容：小红书当前筛选「${options.dateRange}」里没有可入库的新笔记，或都已经重复。`
          : "这次没有新增内容：抓到的笔记都已经在列表里，已自动跳过重复。",
        topics: []
      };
    }

    if (topics.length === 0) {
      return {
        ok: true,
        mode: "opencli",
        message: `这次没有抓到符合「${options.dateRange ?? "全部"} / ${requestedMediaType} / ${options.sortBy ?? "默认"}」的新笔记。可以放宽时间或切到“全部”再试。`,
        topics: []
      };
    }

    return {
      ok: true,
      mode: "opencli",
      message: `${appliedFilterMessage}；已跳过重复内容，只入库 ${topics.length}/${requestedLimit} 条。`,
      topics
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenCLI 调用失败";
    return {
      ok: false,
      mode: "opencli",
      message: `这次抓取没有完成：${message.includes("Detached") ? "采集浏览器连接断开，请再点一次抓取。" : message}。`,
      topics: []
    };
  } finally {
    await closeXhsBrowserSafely(collectSession);
  }
}

type BrowserSearchResult = {
  ok: boolean;
  rows: OpenCliSearchRow[];
  applied: {
    mediaType: string;
    dateRange: string;
    sortBy: string;
    scanLimit: number;
  };
  message?: string;
};

function browserSearchScript(options: {
  query: string;
  scanLimit: number;
  maxScrolls: number;
  mediaType: string;
  xhsMediaLabel: string;
  xhsDateLabel: string;
  xhsSortLabel: string;
  existingKeys: string[];
}) {
  return `
(async () => {
  const options = ${JSON.stringify(options)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const noteKey = (value) => {
    const text = String(value || "");
    const match = text.match(/(?:explore|discovery\\/item|search_result)\\/([0-9a-fA-F]+)/) || text.match(/\\/([0-9a-fA-F]{16,32})(?:[?#]|$)/);
    return match?.[1] || text;
  };
  const existing = new Set((options.existingKeys || []).map(noteKey).filter(Boolean));
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const clickEl = async (el) => {
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "center" });
    await sleep(120);
    const rect = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(type, init));
    await sleep(650);
    return true;
  };
  const exactText = (text, root = document) => Array.from(root.querySelectorAll("button, div, span, a"))
    .filter(visible)
    .find((el) => clean(el.innerText || el.textContent) === text);
  const openFilterPanel = async () => {
    let panel = document.querySelector(".filter-panel");
    if (panel && visible(panel)) return panel;
    const filterButton = Array.from(document.querySelectorAll(".filter, button, div"))
      .filter(visible)
      .find((el) => clean(el.innerText || el.textContent).startsWith("筛选"));
    await clickEl(filterButton);
    for (let i = 0; i < 10; i += 1) {
      panel = document.querySelector(".filter-panel");
      if (panel && visible(panel)) return panel;
      await sleep(200);
    }
    return document.querySelector(".filter-panel") || document.querySelector(".filter");
  };
  const filterGroup = (groupName, panel) => Array.from((panel || document).querySelectorAll(".filters"))
    .find((group) => clean(group.querySelector("span")?.innerText || group.querySelector("span")?.textContent) === groupName
      || clean(group.innerText || group.textContent).startsWith(groupName));
  const clickFilterTag = async (groupName, tagText) => {
    const panel = await openFilterPanel();
    const group = filterGroup(groupName, panel);
    const tag = Array.from((group || panel || document).querySelectorAll(".tags, button, div, span"))
      .filter(visible)
      .find((el) => clean(el.innerText || el.textContent) === tagText);
    const target = tag?.closest(".tags") || tag;
    await clickEl(target);
    await sleep(900);
    return Boolean(target);
  };
  const waitForCards = async () => {
    for (let i = 0; i < 24; i += 1) {
      if (document.querySelectorAll("section.note-item, .note-item").length) return true;
      await sleep(500);
    }
    return false;
  };
  await waitForCards();
  if (options.mediaType === "图文" || options.mediaType === "视频") {
    const channel = Array.from(document.querySelectorAll(".search-layout__top .channel, .channel"))
      .filter(visible)
      .find((el) => clean(el.innerText || el.textContent) === options.mediaType);
    await clickEl(channel);
  }
  await openFilterPanel();
  if (options.xhsDateLabel && options.xhsDateLabel !== "不限") await clickFilterTag("发布时间", options.xhsDateLabel);
  if (options.xhsSortLabel) await clickFilterTag("排序依据", options.xhsSortLabel);
  if (options.xhsMediaLabel && options.xhsMediaLabel !== "不限") await clickFilterTag("笔记类型", options.xhsMediaLabel);
  await sleep(1600);

  const parseCard = (card, index) => {
    const links = Array.from(card.querySelectorAll("a")).map((link) => {
      const href = link.getAttribute("href") || "";
      try { return new URL(href, location.origin).toString(); } catch { return href; }
    });
    const url = links.find((href) => href.includes("/search_result/") && href.includes("xsec_token"))
      || links.find((href) => href.includes("/search_result/"))
      || links.find((href) => href.includes("/explore/"))
      || links[0]
      || "";
    const img = Array.from(card.querySelectorAll("img")).find((node) => {
      const src = node.currentSrc || node.src || "";
      return src && !/avatar|icon|emoji|profile/i.test(src);
    });
    const titleEl = card.querySelector(".title, a.title, [class*=title]");
    const rawText = clean(card.innerText || card.textContent);
    const title = clean(titleEl?.innerText || titleEl?.textContent) || rawText.replace(/\\s*(20\\d{2}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}-\\d{1,2}|今天|昨天).*$/, "").slice(0, 80);
    const metaText = rawText.replace(title, "");
    const dateMatch = metaText.match(/20\\d{2}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}-\\d{1,2}|今天|昨天|\\d+\\s*(?:小时前|分钟前|天前)/);
    const metricMatch = rawText.match(/([\\d.]+\\s*(?:万|w|W|k|K|\\+)?)(?!.*[\\d.]+\\s*(?:万|w|W|k|K|\\+)?)/);
    const authorText = rawText.replace(title, "").replace(dateMatch?.[0] || "", "").replace(metricMatch?.[1] || "", "").trim();
    const video = Boolean(card.querySelector("video, [class*=play], [class*=video]")) || /视频/.test(rawText);
    return {
      rank: index + 1,
      title,
      author: authorText.slice(0, 60),
      likes: metricMatch?.[1] || "-",
      comments: "-",
      saves: "-",
      published_at: dateMatch?.[0] || "",
      url,
      type: video ? "视频" : "图文",
      cover_url: img?.currentSrc || img?.src || "",
      raw_text: rawText
    };
  };
  const seen = new Set();
  let rows = [];
  for (let i = 0; i < options.maxScrolls; i += 1) {
    const cards = Array.from(document.querySelectorAll("section.note-item, .note-item"));
    for (const card of cards) {
      const row = parseCard(card, rows.length);
      const key = row.url || row.title;
      const uniqueKey = noteKey(key);
      if (!row.title || !key || seen.has(uniqueKey) || existing.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      rows.push(row);
      if (rows.length >= options.scanLimit) break;
    }
    if (rows.length >= options.scanLimit) break;
    window.scrollBy({ top: Math.round(window.innerHeight * 0.9), behavior: "instant" });
    await sleep(900);
  }
  return {
    ok: true,
    rows: rows.slice(0, options.scanLimit),
    applied: {
      mediaType: options.xhsMediaLabel,
      dateRange: options.xhsDateLabel,
      sortBy: options.xhsSortLabel,
      scanLimit: options.scanLimit
    }
  };
})()
`;
}

async function searchXiaohongshuWithPageFilters(query: string, options: CollectOptions, requestedLimit: number, session: string) {
  const scanLimit = requestedLimit;
  const maxScrolls = requestedLimit <= 3 ? 5 : requestedLimit <= 5 ? 6 : 8;
  const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`;
  await runOpenCliCommand(["browser", session, "open", url, "--window", "background"], 60_000);
  return runBrowserEval<BrowserSearchResult>(session, browserSearchScript({
    query,
    scanLimit,
    maxScrolls,
    mediaType: options.mediaType ?? "全部",
    xhsMediaLabel: xhsMediaFilterLabel(options.mediaType),
    xhsDateLabel: xhsDateFilterLabel(options.dateRange),
    xhsSortLabel: xhsSortFilterLabel(options.sortBy),
    existingKeys: options.noDuplicate === false
      ? []
      : (options.existingUrls ?? []).map((url) => normalizeXiaohongshuUrl(url) ?? url).filter(Boolean)
  }), 150_000);
}
