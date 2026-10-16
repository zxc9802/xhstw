"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Search, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { TikTokProductionWorkspace } from "@/components/tiktok/ProductionWorkspace";
import { defaultFilters, evaluateVideo, importVideos, mergeVideos, normalizeVideo, type TikTokVideo, type VideoFilters } from "@/lib/tiktok/videos";
import type { Production } from "@/lib/tiktok/production";
import { restoreTikTokBackup, type CollectionRun } from "@/lib/tiktok/backup";
import type { MediaAnalysis } from "@/lib/tiktok/media-format";
import { countryOptions } from "@/lib/tiktok/countries";
import type { CollectionProvider } from "@/lib/tiktok/collection-api";

const storageKey = "content-production-studio.tiktok-videos.v1";
const fieldClass = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-orange-400 focus:outline-none";
type Capabilities = { collection: boolean; production: boolean; productionModel: string; visualAnalysis: boolean; transcription: boolean };
type Collection = { videos: TikTokVideo[]; warnings: string[]; scanned: number; hasMore: boolean; nextOffset: number | null; capturedAt: string; evidencePages: unknown[]; keyword: string; country: string; provider?: CollectionProvider };
type View = "all" | "matched" | "pending" | "excluded";
const views: Array<{ key: View; label: string }> = [{ key: "all", label: "全部候选" }, { key: "matched", label: "命中" }, { key: "pending", label: "待核实" }, { key: "excluded", label: "不符合" }];
const statusLabels = { matched: "命中", pending: "待核实", excluded: "不符合" };
const statusClasses = { matched: "bg-emerald-50 text-emerald-700", pending: "bg-amber-50 text-amber-800", excluded: "bg-slate-100 text-slate-600" };

