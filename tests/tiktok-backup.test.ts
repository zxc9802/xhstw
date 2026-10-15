import assert from "node:assert/strict";
import test from "node:test";
import { restoreTikTokBackup } from "../lib/tiktok/backup";
import { importVideos } from "../lib/tiktok/videos";
import type { Production } from "../lib/tiktok/production";
import { validateMediaOutput, type MediaAnalysis } from "../lib/tiktok/media-format";

const id = "7550000000000000001";
const video = { id, url: `https://www.tiktok.com/@example/video/${id}`, author: "example", capturedAt: "2026-10-13T02:00:00Z" };
const production: Production = {
  videoId: id, generatedAt: "2026-10-13T03:00:00Z", basis: "text_only", model: "gemini-3.8-flash",
  language: "en", duration: 15, sourceText: "Here is my actual reference transcript.", productFacts: "", requirements: "one phone",
  analysis: { hook: "问题", structure: "步骤", whyItWorks: "假设", adaptation: "改写", limits: "仅文字" },
  rewrite: { title: "Daily routine", caption: "Try this routine", voiceover: "Prepare the table and start your day." },
  shots: [{ start: 0, end: 15, visual: "桌面近景", voiceover: "Prepare the table and start your day.", onScreenText: "Daily routine" }],
  preparation: ["手机"], warnings: []
};
const run = { scanned: 1, warnings: [], hasMore: false, nextOffset: null, capturedAt: "2026-10-13T02:00:00Z", evidencePages: [], keyword: "routine" };
const media: MediaAnalysis = { ...video, videoId: id, id: "12345678-1234-1234-1234-123456789abc", basis: "video_audio", generatedAt: production.generatedAt, model: "gemini-3.8-flash", duration: 15,
  ...validateMediaOutput({ inputRecognized: true, durationSeconds: 15, transcript: { speechDetected: true, language: "en", segments: [{ start: 0, end: 15, text: "Prepare the table and start your day." }] }, summary: Object.fromEntries(["hook", "structure", "visual", "audio", "editing", "pacing", "onScreenText", "callToAction", "limits"].map(key => [key, key])), timeline: [{ start: 0, end: 15, visual: "Table", audio: "Speech", editing: "One shot", onScreenText: "Routine" }], warnings: [] }, 15, true),
  evidence: { metadataId: id, sourceField: "video.play_addr", sourceUrlSha256: "a".repeat(64), videoSha256: "b".repeat(64), modelVideoSha256: "c".repeat(64), bytes: 2000, modelBytes: 1500, videoCodec: "h264", audioCodec: "aac", hasAudio: true, decoded: true, temporaryMediaRemoved: true } };

test("audio visual backup preserves the original analysis snapshot and rejects a different source", () => {
  const videos = importVideos(JSON.stringify([video]), "json").videos;
  const draft = { ...production, basis: "video_audio" as const, media };
  const restored = restoreTikTokBackup({ mediaAnalyses: { [id]: media }, productions: { [id]: draft } }, videos);
  assert.deepEqual(restored.mediaAnalyses[id], media);
  assert.deepEqual(restored.productions[id], draft);
  for (const bad of [undefined, { ...media, author: "another" }, { ...media, videoId: "7550000000000000002" }]) {
    const invalid = restoreTikTokBackup({ mediaAnalyses: { [id]: bad }, productions: { [id]: { ...draft, media: bad } } }, videos);
    assert.deepEqual(invalid.mediaAnalyses, {});
    assert.deepEqual(invalid.productions, {});
    assert.equal(invalid.warnings.length, 2);
  }
});

test("full exported backup restores paired videos, drafts and collection history", () => {
  const text = JSON.stringify({ version: 1, videos: [video], productions: { [id]: production }, runs: [run] });
  const imported = importVideos(text, "json");
  const restored = restoreTikTokBackup(JSON.parse(text), imported.videos);
  assert.deepEqual(restored.productions[id], production);
  assert.deepEqual(restored.runs, [run]);
  assert.deepEqual(restored.warnings, []);
});

test("older drafts do not replace newer results and corrupt or mismatched drafts cannot reach the UI", () => {
  const videos = importVideos(JSON.stringify([video]), "json").videos;
  const current = { ...production, generatedAt: "2026-10-13T04:00:00Z" };
  assert.deepEqual(restoreTikTokBackup({ productions: { [id]: production } }, videos, { [id]: current }).productions[id], current);
  for (const bad of [{ ...production, videoId: "7550000000000000002" }, { ...production, shots: [{ ...production.shots[0], end: 20 }] }, { ...production, analysis: null }, { ...production, rewrite: { ...production.rewrite, voiceover: "中文" } }, { ...production, generatedAt: "bad" }]) {
    const restored = restoreTikTokBackup({ productions: { [id]: bad } }, videos);
    assert.deepEqual(restored.productions, {});
    assert.equal(restored.warnings.length, 1);
  }
  assert.deepEqual(restoreTikTokBackup({ productions: { unknown: production }, runs: [{ ...run, scanned: -1 }] }, videos).productions, {});
  assert.deepEqual(restoreTikTokBackup({}, videos).runs, []);
});
