import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createXhsTopicMediaStore } from "../lib/xhs-topic-media-store";

const ASSET_KEY = "sha256-0123456789abcdef0123456789abcdef";

test("stores chunks, commits a complete manifest, and restores the exact Blob", async () => {
  const store = createXhsTopicMediaStore(new IDBFactory());
  assert.equal(await store.prepare({
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "image",
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg"
  }), "ready");
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 0, data: "AQI=", byteLength: 2 });
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 1, data: "AwQ=", byteLength: 2 });
  await store.complete({ assetKey: ASSET_KEY, mimeType: "image/jpeg", byteLength: 4, chunkCount: 2 });
  const blob = await store.getBlob(ASSET_KEY);
  assert.equal(blob?.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await blob!.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
});

test("complete media is skipped and aborted media leaves no readable file", async () => {
  const store = createXhsTopicMediaStore(new IDBFactory());
  const start = {
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "video" as const,
    sourceUrl: "https://sns-video-qc.xhscdn.com/a.mp4"
  };
  assert.equal(await store.prepare(start), "ready");
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 0, data: "AQ==", byteLength: 1 });
  await store.complete({ assetKey: ASSET_KEY, mimeType: "video/mp4", byteLength: 1, chunkCount: 1 });
  assert.equal(await store.prepare(start), "skip");

  const second = "sha256-fedcba9876543210fedcba9876543210";
  await store.prepare({ ...start, assetKey: second });
  await store.writeChunk({ assetKey: second, chunkIndex: 0, data: "Ag==", byteLength: 1 });
  await store.abort(second);
  assert.equal(await store.getBlob(second), null);
});

test("rejects wrong order and totals and deletes all selected files", async () => {
  const store = createXhsTopicMediaStore(new IDBFactory());
  await store.prepare({
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "poster",
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg"
  });
  await assert.rejects(store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 1, data: "AQ==", byteLength: 1 }), /chunk order/i);
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 0, data: "AQ==", byteLength: 1 });
  await assert.rejects(store.complete({ assetKey: ASSET_KEY, mimeType: "image/jpeg", byteLength: 2, chunkCount: 1 }), /byte length/i);
  await store.abort(ASSET_KEY);
  assert.equal(await store.getBlob(ASSET_KEY), null);
});

test("cleans chunks abandoned by a canceled or closed page", async () => {
  const store = createXhsTopicMediaStore(new IDBFactory());
  await store.prepare({
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "image",
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg"
  });
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 0, data: "AQ==", byteLength: 1 });
  assert.equal(await store.cleanupIncomplete(), 1);
  assert.equal(await store.prepare({
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "image",
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg"
  }), "ready");
});