function downloadText(name: string, content: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TikTokPage() {
  const [videos, setVideos] = useState<TikTokVideo[]>([]);
  const [productions, setProductions] = useState<Record<string, Production>>({});
  const [mediaAnalyses, setMediaAnalyses] = useState<Record<string, MediaAnalysis>>({});
  const [runs, setRuns] = useState<CollectionRun[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [filters, setFilters] = useState<VideoFilters>(defaultFilters);
  const [view, setView] = useState<View>("all");
  const [mode, setMode] = useState<"keyword" | "links">("keyword");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [continuation, setContinuation] = useState<{ query: string; offset: number; days: number; country: string; provider?: CollectionProvider } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importText, setImportText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    void fetch("/api/tiktok/collect").then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error();
      if (active) setCapabilities(payload.data);
    }).catch(() => { if (active) setMessage("服务状态读取失败，请刷新页面重试。"); });
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed.videos)) throw new Error();
        const savedVideos = mergeVideos([], parsed.videos.map((row: unknown) => normalizeVideo(row)));
        const restored = restoreTikTokBackup(parsed, savedVideos);
        setVideos(savedVideos); setProductions(restored.productions); setMediaAnalyses(restored.mediaAnalyses); setRuns(restored.runs);
        if (restored.warnings.length) setWarnings(restored.warnings);
      }
    } catch { setMessage("本地记录无法读取。现有存储未被覆盖，新导入结果请先导出备份。"); return () => { active = false; }; }
    setHydrated(true);
    const timer = window.setInterval(() => setClock(new Date()), 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify({ videos, productions, mediaAnalyses, runs })); }
    catch { setMessage("浏览器存储空间不足，本次结果尚未保存，请立即导出候选与拍摄包。"); }
  }, [hydrated, videos, productions, mediaAnalyses, runs]);

  const evaluated = useMemo(() => videos.map((video) => ({ video, ...evaluateVideo(video, filters, clock) })), [videos, filters, clock]);
  const shown = evaluated.filter((row) => view === "all" || row.status === view).sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
  const selected = videos.find((video) => video.id === selectedId);
  const selectedEvaluation = evaluated.find((row) => row.video.id === selectedId);
  const canContinue = continuation && mode === "keyword" && query.trim() === continuation.query && filters.days === continuation.days && filters.country === continuation.country;

  function addRows(incoming: TikTokVideo[]) {
    setVideos((current) => mergeVideos(current, incoming));
    setSelectedId((current) => current ?? incoming[0]?.id ?? null);
    setClock(new Date());
  }

  async function collect(next = false) {
    setBusy(true); setMessage("正在采集并核实创作者国家与粉丝数…"); setWarnings([]);
    try {
      const response = await fetch("/api/tiktok/collect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: filters.country, ...(mode === "links" ? { urls: query.split(/\s+/).filter(Boolean) } : { keyword: query.trim(), days: filters.days, limit, offset: next && continuation ? continuation.offset : 0, provider: next && continuation ? continuation.provider : undefined }) })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "采集失败");
      const result = payload.data as Collection;
      addRows(result.videos);
      setRuns((current) => { const { videos: _videos, ...run } = result; return [...current.slice(-9), run]; });
      setWarnings(result.warnings);
      setContinuation(result.hasMore && result.nextOffset !== null ? { query: query.trim(), offset: result.nextOffset, days: filters.days, country: filters.country, provider: result.provider } : null);
      setMessage(`本批读取 ${result.scanned} 条候选，保留 ${result.videos.length} 条视频。${result.hasMore ? "搜索还有后续或尚未完成，详见采集说明。" : "本次搜索已结束。"}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "采集失败"); }
    finally { setBusy(false); }
  }

  function importContent(content: string, format?: "json" | "csv") {
    try {
      const detected = format ?? (/^[\s\uFEFF]*[\[{]/.test(content) ? "json" : "csv");
      const result = importVideos(content, detected);
      const payload = detected === "json" ? JSON.parse(content.replace(/^\uFEFF/, "")) : {};
      const allVideos = mergeVideos(videos, result.videos);
      const restored = restoreTikTokBackup(payload, allVideos, productions, mediaAnalyses);
      addRows(result.videos); setWarnings([...result.errors, ...restored.warnings]);
      setProductions(current => restoreTikTokBackup(payload, allVideos, current).productions);
      setMediaAnalyses(current => restoreTikTokBackup(payload, allVideos, {}, current).mediaAnalyses);
      if (restored.runs.length) setRuns(current => [...current, ...restored.runs.filter(run => !current.some(previous => JSON.stringify(previous) === JSON.stringify(run)))].slice(-10));
      const isBackup = payload && typeof payload === "object" && (payload.productions || payload.mediaAnalyses || payload.runs);
      setMessage(`导入 ${result.videos.length} 条视频，合并 ${result.duplicates} 条重复记录，${result.errors.length} 条无效。${isBackup ? "备份内的有效音画分析、拍摄包与采集历史已恢复。" : ""}`);
      if (result.videos.length) setImportText("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败"); }
  }

  function remove(id: string) {
    setVideos((current) => current.filter((video) => video.id !== id));
    setProductions((current) => { const next = { ...current }; delete next[id]; return next; });
    setMediaAnalyses((current) => { const next = { ...current }; delete next[id]; return next; });
    if (selectedId === id) setSelectedId(null);
    setPendingDeleteId(null);
  }

  return (
    <>
      <PageHeader title="TikTok 爆款视频" description="寻找低粉高播放视频，自动转录与拆解原片音画，改写文案并生成新拍脚本。" action={<Button disabled={!videos.length} icon={<Download className="h-4 w-4" />} onClick={() => downloadText("tiktok-candidates.json", JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), filters, videos, productions, mediaAnalyses, runs }, null, 2), "application/json")}>导出候选与拍摄包</Button>} />

      <Card>
        <CardHeader title="采集与筛选" subtitle="关键词搜索是候选样本；每条视频单独核验，不保证全站覆盖或命中数量。" />
        <CardBody>
          <div className="grid gap-4 lg:grid-cols-[minmax(240px,1fr)_2fr]">
            <div className="space-y-3">
              <label className="block text-sm font-medium">采集方式<select aria-label="采集方式" className={`${fieldClass} mt-1`} value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setQuery(""); setContinuation(null); }}><option value="keyword">按关键词搜索</option><option value="links">按视频链接采集</option></select></label>
              <label className="block text-sm font-medium">{mode === "keyword" ? "搜索关键词" : "完整视频链接（每行一条）"}<textarea aria-label={mode === "keyword" ? "搜索关键词" : "完整视频链接"} className={`${fieldClass} mt-1`} rows={3} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "keyword" ? "输入产品、场景或马来语关键词" : "https://www.tiktok.com/@作者/video/视频ID"} /></label>
              <div className="flex flex-wrap items-center gap-2">
                {mode === "keyword" && <select aria-label="每批候选数" className="rounded-md border border-line p-2 text-sm" value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={20}>每批 20 条候选</option><option value={50}>每批 50 条候选</option></select>}
                <Button variant="primary" disabled={busy || !query.trim() || !capabilities?.collection} icon={<Search className="h-4 w-4" />} onClick={() => void collect()}>{busy ? "核验中…" : "开始采集"}</Button>
                {canContinue && <Button disabled={busy || !capabilities?.collection} onClick={() => void collect(true)}>继续下一批</Button>}
              </div>
              {capabilities && !capabilities.collection && <p className="text-xs leading-5 text-amber-800">尚未配置 ScrapeCreators 或 TikHub 服务，先导入已有数据即可筛选。</p>}
            </div>
            <div className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="text-sm font-medium">账号国家<select aria-label="账号国家" className={`${fieldClass} mt-1`} value={filters.country} onChange={(event) => { setFilters({ ...filters, country: event.target.value }); setContinuation(null); }}><option value="">国家不限</option>{countryOptions.map(country => <option key={country.code} value={country.code}>{country.label}</option>)}</select></label>
              <label className="text-sm font-medium">粉丝上限<input aria-label="粉丝上限" className={`${fieldClass} mt-1`} type="number" min={1} value={filters.maxFollowers} onChange={(event) => setFilters({ ...filters, maxFollowers: Math.max(1, Number(event.target.value)) })} /></label>
              <label className="text-sm font-medium">最低播放<input aria-label="最低播放" className={`${fieldClass} mt-1`} type="number" min={1} value={filters.minViews} onChange={(event) => setFilters({ ...filters, minViews: Math.max(1, Number(event.target.value)) })} /></label>
              <label className="text-sm font-medium">发布时间<select aria-label="发布时间" className={`${fieldClass} mt-1`} value={filters.days} onChange={(event) => setFilters({ ...filters, days: Number(event.target.value) as 3 | 7 })}><option value={7}>近 7 天</option><option value={3}>近 3 天</option></select></label>
              <label className="text-sm font-medium">播放 / 粉丝比<select aria-label="播放粉丝比" className={`${fieldClass} mt-1`} value={filters.maxRatio === 5 ? "3-5" : String(filters.minRatio)} onChange={(event) => setFilters({ ...filters, minRatio: event.target.value === "5" ? 5 : 3, maxRatio: event.target.value === "3-5" ? 5 : null })}><option value="3-5">严格 3–5 倍</option><option value="3">至少 3 倍 · 无上限</option><option value="5">至少 5 倍 · 无上限</option></select></label>
              <label className="text-sm font-medium">类目<input aria-label="类目" className={`${fieldClass} mt-1`} value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })} placeholder="不限；填写后精确匹配" /></label>
              <p className="text-xs leading-5 text-muted sm:col-span-2 xl:col-span-3">倍数 = 播放量 ÷ 当前采集粉丝数。默认至少 3 倍，上不封顶；这项指标不能证明粉丝增长。缺少必要数据会进入“待核实”。</p>
            </div>
          </div>
          <details className="mt-5 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-semibold">导入 JSON / CSV 数据</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted">数字指标使用完整整数，ID 使用字符串；国家和类目按数据来源填写，未知请留空。JSON 可导入 TikHub 原始响应或恢复工作台备份。</p>
              <div className="flex flex-wrap gap-3 text-sm">
                <a className="text-orange-700 underline" href="/templates/tiktok-videos.json" download>下载 JSON 模板</a>
                <a className="text-orange-700 underline" href="/templates/tiktok-videos.csv" download>下载 CSV 模板</a>
                <label className="cursor-pointer text-orange-700 underline">选择文件<input aria-label="选择导入文件" className="sr-only" type="file" accept=".json,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 5_000_000) setMessage("导入文件请控制在 5 MB 内"); else void file.text().then((content) => importContent(content, file.name.toLowerCase().endsWith(".csv") ? "csv" : "json")).catch(() => setMessage("文件读取失败")); } event.target.value = ""; }} /></label>
              </div>
              <textarea aria-label="导入数据" className={fieldClass} rows={5} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="粘贴 JSON 或 CSV 内容" />
              <Button disabled={!importText.trim()} icon={<Upload className="h-4 w-4" />} onClick={() => importContent(importText)}>导入数据</Button>
            </div>
          </details>
        </CardBody>
      </Card>

      {message && <p role="status" className="rounded-md border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-900">{message}</p>}
      {warnings.length > 0 && <details className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><summary className="cursor-pointer">采集 / 导入说明（{warnings.length}）</summary><ul className="mt-2 list-disc space-y-1 pl-5">{warnings.slice(0, 20).map((warning, index) => <li key={index}>{warning}</li>)}</ul>{warnings.length > 20 && <p className="mt-2">更多说明请查看导出文件。</p>}</details>}

      <Card>
        <CardHeader title="视频候选" subtitle={`共 ${videos.length} 条。数据按采集时间保存，刷新后仍保留在当前浏览器。`} />
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">{views.map((item) => <Button key={item.key} variant={view === item.key ? "primary" : "ghost"} onClick={() => setView(item.key)}>{item.label} {item.key === "all" ? videos.length : evaluated.filter((row) => row.status === item.key).length}</Button>)}</div>
        {shown.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-muted"><tr>{["视频 / 作者", "粉丝 / 播放", "倍数", "发布 / 国家", "内容类目", "筛选结果", "操作"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{shown.map(({ video, status, reasons, ratio }) => <tr key={video.id} className={`border-t border-line ${selectedId === video.id ? "bg-orange-50/60" : ""}`}>
          <td className="min-w-[210px] max-w-[310px] px-4 py-4"><a href={video.url} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium text-ink hover:text-orange-700">{video.description || "无视频说明 · 打开原视频"}</a><p className="mt-1 text-xs text-muted">@{video.author} · {video.source}</p><p className="mt-1 text-xs text-muted">采集：{new Date(video.capturedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p></td>
          <td className="whitespace-nowrap px-4 py-4 tabular-nums">{video.followers?.toLocaleString() ?? "待核实"}<br /><span className="text-muted">{video.views?.toLocaleString() ?? "待核实"}</span></td>
          <td className="whitespace-nowrap px-4 py-4 font-medium tabular-nums">{ratio === null ? "—" : `${ratio.toFixed(2)}×`}</td>
          <td className="whitespace-nowrap px-4 py-4">{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Kuala_Lumpur" }) : "发布时间待核实"}<br /><span className="text-muted">{video.country ?? "国家待核实"}</span></td>
          <td className="whitespace-nowrap px-4 py-4">{video.category ?? "类目待核实"}</td>
          <td className="min-w-[145px] px-4 py-4"><span className={`rounded px-2 py-1 text-xs ${statusClasses[status]}`}>{statusLabels[status]}</span>{reasons.length > 0 && <p className="mt-2 max-w-[180px] text-xs leading-5 text-muted">{reasons.join("；")}</p>}</td>
          <td className="whitespace-nowrap px-4 py-4"><Button onClick={() => setSelectedId(video.id)}>拆解与创作</Button>{pendingDeleteId === video.id ? <span className="ml-2 inline-flex gap-2 text-xs"><button className="text-red-700" onClick={() => remove(video.id)}>确认删除</button><button className="text-muted" onClick={() => setPendingDeleteId(null)}>取消</button></span> : <button className="ml-2 text-xs text-muted hover:text-red-600" onClick={() => setPendingDeleteId(video.id)}>删除</button>}</td>
        </tr>)}</tbody></table></div> : <div className="px-5 py-10 text-center text-sm text-muted"><Video className="mx-auto mb-3 h-7 w-7 text-slate-300" />{videos.length ? "当前筛选视图没有视频，可查看待核实或调整条件。" : "从关键词、视频链接或已有数据开始。这里仅展示真实采集或导入的记录。"}</div>}
      </Card>

      {selected && <TikTokProductionWorkspace key={`${selected.id}:${productions[selected.id]?.generatedAt ?? "new"}:${mediaAnalyses[selected.id]?.id ?? "text"}`} video={selected} evaluation={selectedEvaluation} previous={productions[selected.id]} media={mediaAnalyses[selected.id]} enabled={Boolean(capabilities?.production)} mediaEnabled={Boolean(capabilities?.visualAnalysis && capabilities?.transcription)} onSave={(production) => setProductions((current) => ({ ...current, [production.videoId]: production }))} onSaveMedia={(media) => setMediaAnalyses((current) => ({ ...current, [media.videoId]: media }))} />}

    </>
  );
}
