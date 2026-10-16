import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { analyzeTikTokVideo, loadMediaAnalysis } from "../lib/tiktok/media";

const id = "7550000000000000001";
const video = { id, url: `https://www.tiktok.com/@example/video/${id}`, author: "example" };
const fakeMp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftyp"), Buffer.alloc(2000)]);
const output = {
  inputRecognized: true, durationSeconds: 17.2,
  transcript: { speechDetected: true, language: "zh", segments: [{ start: 0, end: 17, text: "这是原视频的说明。" }] },
  summary: { hook: "实物", structure: "介绍", visual: "桌面人物", audio: "清晰人声", editing: "固定机位", pacing: "快节奏", onScreenText: "字幕", callToAction: "收尾", limits: "细字须审核" },
  timeline: [{ start: 0, end: 17.2, visual: "人物演示", audio: "讲解", onScreenText: "字幕", editing: "固定机位" }], warnings: []
};

async function setup(t: TestContext, region = "MY") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tiktok-media-test-"));
  const previous = process.env.TIKTOK_REWRITE_API_KEY;
  process.env.TIKTOK_REWRITE_API_KEY = "test-key";
  t.after(async () => {
    if (previous === undefined) delete process.env.TIKTOK_REWRITE_API_KEY; else process.env.TIKTOK_REWRITE_API_KEY = previous;
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const phases: string[] = [], commands: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.tikhub.io") {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key");
      assert.equal(url.searchParams.get("region"), region);
      return Response.json({ code: 200, data: { status_code: 0, aweme_detail: { aweme_id: id, author: { unique_id: "example" }, video: { duration: 17200, play_addr: { url_list: ["https://v19.tiktokcdn.com/source.mp4"] } } } } });
    }
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return new Response(fakeMp4, { headers: { "Content-Type": "video/mp4" } });
  }) as typeof fetch;
  const runCommand = async (command: string, args: string[]) => {
    commands.push(command);
    assert.ok(args.every(arg => !arg.includes("https://")));
    if (command.includes("ffprobe")) return JSON.stringify({ format: { duration: "17.2" }, streams: [{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: "aac" }] });
    if (args.at(-1)?.endsWith("model.mp4")) await fs.writeFile(args.at(-1)!, fakeMp4);
    return "";
  };
  return { root, phases, commands, apiKey: "test-key", fetcher, runCommand, onProgress: (message: string) => phases.push(message), requester: async () => output };
}

test("verified source, whole decode, bounded model video and source-bound cache form one media workflow", async t => {
  const options = await setup(t);
  const result = await analyzeTikTokVideo({ video }, options);
  assert.equal(result.basis, "video_audio");
  assert.equal(result.videoId, id);
  assert.equal(result.transcript.text, "这是原视频的说明。");
  assert.equal(result.evidence.decoded, true);
  assert.equal(result.evidence.temporaryMediaRemoved, true);
  assert.ok(options.commands.length >= 3);
  assert.ok(options.phases.some(phase => phase.includes("转录")));
  assert.deepEqual(await loadMediaAnalysis(result.id, video, options.root), result);
  const files = await fs.readdir(path.join(options.root, result.id));
  assert.ok(!files.some(file => /\.(mp4|wav)$/.test(file)));
  await assert.rejects(loadMediaAnalysis("../../.env.local", video, options.root), /分析/);
  await assert.rejects(loadMediaAnalysis(result.id, { ...video, id: "7550000000000000002", url: "https://www.tiktok.com/@example/video/7550000000000000002" }, options.root), /对应|一致/);
});

test("original media uses the video's known account country instead of forcing MY", async t => {
  const options = await setup(t, "US");
  const result = await analyzeTikTokVideo({ video: { ...video, country: "US" } }, options);
  assert.equal(result.videoId, id);
  assert.equal(result.basis, "video_audio");
});

test("ScrapeCreators original-media details work without TikHub and keys never reach the CDN", async t => {
  const options = await setup(t);
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.scrapecreators.com") {
      assert.equal(new Headers(init?.headers).get("x-api-key"), "sc-test-key");
      assert.equal(url.searchParams.get("url"), video.url);
      return Response.json({ success: true, aweme_detail: { aweme_id: id, author: { unique_id: "example" }, video: { duration: 17200, play_addr: { url_list: ["https://v19.tiktokcdn.com/source.mp4"] } } } });
    }
    assert.equal(url.hostname, "v19.tiktokcdn.com");
    assert.equal(new Headers(init?.headers).has("x-api-key"), false);
    return options.fetcher(input, init);
  }) as typeof fetch;
  const result = await analyzeTikTokVideo({ video }, { ...options, apiKey: "", scrapeCreatorsApiKey: "sc-test-key", fetcher });
  assert.equal(result.evidence.provider, "scrapecreators");
  assert.equal(result.evidence.temporaryMediaRemoved, true);
});

test("original-media metadata automatically falls back from ScrapeCreators to TikHub", async t => {
  const options = await setup(t);
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => new URL(String(input)).hostname === "api.scrapecreators.com"
    ? new Response("unavailable", { status: 503 }) : options.fetcher(input, init)) as typeof fetch;
  const result = await analyzeTikTokVideo({ video }, { ...options, scrapeCreatorsApiKey: "sc-test-key", fetcher });
  assert.equal(result.evidence.provider, "tikhub");
  assert.ok(options.phases.some(message => message.includes("已切换 TikHub")));
});

test("HTTP 200 HTML payloads, mismatched IDs and excess duration never become media analysis", async t => {
  const options = await setup(t);
  const originalFetcher = options.fetcher;
  const htmlFetcher = (async (url: RequestInfo | URL, init?: RequestInit) => String(url).includes("api.tikhub.io") ? originalFetcher(url, init) : new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })) as typeof fetch;
  await assert.rejects(analyzeTikTokVideo({ video }, { ...options, fetcher: htmlFetcher }), /媒体|视频/);
  assert.equal(options.commands.length, 0);
  await assert.rejects(analyzeTikTokVideo({ video }, { ...options, fetcher: (async () => Response.json({ code: 200, data: { aweme_detail: { aweme_id: "7550000000000000002" } } })) as typeof fetch }), /身份|对应|一致/);
  await assert.rejects(analyzeTikTokVideo({ video }, { ...options, runCommand: async () => JSON.stringify({ format: { duration: "300" }, streams: [{ codec_type: "video", codec_name: "h264" }] }) }), /180|时长/);
});

test("media redirects cannot request internal or untrusted hosts", async t => {
  const options = await setup(t);
  const originalFetcher = options.fetcher;
  let unsafeRequested = false;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.tikhub.io") return originalFetcher(input, init);
    if (url.hostname === "127.0.0.1") unsafeRequested = true;
    return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
  }) as typeof fetch;
  await assert.rejects(analyzeTikTokVideo({ video }, { ...options, fetcher }), /媒体|视频|地址/);
  assert.equal(unsafeRequested, false);
});
