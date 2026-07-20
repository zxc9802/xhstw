import { referenceSources } from "@/lib/mock/data";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type OpenCliFieldRow = {
  field?: string;
  value?: unknown;
};

type OpenCliFields = Record<string, string>;

type ReferenceMedia = {
  type: "image" | "video";
  url: string;
  name: string;
};

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

function detectPlatform(url: string) {
  if (url.includes("xiaohongshu.com")) return "小红书";
  return "小红书";
}

function extractFirstUrl(value: string) {
  return value.match(/https?:\/\/[^\s"'<>，。)）]+/i)?.[0]?.replace(/[),.;，。]+$/, "") ?? value.trim();
}

async function resolveSharedUrl(value: string) {
  const extracted = extractFirstUrl(value);
  if (!/^https?:\/\//i.test(extracted)) return extracted;
  if (!/xhslink|xiao hong shu|xiaohongshu/i.test(extracted)) return extracted;
  try {
    const response = await fetch(extracted, { method: "GET", redirect: "follow" });
    return response.url || extracted;
  } catch {
    return extracted;
  }
}

function platformToOpenCliSite(platform: string) {
  const siteMap: Record<string, string> = {
    小红书: "xiaohongshu"
  };
  return siteMap[platform];
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
    if (fs.existsSync(mainPath)) return { file: nodePath, args: [mainPath, ...args], shell: false };
  }
  return { file: resolvedBin, args, shell: process.platform === "win32" };
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
    // Some OpenCLI site adapters may emit YAML-like rows even when JSON is requested.
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
      current.value = repairMojibake(valueMatch[1].trim().replace(/^['"]|['"]$/g, ""));
    }
  }
  if (current) rows.push(current);
  return rows;
}

function firstRecordFromOutput(output: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed.find((item) => item && typeof item === "object") as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["data", "rows", "results", "items", "videos", "posts"]) {
        const value = record[key];
        if (Array.isArray(value)) return value.find((item) => item && typeof item === "object") as Record<string, unknown> | null;
        if (value && typeof value === "object") return value as Record<string, unknown>;
      }
      return record;
    }
  } catch {
    return null;
  }
  return null;
}

function stringifyField(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return repairMojibake(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return repairMojibake(JSON.stringify(value));
}

function normalizeFields(output: string): OpenCliFields {
  const rows = parseFieldRows(output);
  if (rows.length) {
    return Object.fromEntries(rows.map((row) => [String(row.field ?? ""), stringifyField(row.value)]));
  }

  const record = firstRecordFromOutput(output);
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, stringifyField(value)]));
}

