import { TikTokServiceError } from "./errors";
import { record } from "./videos";
import type { MediaAnalysis } from "./media-format";

export type Production = {
  videoId: string;
  generatedAt: string;
  basis: "text_only" | "video_audio";
  media?: MediaAnalysis;
  model?: string;
  language: "zh" | "en" | "ms";
  duration: number;
  sourceText: string;
  productFacts: string;
  requirements: string;
  analysis: { hook: string; structure: string; whyItWorks: string; adaptation: string; limits: string };
  rewrite: { title: string; caption: string; voiceover: string };
  shots: Array<{ start: number; end: number; visual: string; voiceover: string; onScreenText: string }>;
  preparation: string[];
  warnings: string[];
};

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export function validateProductionOutput(output: Record<string, unknown>, lang: Production["language"], seconds: number) {
  const analysis = record(output.analysis), rewrite = record(output.rewrite);
  const analysisKeys = ["hook", "structure", "whyItWorks", "adaptation", "limits"] as const;
  const rewriteKeys = ["title", "caption", "voiceover"] as const;
  if (analysisKeys.some((key) => !text(analysis[key])) || rewriteKeys.some((key) => !text(rewrite[key]))) throw new TikTokServiceError("模型返回结构不完整，请重新生成", 502);
  if (!Array.isArray(output.shots) || !output.shots.length || output.shots.length > 30) throw new TikTokServiceError("模型分镜结构无效", 502);
  let previousEnd = 0;
  const shots = output.shots.map((value) => {
    const shot = record(value);
    if (typeof shot.start !== "number" || typeof shot.end !== "number" || !Number.isFinite(shot.start) || !Number.isFinite(shot.end)
      || Math.abs(shot.start - previousEnd) > 0.001 || shot.end <= shot.start || shot.end > seconds || !text(shot.visual) || !text(shot.voiceover)
      || typeof shot.onScreenText !== "string") throw new TikTokServiceError("模型分镜时间或字段无效，请重新生成", 502);
    previousEnd = shot.end;
    return { start: shot.start, end: shot.end, visual: text(shot.visual), voiceover: text(shot.voiceover), onScreenText: text(shot.onScreenText) };
  });
  if (Math.abs(previousEnd - seconds) > 0.001) throw new TikTokServiceError("模型分镜没有覆盖指定时长，请重新生成", 502);
  if (lang !== "zh" && /[\u3400-\u9fff]/u.test(JSON.stringify({ rewrite, spoken: shots.map(({ voiceover, onScreenText }) => ({ voiceover, onScreenText })) }))) throw new TikTokServiceError("模型没有遵守口播语言要求，请重新生成", 502);
  if (!Array.isArray(output.preparation) || !output.preparation.length || output.preparation.some((value) => !text(value))
    || !Array.isArray(output.warnings) || output.warnings.some((value) => !text(value))) throw new TikTokServiceError("模型返回准备清单结构无效", 502);
  return {
    analysis: Object.fromEntries(analysisKeys.map((key) => [key, text(analysis[key])])) as Production["analysis"],
    rewrite: Object.fromEntries(rewriteKeys.map((key) => [key, text(rewrite[key])])) as Production["rewrite"],
    shots, preparation: output.preparation.map(text), warnings: output.warnings.map(text)
  };
}
