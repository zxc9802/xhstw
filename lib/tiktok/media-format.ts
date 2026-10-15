import { TikTokServiceError } from "./errors";
import { normalizeVideo, record } from "./videos";

const summaryKeys = ["hook", "structure", "visual", "audio", "editing", "pacing", "onScreenText", "callToAction", "limits"] as const;
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function invalid(message: string): never { throw new TikTokServiceError(message, 502); }

export function validateMediaOutput(input: unknown, duration: number, hasAudio: boolean) {
  const output = record(input), transcript = record(output.transcript), summary = record(output.summary);
  if (output.inputRecognized !== true) invalid("模型未确认读取原视频，不能作为音画分析");
  if (typeof output.durationSeconds !== "number" || !Number.isFinite(output.durationSeconds) || Math.abs(output.durationSeconds - duration) > Math.max(1, duration * 0.03)) invalid("模型读取的视频时长与原片不一致");
  if (summaryKeys.some(key => !text(summary[key]))) invalid("原视频音画拆解字段不完整");
  if (typeof transcript.speechDetected !== "boolean" || !Array.isArray(transcript.segments) || transcript.segments.length > 300) invalid("自动转录结构无效");
  if (transcript.speechDetected && !hasAudio) invalid("原视频没有音轨，不能声称已转录声音");
  if ((transcript.speechDetected && !transcript.segments.length) || (!transcript.speechDetected && transcript.segments.length)) invalid("转录文字与人声状态不一致");
  let previousSpeechEnd = 0;
  const segments = transcript.segments.map(value => {
    const segment = record(value);
    if (typeof segment.start !== "number" || typeof segment.end !== "number" || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
      || segment.start < previousSpeechEnd - 0.1 || segment.start < 0 || segment.end <= segment.start || segment.end > duration + 0.5 || !text(segment.text)) invalid("转录时间或文字无效");
    previousSpeechEnd = segment.end;
    return { start: segment.start, end: Math.min(segment.end, duration), text: text(segment.text) };
  });
  if (!Array.isArray(output.timeline) || !output.timeline.length || output.timeline.length > 100) invalid("原视频时间轴缺失或无效");
  let previousEnd = 0;
  const timeline = output.timeline.map((value, index) => {
    const shot = record(value), last = index === (output.timeline as unknown[]).length - 1;
    if (typeof shot.start !== "number" || typeof shot.end !== "number" || !Number.isFinite(shot.start) || !Number.isFinite(shot.end)
      || Math.abs(shot.start - previousEnd) > 0.05 || shot.end <= shot.start || shot.end > duration + 1
      || !text(shot.visual) || !text(shot.audio) || !text(shot.editing) || typeof shot.onScreenText !== "string") invalid("原视频音画时间轴字段无效或存在缺口");
    if (last && Math.abs(shot.end - duration) > 1) invalid("原视频时间轴没有覆盖完整时长");
    const start = previousEnd, end = last ? duration : shot.end;
    if (end <= start || end > duration) invalid("原视频时间轴超出原片时长");
    previousEnd = end;
    return { start, end, visual: text(shot.visual), audio: text(shot.audio), onScreenText: text(shot.onScreenText), editing: text(shot.editing) };
  });
  if (!Array.isArray(output.warnings) || output.warnings.some(value => !text(value))) invalid("音画分析审核事项无效");
  return {
    transcript: { status: transcript.speechDetected ? "transcribed" as const : "no_speech" as const, speechDetected: transcript.speechDetected,
      language: text(transcript.language) || null, segments, text: segments.map(segment => segment.text).join("\n"), method: "gemini_video" as const },
    timeline, summary: Object.fromEntries(summaryKeys.map(key => [key, text(summary[key])])) as Record<typeof summaryKeys[number], string>,
    warnings: output.warnings.map(text)
  };
}

export type MediaAnalysis = ReturnType<typeof validateMediaOutput> & {
  id: string; videoId: string; url: string; author: string; capturedAt: string; generatedAt: string; model: string; duration: number;
  basis: "video_audio";
  evidence: { metadataId: string; sourceField: string; sourceUrlSha256: string; videoSha256: string; modelVideoSha256: string;
    bytes: number; modelBytes: number; videoCodec: string; audioCodec: string | null; hasAudio: boolean; decoded: true; temporaryMediaRemoved: boolean };
};

export function validateStoredMedia(input: unknown): MediaAnalysis {
  const row = record(input), evidence = record(row.evidence);
  if (typeof row.id !== "string" || !/^[0-9a-f-]{36}$/i.test(row.id) || row.basis !== "video_audio" || !text(row.model)
    || typeof row.duration !== "number" || !Number.isFinite(row.duration) || row.duration <= 0 || row.duration > 180
    || ![row.capturedAt, row.generatedAt].every(value => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))) invalid("保存的原视频分析信息无效");
  const video = normalizeVideo({ id: row.videoId, url: row.url, author: row.author });
  if (evidence.metadataId !== video.id || evidence.decoded !== true || typeof evidence.hasAudio !== "boolean"
    || ![evidence.sourceUrlSha256, evidence.videoSha256, evidence.modelVideoSha256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value))) invalid("原视频来源或媒体验证信息无效");
  const fields = validateMediaOutput({ inputRecognized: true, durationSeconds: row.duration, transcript: row.transcript, timeline: row.timeline, summary: row.summary, warnings: row.warnings }, row.duration, evidence.hasAudio);
  return { ...row, ...fields } as MediaAnalysis;
}