function extractXiaohongshuNoteId(url: string) {
  return url.match(/(?:explore|discovery\/item|search_result)\/([0-9a-fA-F]+)/)?.[1]
    || url.match(/\/([0-9a-fA-F]{16,32})(?:[?#]|$)/)?.[1]
    || `note_${Date.now()}`;
}

async function runOpenCli(args: string[]) {
  const invocation = resolveOpenCliInvocation([...args, "-f", "json", "--site-session", "ephemeral", "--window", "background"]);
  const { stdout } = await execFileAsync(invocation.file, invocation.args, {
    timeout: 90_000,
    windowsHide: true,
    shell: invocation.shell,
    maxBuffer: 1024 * 1024 * 6
  });
  return normalizeFields(stdout);
}

async function parseXiaohongshuNote(url: string) {
  return runOpenCli(["xiaohongshu", "note", url]);
}

function openCliCandidates(platform: string, url: string) {
  const site = platformToOpenCliSite(platform);
  if (!site) return [];
  if (site === "xiaohongshu") return [["xiaohongshu", "note", url]];
  return [];
}

async function parseOpenCliReference(platform: string, url: string) {
  let lastError = "";
  for (const args of openCliCandidates(platform, url)) {
    try {
      const fields = await runOpenCli(args);
      if (Object.keys(fields).length) {
        return { provider: `opencli-${args[0]}-${args[1]}`, fields };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "OpenCLI 解析失败";
    }
  }
  throw new Error(lastError || "当前平台暂未返回可用解析结果");
}

function pickField(fields: OpenCliFields, keys: string[], fallback = "") {
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

function parseJsonLike(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksLikeMediaUrl(url: string) {
  return /^https?:\/\//i.test(url)
    && (/\.(?:jpg|jpeg|png|webp|gif|mp4|mov|m3u8)(?:[?#].*)?$/i.test(url)
      || /(?:xhscdn|sns-webpic|alicdn|qpic)/i.test(url));
}

function collectMediaUrls(value: unknown, bucket: { url: string; hint: string }[], hint = "media") {
  if (!value) return;
  if (typeof value === "string") {
    const parsed = parseJsonLike(value);
    if (parsed) {
      collectMediaUrls(parsed, bucket, hint);
      return;
    }
    const urls = value.match(/https?:\/\/[^\s"',\]\}<>]+/g) ?? [];
    urls.forEach((url) => {
      const cleanUrl = url.replace(/\\u0026/g, "&").replace(/[),.;，。]+$/, "");
      if (looksLikeMediaUrl(cleanUrl)) bucket.push({ url: cleanUrl, hint });
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectMediaUrls(item, bucket, hint));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      collectMediaUrls(nestedValue, bucket, key);
    });
  }
}

function extractMedia(fields: OpenCliFields): ReferenceMedia[] {
  const bucket: { url: string; hint: string }[] = [];
  Object.entries(fields).forEach(([key, value]) => {
    if (/(image|images|photo|photos|cover|thumbnail|thumb|video|media|url|download|素材|图片|封面|视频)/i.test(key)) {
      collectMediaUrls(value, bucket, key);
    }
  });

  const unique = new Map<string, ReferenceMedia>();
  bucket.forEach(({ url, hint }) => {
    if (unique.has(url)) return;
    const type = /video|mp4|mov|m3u8|play/i.test(`${hint} ${url}`) ? "video" : "image";
    unique.set(url, {
      type,
      url,
      name: `${type === "video" ? "视频素材" : "图文素材"} ${unique.size + 1}`
    });
  });
  return [...unique.values()].slice(0, 12);
}

function downloadedMediaForXiaohongshu(url: string): ReferenceMedia[] {
  const noteId = extractXiaohongshuNoteId(url);
  const folder = path.join(process.cwd(), "xiaohongshu-downloads", noteId);
  return mediaFromFolder(folder);
}

function mediaFromFolder(folder: string): ReferenceMedia[] {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder)
    .filter((name) => /\.(?:jpg|jpeg|png|webp|gif|mp4|mov)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name, index) => {
      const type = /\.(?:mp4|mov)$/i.test(name) ? "video" : "image";
      const relativePath = path.relative(process.cwd(), path.join(folder, name)).replace(/\\/g, "/");
      return {
        type,
        url: `/api/reference/media?path=${encodeURIComponent(relativePath)}`,
        name: `${type === "video" ? "采集视频" : "采集图片"} ${index + 1}`
      };
    });
}

function latestDownloadedXiaohongshuMedia(since: number): ReferenceMedia[] {
  const root = path.join(process.cwd(), "xiaohongshu-downloads");
  if (!fs.existsSync(root)) return [];
  const folders = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((folder) => fs.existsSync(folder) && fs.statSync(folder).isDirectory())
    .map((folder) => ({ folder, mtimeMs: fs.statSync(folder).mtimeMs }))
    .filter((item) => item.mtimeMs >= since - 2000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of folders) {
    const media = mediaFromFolder(item.folder);
    if (media.length) return media;
  }
  return [];
}

export async function parseReferenceLink(input: unknown) {
  const data = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawUrl = typeof data.url === "string" ? data.url : "";
  const url = await resolveSharedUrl(rawUrl);
  const title = typeof data.title === "string" ? data.title : referenceSources[0].title;
  const author = typeof data.author === "string" ? data.author : "公开参考作品";
  const likes = typeof data.likes === "string" ? data.likes : "-";
  const fetchedAt = typeof data.fetchedAt === "string" ? data.fetchedAt : new Date().toISOString().slice(0, 10);
  const platform = detectPlatform(url);

  if (url && platformToOpenCliSite(platform)) {
    try {
      const { provider, fields } = await parseOpenCliReference(platform, url);
      const noteTitle = pickField(fields, ["title", "标题", "desc", "description", "caption", "content"], title);
      const noteAuthor = pickField(fields, ["author", "作者", "nickname", "user", "username", "name"], author);
      const noteCopy = pickField(fields, ["content", "正文", "文案", "description", "desc", "caption", "text"], "");
      const noteType = pickField(fields, ["type", "mediaType", "类型"], "");
      let media = extractMedia(fields);
      if (platform === "小红书") {
        const downloadStartedAt = Date.now();
        await runOpenCli(["xiaohongshu", "download", url]).catch(() => ({}));
        const localMedia = downloadedMediaForXiaohongshu(url);
        media = [...(localMedia.length ? localMedia : latestDownloadedXiaohongshuMedia(downloadStartedAt)), ...media];
      }
      return {
        provider,
        input,
        detectedPlatform: platform,
        reference: {
          id: `parsed_${Date.now()}`,
          platform,
          title: noteTitle,
          author: noteAuthor,
          time: fetchedAt,
          likes: pickField(fields, ["likes", "likeCount", "like_count", "点赞", "点赞量"], likes),
          saves: pickField(fields, ["collects", "saves", "saveCount", "收藏", "收藏量"], "-"),
          comments: pickField(fields, ["comments", "commentCount", "comment_count", "评论", "评论量"], "-"),
          status: "已解析",
          reason: "",
          url,
          copy: noteCopy,
          tags: pickField(fields, ["tags", "hashtags", "话题"], ""),
          media,
          mediaType: /视频|video/i.test(noteType || noteTitle || url) ? "视频" : "图文"
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenCLI note 解析失败";
      return {
        provider: "mock-after-opencli-error",
        input,
        detectedPlatform: platform,
        warning: message,
        reference: {
          id: `parsed_${Date.now()}`,
          platform,
          title,
          author,
          time: fetchedAt,
          likes,
          saves: "-",
          comments: "-",
          status: "已解析",
          reason: "",
          url,
          copy: `OpenCLI 暂时没有返回正文。请确认链接可公开访问，或手动粘贴标题正文。当前已保留链接和标题用于仿写流程。`,
          tags: "",
          mediaType: "图文"
        }
      };
    }
  }

  return {
    provider: "mock",
    input,
    detectedPlatform: platform,
    reference: {
      id: `parsed_${Date.now()}`,
      platform,
      title,
      author,
      time: fetchedAt,
      likes,
      saves: "-",
      comments: "-",
      status: "已解析",
      reason: "",
      url,
      copy: `已识别来自 ${platform} 的公开参考链接。当前平台正文解析 adapter 已预留，若公开页面限制读取，可手动粘贴标题正文继续仿写。`,
      mediaType: /视频|video/i.test(`${url} ${title}`) ? "视频" : "图文"
    }
  };
}

export async function parseReferenceText(input: { text?: string }) {
  const text = input?.text ?? "";
  const [title, ...copyLines] = text.split(/\r?\n/);
  return { provider: "mock", title: title || "未命名标题", copy: copyLines.join("\n"), status: "已导入文本" };
}

export async function uploadReferenceText(input: unknown) {
  return { provider: "mock", input, status: "已导入文本", reference: referenceSources[2] };
}
