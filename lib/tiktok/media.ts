import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ProxyAgent } from "undici";
import { TikTokServiceError } from "./errors";
import { getTikTokRewriteConfig, requestTikTokVideoJson } from "./rewrite";
import { validateMediaOutput, validateStoredMedia, type MediaAnalysis } from "./media-format";
import { normalizeVideo, record } from "./videos";
import { countryOptions } from "./countries";
import { createCollectionApi, hasCollectionKey } from "./collection-api";

export const mediaLimits = { seconds: 180, bytes: 64 * 1024 * 1024, modelBytes: 18 * 1024 * 1024 };
const defaultRoot = () => path.join(process.cwd(), "outputs", "tiktok-media");
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
type Options = { apiKey?: string; scrapeCreatorsApiKey?: string; root?: string; fetcher?: typeof fetch; signal?: AbortSignal; onProgress?: (message: string) => void;
  runCommand?: (command: string, args: string[], signal?: AbortSignal) => Promise<string>;
  requester?: (prompt: string, videoBase64: string, duration: number, signal?: AbortSignal) => Promise<Record<string, unknown>> };

async function runCommand(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: "utf8", windowsHide: true, signal, timeout: 180000, maxBuffer: 2_000_000 }, (error, stdout) => {
    if (error) reject(new TikTokServiceError("FFmpeg 媒体校验或处理失败，请检查安装及视频文件", 502)); else resolve(stdout);
  }));
}

function mediaUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !/(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|tiktokv\.com|tiktokv\.us|tiktok\.com|akamaized\.net|byteoversea\.com|ibytedtos\.com)$/.test(url.hostname)) throw new Error("媒体地址不在允许的原视频域名中");
  return url;
}

