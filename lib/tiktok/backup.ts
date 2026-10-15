import { validateProductionOutput, type Production } from "./production-format";
import { record, type TikTokVideo } from "./videos";
import { validateStoredMedia, type MediaAnalysis } from "./media-format";

export type CollectionRun = {
  warnings: string[]; scanned: number; hasMore: boolean; nextOffset: number | null;
  capturedAt: string; evidencePages: unknown[]; keyword: string;
  country?: string;
};

function date(value: unknown): value is string {
  return typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

export function restoreTikTokBackup(input: unknown, videos: TikTokVideo[], current: Record<string, Production> = {}, currentMedia: Record<string, MediaAnalysis> = {}) {
  const payload = record(input), ids = new Set(videos.map(video => video.id));
  const productions = { ...current }, mediaAnalyses = { ...currentMedia }, runs: CollectionRun[] = [], warnings: string[] = [];
  function pairedMedia(value: unknown, id: string) {
    const media = validateStoredMedia(value), video = videos.find(video => video.id === id);
    if (!video || media.videoId !== id || media.author.toLowerCase() !== video.author.toLowerCase()) throw new Error();
    return media;
  }
  for (const [id, value] of Object.entries(record(payload.mediaAnalyses))) {
    try {
      const media = pairedMedia(value, id), previous = mediaAnalyses[id];
      if (!previous || Date.parse(media.generatedAt) >= Date.parse(previous.generatedAt)) mediaAnalyses[id] = media;
    } catch { warnings.push(`${id} 的原视频分析无效或与视频不对应，未恢复`); }
  }
  for (const [id, value] of Object.entries(record(payload.productions))) {
    const row = record(value);
    try {
      if (!ids.has(id) || row.videoId !== id || !["text_only", "video_audio"].includes(String(row.basis)) || !date(row.generatedAt)
        || !["zh", "en", "ms"].includes(String(row.language)) || !Number.isInteger(row.duration) || Number(row.duration) < 15 || Number(row.duration) > 180
        || typeof row.sourceText !== "string" || row.sourceText.trim().length < (row.basis === "video_audio" ? 1 : 10) || row.sourceText.length > 20000
        || typeof row.productFacts !== "string" || row.productFacts.length > 5000 || typeof row.requirements !== "string" || row.requirements.length > 5000
        || (row.model !== undefined && typeof row.model !== "string")) throw new Error();
      const language = row.language as Production["language"], duration = Number(row.duration);
      const fields = validateProductionOutput(row, language, duration);
      const media = row.basis === "video_audio" ? pairedMedia(row.media, id) : undefined;
      const previous = productions[id];
      if (!previous || Date.parse(row.generatedAt) >= Date.parse(previous.generatedAt)) {
        productions[id] = { videoId: id, generatedAt: row.generatedAt, basis: row.basis as Production["basis"], language, duration,
          sourceText: row.sourceText, productFacts: row.productFacts, requirements: row.requirements,
          ...(typeof row.model === "string" ? { model: row.model } : {}), ...(media ? { media } : {}), ...fields };
      }
    } catch { warnings.push(`${id} 的拍摄包无效或与视频不对应，未恢复`); }
  }
  if (Array.isArray(payload.runs)) {
    for (const value of payload.runs.slice(-10)) {
      const run = record(value);
      if (!date(run.capturedAt) || !Number.isSafeInteger(run.scanned) || Number(run.scanned) < 0 || typeof run.hasMore !== "boolean"
        || !(run.nextOffset === null || (Number.isSafeInteger(run.nextOffset) && Number(run.nextOffset) >= 0))
        || typeof run.keyword !== "string" || !Array.isArray(run.evidencePages) || !Array.isArray(run.warnings) || run.warnings.some(value => typeof value !== "string")) {
        warnings.push("一条采集历史无效，未恢复"); continue;
      }
      runs.push(run as CollectionRun);
    }
  }
  return { productions, mediaAnalyses, runs, warnings };
}
