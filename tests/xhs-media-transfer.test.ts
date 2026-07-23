import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const transfer = require("../browser-extension/shared/media-transfer.js") as {
  MAX_CHUNK_BYTES: number;
  isAllowedMediaUrl(value: string): boolean;
  isAllowedMediaMime(value: string): boolean;
  createAssetKey(topicKey: string, role: string, order: number, sourceUrl: string): Promise<string>;
  buildMediaJobs(topic: any): Array<{ itemIndex: number; role: string; sourceUrl: string }>;
  downloadMedia(input: {
    sourceUrl: string;
    fetchImpl: typeof fetch;
    onChunk(chunk: { chunkIndex: number; data: string; byteLength: number }): Promise<void>;
  }): Promise<{ mimeType: string; byteLength: number; chunkCount: number }>;
};

test("media URL allowlist accepts only official HTTPS hosts", () => {
  assert.equal(transfer.isAllowedMediaUrl("https://ci.xiaohongshu.com/a.jpg"), true);
  assert.equal(transfer.isAllowedMediaUrl("https://sns-webpic-qc.xhscdn.com/a.jpg"), true);
  assert.equal(transfer.isAllowedMediaUrl("https://sns-video-qc.xhscdn.com/a.mp4"), true);
  assert.equal(transfer.isAllowedMediaUrl("http://sns-video-qc.xhscdn.com/a.mp4"), false);
  assert.equal(transfer.isAllowedMediaUrl("https://xhscdn.com.evil.example/a.mp4"), false);
  assert.equal(transfer.isAllowedMediaUrl("https://example.com/a.jpg"), false);
});

test("buildMediaJobs includes every image, video, and video poster in order", () => {
  assert.deepEqual(transfer.buildMediaJobs({
    media: [
      { type: "image", url: "https://ci.xiaohongshu.com/one.jpg" },
      {
        type: "video",
        url: "https://sns-video-qc.xhscdn.com/two.mp4",
        posterUrl: "https://sns-webpic-qc.xhscdn.com/two.jpg"
      }
    ]
  }), [
    { itemIndex: 0, role: "image", sourceUrl: "https://ci.xiaohongshu.com/one.jpg" },
    { itemIndex: 1, role: "video", sourceUrl: "https://sns-video-qc.xhscdn.com/two.mp4" },
    { itemIndex: 1, role: "poster", sourceUrl: "https://sns-webpic-qc.xhscdn.com/two.jpg" }
  ]);
});

test("asset keys are stable and distinguish role and order", async () => {
  const one = await transfer.createAssetKey("xhs:note", "image", 0, "https://ci.xiaohongshu.com/a.jpg");
  const same = await transfer.createAssetKey("xhs:note", "image", 0, "https://ci.xiaohongshu.com/a.jpg");
  const other = await transfer.createAssetKey("xhs:note", "poster", 0, "https://ci.xiaohongshu.com/a.jpg");
  assert.match(one, /^sha256-[0-9a-f]{32}$/);
  assert.equal(one, same);
  assert.notEqual(one, other);
});

test("downloadMedia emits bounded chunks and exact totals", async () => {
  const bytes = new Uint8Array(transfer.MAX_CHUNK_BYTES + 7).map((_, index) => index % 251);
  const chunks: Array<{ chunkIndex: number; data: string; byteLength: number }> = [];
  const result = await transfer.downloadMedia({
    sourceUrl: "https://sns-video-qc.xhscdn.com/a.mp4",
    fetchImpl: async () => new Response(bytes, {
      status: 200,
      headers: { "content-type": "video/mp4" }
    }),
    async onChunk(chunk) { chunks.push(chunk); }
  });
  assert.deepEqual(chunks.map((item) => [item.chunkIndex, item.byteLength]), [[0, transfer.MAX_CHUNK_BYTES], [1, 7]]);
  assert.deepEqual(result, { mimeType: "video/mp4", byteLength: bytes.length, chunkCount: 2 });
  assert.deepEqual(Buffer.concat(chunks.map((item) => Buffer.from(item.data, "base64"))), Buffer.from(bytes));
});

test("downloadMedia rejects non-media responses and redirects outside the allowlist", async () => {
  await assert.rejects(transfer.downloadMedia({
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg",
    fetchImpl: async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    async onChunk() {}
  }), /MEDIA_TYPE_INVALID/);
  await assert.rejects(transfer.downloadMedia({
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: "https://evil.example/a.jpg",
      headers: new Headers({ "content-type": "image/jpeg" }),
      body: new Blob([new Uint8Array([1])]).stream()
    }) as Response,
    async onChunk() {}
  }), /MEDIA_REDIRECT_BLOCKED/);
});
