import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { generateTikTokProduction } from "../lib/tiktok/production";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateMediaOutput } from "../lib/tiktok/media-format";
import { restoreTikTokBackup } from "../lib/tiktok/backup";
import { normalizeVideo } from "../lib/tiktok/videos";

const video = { id: "7550000000000000001", url: "https://www.tiktok.com/@example/video/7550000000000000001", description: "A simple daily routine", author: "example" };
const output = {
  analysis: { hook: "文字中的问题钩子", structure: "提出问题、展示步骤、收尾", whyItWorks: "结构假设，需实拍验证", adaptation: "替换场景", limits: "未查看音视频" },
  rewrite: { title: "A daily routine", caption: "Try a simple routine.", voiceover: "Here is how I prepare my day." },
  shots: [{ start: 0, end: 15, visual: "桌面近景", voiceover: "Here is how I prepare my day.", onScreenText: "Daily routine" }, { start: 15, end: 30, visual: "人物中景", voiceover: "Try it for yourself.", onScreenText: "Try it" }],
  preparation: ["桌面", "手机"], warnings: ["文字建议需人工审核"]
};

function configured(t: TestContext) {
  const previous = { TIKTOK_REWRITE_API_KEY: process.env.TIKTOK_REWRITE_API_KEY };
  process.env.TIKTOK_REWRITE_API_KEY = "test-key";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test("creation uses text evidence and marks suggestions as a new shooting plan", async (t) => {
  configured(t);
  let prompt = "";
  const result = await generateTikTokProduction({ video, sourceText: "My actual transcript. First I prepare the table, then I show the routine.", language: "en", duration: 30, productFacts: "No verified claims", requirements: "one person" }, async (messages) => {
    prompt = messages.map((message) => message.content).join("\n");
    return output;
  });
  assert.match(prompt, /未观看/);
  assert.match(prompt, /不可信资料/);
  assert.match(prompt, /不得虚构/);
  assert.match(prompt, /No verified claims/);
  assert.match(prompt, /拍摄要求.*硬性约束/);
  assert.equal(result.basis, "text_only");
  assert.equal(result.videoId, video.id);
  assert.equal(result.shots.length, 2);
  assert.ok(result.warnings.some((warning) => warning.includes("新拍")));
});

test("missing credentials and empty reference text fail instead of returning canned drafts", async (t) => {
  configured(t);
  const requester = async () => output;
  await assert.rejects(generateTikTokProduction({ video, sourceText: "", duration: 30, language: "en" }, requester), /文字资料/);
  delete process.env.TIKTOK_REWRITE_API_KEY;
  await assert.rejects(generateTikTokProduction({ video, sourceText: "Some reference transcript", duration: 30, language: "en" }, requester), /TIKTOK_REWRITE/);
});

test("malformed JSON, incorrect shot timing and incomplete fields cannot become successful outputs", async (t) => {
  configured(t);
  const input = { video, sourceText: "Some reference transcript", duration: 30, language: "en" };
  for (const bad of [{}, { ...output, rewrite: {} }, { ...output, shots: [{ ...output.shots[0], end: 50 }] }, { ...output, shots: [{ ...output.shots[0], start: 1 }, output.shots[1]] }, { ...output, shots: [{ ...output.shots[0], start: NaN }, output.shots[1]] }]) {
    await assert.rejects(generateTikTokProduction(input, async () => bad), /结构|分镜/);
  }
});

test("English or Malay spoken copy cannot silently contain Chinese", async (t) => {
  configured(t);
  await assert.rejects(generateTikTokProduction({ video, sourceText: "Some reference transcript", duration: 30, language: "ms" }, async () => ({ ...output, rewrite: { ...output.rewrite, voiceover: "中文口播" } })), /语言/);
});

test("a requested media analysis cannot be ignored or loaded through an arbitrary path", async t => {
  configured(t);
  await assert.rejects(generateTikTokProduction({ video, sourceText: "Some reference transcript", duration: 30, language: "en", mediaAnalysisId: "../../.env.local" }, async () => output), /原视频分析/);
});

test("verified silent and brief-speech originals can produce and restore drafts without fabricated transcripts", async t => {
  configured(t);
  const id = randomUUID(), root = path.resolve("outputs/tiktok-media"), directory = path.join(root, id);
  await fs.mkdir(directory, { recursive: true });
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(root + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
  for (const speech of [false, true]) {
    const fields = validateMediaOutput({ inputRecognized: true, durationSeconds: 15, transcript: { speechDetected: speech, language: speech ? "en" : null, segments: speech ? [{ start: 1, end: 2, text: "Hi." }] : [] }, summary: { hook: "展示", structure: "观察", visual: "桌面", audio: speech ? "短人声" : "无音轨", editing: "单镜头", pacing: "缓慢", onScreenText: "无字幕", callToAction: "无引导", limits: "待核对" }, timeline: [{ start: 0, end: 15, visual: "桌面", audio: speech ? "短人声" : "无音轨", onScreenText: "", editing: "单镜头" }], warnings: [] }, 15, speech);
    const media = { ...fields, id, videoId: video.id, author: video.author, url: video.url, capturedAt: "2026-10-13T00:00:00Z", generatedAt: "2026-10-13T00:00:01Z", model: "gemini-3.8-flash", duration: 15, basis: "video_audio", evidence: { metadataId: video.id, sourceField: "video.play_addr", sourceUrlSha256: "a".repeat(64), videoSha256: "b".repeat(64), modelVideoSha256: "c".repeat(64), bytes: 2000, modelBytes: 1500, videoCodec: "h264", audioCodec: speech ? "aac" : null, hasAudio: speech, decoded: true, temporaryMediaRemoved: true } };
    await fs.writeFile(path.join(directory, "analysis.json"), JSON.stringify(media));
    const result = await generateTikTokProduction({ video, mediaAnalysisId: id, sourceText: speech ? "Hi." : "桌面", duration: 30, language: "en" }, async () => output);
    assert.equal(result.basis, "video_audio");
    assert.equal(result.media?.transcript.text, speech ? "Hi." : "");
    const restored = restoreTikTokBackup({ productions: { [video.id]: result }, mediaAnalyses: { [video.id]: media } }, [normalizeVideo(video)]);
    assert.deepEqual(restored.productions[video.id], result); assert.deepEqual(restored.warnings, []);
  }
});