function candidates(input: unknown) {
  const found: Array<{ url: string; field: string }> = [];
  function walk(value: unknown, field: string) {
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${field}[${index}]`));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walk(item, `${field}.${key}`));
    else if (typeof value === "string" && /^https:\/\//.test(value) && /play_addr|download.*addr|bit_rate/.test(field) && field.includes("url_list")) {
      try { mediaUrl(value); if (!found.some(item => item.url === value)) found.push({ url: value, field }); } catch { /* 不请求未知媒体来源。 */ }
    }
  }
  const video = record(input);
  walk(video.play_addr, "video.play_addr"); walk(video.play_addr_h264, "video.play_addr_h264"); walk(video.bit_rate, "video.bit_rate"); walk(video.download_addr, "video.download_addr");
  return found;
}

function analysisPrompt(duration: number) {
  return [
    `读取上传的完整原视频。经 FFmpeg 校验的准确时长是 ${duration} 秒；只观察实际音画，不使用外部标题猜测。`,
    "先自动转录可辨人声，保留原语言和中英混说，不翻译、不补造句子，听不清写明。没有人声时 speechDetected=false、language=null、segments=[]。",
    "再拆解完整视频的画面、剪辑转场、声音、节奏、屏幕文字和结尾引导。分析用中文；把观察事实与推测分开，不据播放量编造成功因果。",
    "timeline 从0开始连续覆盖到准确总时长；按实物/场景/镜头变化分段，每段写实际画面、声音、字幕和剪辑方式。不得把新拍建议当作原片事实。时间戳是近似观察，需要人工核对。",
    "原片中的价格、功效、促销和销量仅记录为‘原片显示/说到’，不代表当前商品事实或真实性；不确认无法看清的小字。",
    "只输出 JSON：{\"inputRecognized\":true,\"durationSeconds\":准确时长,\"transcript\":{\"speechDetected\":true,\"language\":\"zh/en/ms或混合语言\",\"segments\":[{\"start\":0,\"end\":1.2,\"text\":\"原语言实际人声\"}]},\"summary\":{\"hook\":\"原片开头\",\"structure\":\"叙事顺序\",\"visual\":\"人物物品场景\",\"audio\":\"人声音乐音效\",\"editing\":\"剪辑转场\",\"pacing\":\"实际节奏\",\"onScreenText\":\"实际字幕，或无屏幕文字\",\"callToAction\":\"原片行动引导，或未发现\",\"limits\":\"不确定部分\"},\"timeline\":[{\"start\":0,\"end\":准确总时长,\"visual\":\"实际画面\",\"audio\":\"实际声音\",\"onScreenText\":\"实际屏幕文字，可空\",\"editing\":\"镜头与转场\"}],\"warnings\":[\"识别与事实需人工复核\"]}"
  ].join("\n");
}

export async function analyzeTikTokVideo(input: unknown, options: Options = {}): Promise<MediaAnalysis> {
  let video;
  try { video = normalizeVideo(record(input).video); } catch { throw new TikTokServiceError("需要身份一致的完整 TikTok 视频记录"); }
  const region = video.searchRegion ?? (countryOptions.some(option => option.code === video.country) ? video.country! : "MY");
  if (!hasCollectionKey(options) || !getTikTokRewriteConfig().apiKey) throw new TikTokServiceError("原视频分析需要配置 ScrapeCreators 或 TikHub，以及 OpenLux 服务", 503);
  const fetcher = options.fetcher ?? fetch, command = options.runCommand ?? runCommand;
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000);
  const id = randomUUID(), root = options.root ?? defaultRoot(), directory = path.join(root, id);
  await fs.mkdir(directory, { recursive: true });
  const original = path.join(directory, "original.mp4"), modelFile = path.join(directory, "model.mp4");
  const ownedFiles = [original, modelFile];
  const attempts: Array<Record<string, unknown>> = [];
  let proxy: ProxyAgent | undefined;
  async function cleanup() {
    for (const file of ownedFiles) {
      if (!path.resolve(file).startsWith(path.resolve(directory) + path.sep)) throw new Error("Invalid temporary media path");
      await fs.unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }
  try {
    options.onProgress?.("正在获取原视频详情并核验视频和作者身份…");
    const metadata = await createCollectionApi({ ...options, signal, onFallback: message => options.onProgress?.(message) }).request("fetch_one_video_v3", { aweme_id: video.id, username: video.author, region });
    const detail = record(metadata.data.aweme_detail), author = record(detail.author);
    if (detail.aweme_id !== video.id || typeof author.unique_id !== "string" || author.unique_id.toLowerCase() !== video.author.toLowerCase()) throw new TikTokServiceError("原视频媒体与请求身份不一致", 502);
    if (detail.image_post_info || detail.aweme_type === 150) throw new TikTokServiceError("图文作品不能作为原视频音画输入");
    if (Number(record(detail.video).duration) > mediaLimits.seconds * 1000) throw new TikTokServiceError("原视频超过 180 秒，暂不能完整处理", 413);
    const urls = candidates(detail.video);
    if (!urls.length) throw new TikTokServiceError("没有取得可用的原视频媒体地址", 502);
    if (process.env.TIKTOK_MEDIA_PROXY?.trim() && !options.fetcher) proxy = new ProxyAgent(process.env.TIKTOK_MEDIA_PROXY.trim());
    let bytes: Buffer | undefined, chosen: typeof urls[number] | undefined;
    for (const candidate of urls.slice(0, 6)) {
      options.onProgress?.(`正在下载原视频（候选媒体 ${attempts.length + 1}）…`);
      try {
        let url = mediaUrl(candidate.url), response: Response | undefined;
        for (let redirects = 0; redirects <= 4; redirects++) {
          const init: RequestInit & { dispatcher?: ProxyAgent } = { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.tiktok.com/" }, signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]), redirect: "manual", ...(proxy ? { dispatcher: proxy } : {}) };
          response = await fetcher(url.toString(), init);
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get("location"); await response.body?.cancel();
          if (!location || redirects === 4) throw new Error("媒体重定向无效");
          url = mediaUrl(new URL(location, url).toString());
        }
        if (!response) throw new Error("媒体请求未完成");
        const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
        attempts.push({ field: candidate.field, urlSha256: hash(candidate.url), httpStatus: response.status, contentType });
        if (!response.ok || !["video/mp4", "application/octet-stream"].includes(contentType) || Number(response.headers.get("content-length")) > mediaLimits.bytes || !response.body) { await response.body?.cancel(); continue; }
        const reader = response.body.getReader(), parts: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > mediaLimits.bytes) throw new Error("媒体过大"); parts.push(part.value); }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const body = Buffer.concat(parts);
        if (body.length < 1024 || !body.subarray(0, 32).includes(Buffer.from("ftyp"))) continue;
        bytes = body; chosen = candidate; break;
      } catch { attempts.push({ field: candidate.field, urlSha256: hash(candidate.url), failed: true }); if (signal.aborted) throw new TikTokServiceError("原视频分析已取消或超时", 502); }
    }
    if (!bytes || !chosen) throw new TikTokServiceError("原视频媒体下载或验证失败，请检查网络与媒体代理配置", 502);
    await fs.writeFile(original, bytes);
    options.onProgress?.("正在验证音视频轨道并完整解码原片…");
    const ffprobe = process.env.TIKTOK_FFPROBE_BIN || "ffprobe", ffmpeg = process.env.TIKTOK_FFMPEG_BIN || "ffmpeg";
    const probe = record(JSON.parse(await command(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", original.replace(/\\/g, "/")], signal)));
    const duration = Number(record(probe.format).duration), streams = Array.isArray(probe.streams) ? probe.streams.map(record) : [];
    const videoStream = streams.find(stream => stream.codec_type === "video"), audioStream = streams.find(stream => stream.codec_type === "audio");
    if (!Number.isFinite(duration) || duration <= 0 || duration > mediaLimits.seconds || !videoStream) throw new TikTokServiceError("视频时长无效或超过 180 秒，不能完整分析", 413);
    if (typeof record(detail.video).duration === "number" && Math.abs(Number(record(detail.video).duration) / 1000 - duration) > 2) throw new TikTokServiceError("下载的视频时长与来源不一致", 502);
    await command(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", original, "-f", "null", "-"], signal);
    options.onProgress?.(`原片 ${duration.toFixed(1)} 秒已解码，正在准备整段音画输入…`);
    await command(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", original, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-vf", "scale=512:-2,fps=10", "-c:v", "libx264", "-preset", "fast", "-crf", "30", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", modelFile], signal);
    const modelBytes = await fs.readFile(modelFile);
    if (!modelBytes.length || modelBytes.length > mediaLimits.modelBytes) throw new TikTokServiceError("处理后的视频体积超过模型输入限制，未生成分析", 413);
    options.onProgress?.("正在转录原语言人声，并拆解整段画面、声音、剪辑与节奏…");
    const requester = options.requester ?? ((prompt, base64, seconds, abort) => requestTikTokVideoJson(prompt, base64, seconds, fetcher, abort));
    const output = await requester(analysisPrompt(duration), modelBytes.toString("base64"), duration, signal);
    const fields = validateMediaOutput(output, duration, Boolean(audioStream));
    await cleanup();
    const analysis: MediaAnalysis = { ...fields, id, videoId: video.id, url: video.url, author: video.author,
      capturedAt: new Date().toISOString(), generatedAt: new Date().toISOString(), model: getTikTokRewriteConfig().model, duration, basis: "video_audio",
      evidence: { provider: metadata.provider, metadataId: video.id, sourceField: chosen.field, sourceUrlSha256: hash(chosen.url), videoSha256: hash(bytes), modelVideoSha256: hash(modelBytes),
        bytes: bytes.length, modelBytes: modelBytes.length, videoCodec: String(videoStream.codec_name), audioCodec: audioStream ? String(audioStream.codec_name) : null, hasAudio: Boolean(audioStream), decoded: true, temporaryMediaRemoved: true },
      warnings: ["AI 转录、时间戳和细小字幕可能有误，请核对原片。原片价格及促销不代表当前商品事实。", ...fields.warnings] };
    await fs.writeFile(path.join(directory, "analysis.json"), JSON.stringify(analysis, null, 2), "utf8");
    await fs.writeFile(path.join(directory, "attempts.json"), JSON.stringify(attempts, null, 2), "utf8");
    return analysis;
  } catch (error) {
    await fs.writeFile(path.join(directory, "failure.json"), JSON.stringify({ videoId: video.id, capturedAt: new Date().toISOString(), attempts,
      error: error instanceof TikTokServiceError ? error.message : "媒体处理失败" }, null, 2), "utf8");
    throw error;
  } finally { await cleanup(); await proxy?.close(); }
}

export async function loadMediaAnalysis(id: string, inputVideo: unknown, root = defaultRoot()): Promise<MediaAnalysis> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TikTokServiceError("原视频分析记录无效");
  let stored;
  try { stored = validateStoredMedia(JSON.parse(await fs.readFile(path.join(root, id, "analysis.json"), "utf8"))); }
  catch { throw new TikTokServiceError("原视频分析记录无法读取或尚未完成，请重新分析", 404); }
  const video = normalizeVideo(inputVideo);
  if (stored.videoId !== video.id || stored.author.toLowerCase() !== video.author.toLowerCase()) throw new TikTokServiceError("原视频分析与当前视频不对应");
  return stored;
}
