"use client";

import { useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { TikTokVideo, evaluateVideo } from "@/lib/tiktok/videos";
import type { Production } from "@/lib/tiktok/production";
import { validateStoredMedia, type MediaAnalysis } from "@/lib/tiktok/media-format";
import { readMediaAnalysisStream } from "@/lib/tiktok/media-client";

const fieldClass = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-orange-400 focus:outline-none";
const labels = { hook: "开头钩子", structure: "叙事结构", whyItWorks: "创作假设", adaptation: "改写方向", limits: "依据与局限" };
const mediaLabels = { hook: "开头钩子", structure: "原片结构", visual: "画面与动作", audio: "人声与音乐", editing: "剪辑与转场", pacing: "节奏", onScreenText: "原片字幕", callToAction: "行动引导", limits: "识别局限" };

function exportPackage(video: TikTokVideo, production: Production) {
  const clean = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const table = ["| 时间（秒） | 画面与动作 | 旁白 | 屏幕文字 |", "| --- | --- | --- | --- |", ...production.shots.map((shot) => `| ${shot.start}–${shot.end} | ${clean(shot.visual)} | ${clean(shot.voiceover)} | ${clean(shot.onScreenText)} |`)].join("\n");
  const media = production.media;
  const original = media ? ["## 原视频自动转录", media.transcript.speechDetected ? media.transcript.segments.map(segment => `${segment.start}–${segment.end}s ${segment.text}`).join("\n") : "未识别人声", "## 原视频音画拆解", ...Object.entries(media.summary).map(([key, value]) => `### ${mediaLabels[key as keyof typeof mediaLabels]}\n${value}`), "## 原视频时间轴", ["| 时间（秒） | 原片画面 | 原片声音 | 原片字幕 | 剪辑 |", "| --- | --- | --- | --- | --- |", ...media.timeline.map(shot => `| ${shot.start}–${shot.end} | ${clean(shot.visual)} | ${clean(shot.audio)} | ${clean(shot.onScreenText)} | ${clean(shot.editing)} |`)].join("\n"), `原片时长：${media.duration}s · 模型：${media.model} · 采集：${media.capturedAt}\n来源文件 SHA256：${media.evidence.videoSha256}\n音画分析 ID：${media.id}`, "自动识别文字与时间为近似结果，请核对专有名词、价格和镜头细节。", ...media.warnings] : [];
  const content = [
    `# ${production.rewrite.title}`, `来源视频：${video.url}`, `生成时间：${production.generatedAt}`, `语言：${production.language} · 计划时长：${production.duration} 秒`, `生成模型：${production.model || "历史记录未保存模型名"}`,
    media ? "基于原视频音画分析与编辑后的文字资料；以下新拍分镜为创作建议。" : "仅基于文字资料；以下分镜为建议的新拍方案。", ...original, "## 创作拆解", ...Object.entries(production.analysis).map(([key, value]) => `### ${labels[key as keyof typeof labels]}\n${value}`),
    "## 发布文案", production.rewrite.caption, "## 完整口播", production.rewrite.voiceover,
    "## 新拍分镜", table,
    "## 拍摄准备", production.preparation.map((value) => `- ${value}`).join("\n"), "## 人工审核事项", production.warnings.map((value) => `- ${value}`).join("\n"),
    "## 文字依据", production.sourceText, "## 产品事实", production.productFacts || "未提供", "## 拍摄要求", production.requirements || "未提供"
  ].join("\n\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `tiktok-${video.id}-shooting.md`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TikTokProductionWorkspace({ video, evaluation, previous, media, enabled, mediaEnabled, onSave, onSaveMedia }: {
  video: TikTokVideo;
  evaluation?: ReturnType<typeof evaluateVideo>;
  previous?: Production;
  media?: MediaAnalysis;
  enabled: boolean;
  mediaEnabled: boolean;
  onSave: (production: Production) => void;
  onSaveMedia: (media: MediaAnalysis) => void;
}) {
  const [sourceText, setSourceText] = useState(media && media.id !== previous?.media?.id ? (media.transcript.text || media.summary.visual) : previous?.sourceText ?? (video.transcript || video.description));
  const [language, setLanguage] = useState<Production["language"]>(previous?.language ?? "ms");
  const [duration, setDuration] = useState(previous?.duration ?? 30);
  const [productFacts, setProductFacts] = useState(previous?.productFacts ?? "");
  const [requirements, setRequirements] = useState(previous?.requirements ?? "");
  const [result, setResult] = useState(previous);
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function analyze() {
    setMediaBusy(true); setMessage("正在读取原视频…");
    try {
      const response = await fetch("/api/tiktok/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video }) });
      const analysis = validateStoredMedia(await readMediaAnalysisStream(response, setMessage));
      if (analysis.videoId !== video.id || analysis.author.toLowerCase() !== video.author.toLowerCase()) throw new Error("音画分析与当前视频不对应");
      setSourceText(analysis.transcript.text || analysis.summary.visual); onSaveMedia(analysis);
      setMessage("原视频转录与音画拆解已保存，可核对文字后生成新拍脚本。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "音画分析失败"); }
    finally { setMediaBusy(false); }
  }

  async function generate() {
    setBusy(true); setMessage(media ? "正在根据原片音画生成改写和新拍分镜…" : "正在生成文字拆解、改写和分镜…");
    try {
      const response = await fetch("/api/tiktok/produce", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video, sourceText, language, duration, productFacts, requirements, ...(media ? { mediaAnalysisId: media.id } : {}) }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "生成失败");
      setResult(payload.data); onSave(payload.data); setMessage("拍摄包已生成并保存到当前浏览器，请审核后使用。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "生成失败"); }
    finally { setBusy(false); }
  }

  return <Card>
    <CardHeader title={`拆解与创作 · @${video.author}`} subtitle="先读取原视频的声音与画面，再改写文案和生成新拍分镜。" action={result && <Button icon={<Download className="h-4 w-4" />} onClick={() => exportPackage(video, result)}>导出拍摄脚本</Button>} />
    <CardBody>
      <a href={video.url} target="_blank" rel="noreferrer" className="text-sm text-orange-700 underline">打开原视频核对</a>
      {evaluation?.status !== "matched" && <p className="mt-2 text-xs text-amber-800">该视频尚未命中筛选条件，可用于创作参考：{evaluation?.reasons.join("；")}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={mediaBusy || busy || !mediaEnabled} icon={<Sparkles className="h-4 w-4" />} onClick={() => void analyze()}>{mediaBusy ? "正在分析原视频…" : media ? "重新转录与音画拆解" : "自动转录与音画拆解"}</Button><p className="text-xs text-muted">单条原片 ≤180 秒、≤64 MB；需配置 TikHub、OpenLux 和 FFmpeg。</p></div>
      {media && <div className="mt-4 space-y-4 rounded-md border border-line bg-slate-50 p-4">
        <div><h3 className="font-semibold">原视频音画分析 · {media.duration.toFixed(2)} 秒</h3><p className="mt-1 text-xs leading-5 text-muted">{media.model} · 原片已解码，时间轴覆盖完整时长 · 自动识别文字与时间近似，请核对专有名词、价格及镜头细节。来源 SHA256：{media.evidence.videoSha256.slice(0, 12)}…</p></div>
        <details open><summary className="cursor-pointer text-sm font-semibold">自动转录 · {media.transcript.language || "未识别人声语言"}</summary><div className="mt-2 space-y-2 text-sm leading-6">{media.transcript.speechDetected ? media.transcript.segments.map((segment, index) => <p key={index}><span className="mr-2 text-xs text-muted">{segment.start}–{segment.end}s</span>{segment.text}</p>) : <p>未识别人声，画面、音乐及剪辑分析仍可使用。</p>}</div></details>
        <details><summary className="cursor-pointer text-sm font-semibold">原片画面、声音与剪辑拆解</summary><dl className="mt-3 grid gap-3 lg:grid-cols-2">{Object.entries(media.summary).map(([key, value]) => <div key={key}><dt className="text-xs font-semibold text-muted">{mediaLabels[key as keyof typeof mediaLabels]}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{value}</dd></div>)}</dl></details>
        <details><summary className="cursor-pointer text-sm font-semibold">原视频音画时间轴（0–{media.duration.toFixed(2)}s）</summary><div className="mt-3 space-y-3">{media.timeline.map((shot, index) => <div key={index} className="border-t border-line pt-3 text-sm leading-6"><p className="font-medium">{shot.start}–{shot.end}s · 原片画面</p><p>{shot.visual}</p><p><span className="text-muted">声音：</span>{shot.audio}</p><p><span className="text-muted">字幕：</span>{shot.onScreenText || "无可辨认字幕"}</p><p><span className="text-muted">剪辑：</span>{shot.editing}</p></div>)}</div></details>
        {media.warnings.length > 0 && <p className="text-xs leading-5 text-amber-800">{media.warnings.join("；")}</p>}
      </div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-medium">文字资料（逐字稿 / 字幕 / 人工观察）<textarea aria-label="文字资料" className={`${fieldClass} mt-1`} rows={8} maxLength={20000} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="自动转录后可编辑，也可粘贴真实逐字稿、字幕或镜头观察。" /><span className="mt-1 block text-xs font-normal leading-5 text-muted">{media ? "已结合原视频音画分析；可修正转录内容，原始识别记录保留在上方。" : "尚未分析原视频，仅用这些文字生成。点击上方按钮可自动转录与分析音画。"}</span></label>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium">成片语言<select aria-label="成片语言" className={`${fieldClass} mt-1`} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}><option value="ms">马来语</option><option value="en">英语</option><option value="zh">中文</option></select></label><label className="text-sm font-medium">计划时长<select aria-label="计划时长" className={`${fieldClass} mt-1`} value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{[15, 30, 45, 60, 90].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}</select></label></div>
          <label className="block text-sm font-medium">产品事实（选填）<textarea aria-label="产品事实" className={`${fieldClass} mt-1`} rows={3} maxLength={5000} value={productFacts} onChange={(event) => setProductFacts(event.target.value)} placeholder="只填已确认的名称、特点、价格等；留空时不生成产品功效或优惠声称。" /></label>
          <label className="block text-sm font-medium">拍摄要求（选填）<textarea aria-label="拍摄要求" className={`${fieldClass} mt-1`} rows={2} maxLength={5000} value={requirements} onChange={(event) => setRequirements(event.target.value)} placeholder="例如：一个人、一部手机、室内桌面拍摄" /></label>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="primary" disabled={busy || mediaBusy || !enabled || (!media && sourceText.trim().length < 10)} icon={<Sparkles className="h-4 w-4" />} onClick={() => void generate()}>{busy ? "生成中…" : "生成拆解、改写与拍摄脚本"}</Button>{!enabled && <p className="text-xs text-amber-800">配置 OpenLux 后可生成，当前不会返回模拟文案。</p>}</div>
      {message && <p role="status" className="mt-3 text-sm text-orange-800">{message}</p>}
      {result && <div className="mt-6 space-y-5 border-t border-line pt-5">
        <div className="rounded-md bg-amber-50 p-3 text-xs leading-5 text-amber-900">生成于 {new Date(result.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {result.duration} 秒 · {result.language} · {result.model || "历史模型"} · {result.basis === "video_audio" ? "原视频音画依据" : "仅文字依据"}。结果对应生成时的资料与设置；修改输入或重新分析后请重新生成。</div>
        <div><h3 className="mb-3 font-semibold">创作拆解</h3><dl className="grid gap-3 lg:grid-cols-2">{Object.entries(result.analysis).map(([key, value]) => <div key={key} className="rounded-md bg-slate-50 p-3"><dt className="text-xs font-semibold text-muted">{labels[key as keyof typeof labels]}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{value}</dd></div>)}</dl></div>
        <div><h3 className="font-semibold">原创改写</h3><p className="mt-2 text-base font-medium">{result.rewrite.title}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{result.rewrite.caption}</p><h4 className="mt-3 text-xs font-semibold text-muted">完整口播</h4><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{result.rewrite.voiceover}</p></div>
        <div className="overflow-x-auto"><h3 className="mb-3 font-semibold">新拍分镜</h3><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr>{["时间", "画面与动作", "旁白", "屏幕文字"].map((label) => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{result.shots.map((shot, index) => <tr key={index} className="border-b border-line align-top"><td className="whitespace-nowrap p-3 tabular-nums">{shot.start}–{shot.end}s</td><td className="min-w-[180px] whitespace-pre-wrap p-3 leading-6">{shot.visual}</td><td className="min-w-[180px] whitespace-pre-wrap p-3 leading-6">{shot.voiceover}</td><td className="min-w-[120px] whitespace-pre-wrap p-3 leading-6">{shot.onScreenText || "—"}</td></tr>)}</tbody></table></div>
        <div className="grid gap-4 lg:grid-cols-2"><div><h3 className="font-semibold">拍摄准备</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{result.preparation.map((value, index) => <li key={index}>{value}</li>)}</ul></div><div><h3 className="font-semibold">人工审核事项</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{result.warnings.map((value, index) => <li key={index}>{value}</li>)}</ul></div></div>
      </div>}
    </CardBody>
  </Card>;
}
