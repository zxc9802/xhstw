import assert from "node:assert/strict";
import test from "node:test";
import { buildLibrary2GenerationHref, library2PrefillPayload } from "../lib/content-library-2/generation";
import type { Library2Item } from "../lib/content-library-2/contracts";

const item: Library2Item = {
  schemaVersion: 1,
  id: "20260825T080000000Z-111111111111",
  ownerId: "local-dev",
  library: "manual",
  platform: "抖音",
  sourceUrl: "https://www.douyin.com/note/1",
  title: "本地试抓取",
  body: "正文可以用来仿写",
  images: [{
    fileId: "001-aaaaaaaaaaaa.png",
    key: "users/local-dev/library2/20260825T080000000Z-111111111111/images/001-aaaaaaaaaaaa.png",
    contentType: "image/png",
    size: 4
  }],
  livePhotos: [{
    order: 0,
    coverFileId: "001-aaaaaaaaaaaa.png",
    videoFileId: "001-bbbbbbbbbbbb.mp4",
    key: "users/local-dev/library2/20260825T080000000Z-111111111111/live/001-bbbbbbbbbbbb.mp4",
    contentType: "video/mp4",
    size: 12
  }],
  createdAt: "2026-08-25T08:00:00.000Z",
  updatedAt: "2026-08-25T09:00:00.000Z"
};

test("library2 fission href reuses the image production prefill contract", () => {
  const href = buildLibrary2GenerationHref(item);
  const url = new URL(href, "https://app.test");
  assert.equal(url.pathname, "/content");
  assert.equal(url.searchParams.get("tab"), "image");
  assert.equal(url.searchParams.get("prefill"), "1");
  assert.equal(url.searchParams.get("from"), "library2");
  assert.equal(url.searchParams.get("library2Id"), item.id);
  assert.equal(url.searchParams.get("title"), item.title);
});

test("library2 prefill carries title, copy, platform and stored images", () => {
  const payload = library2PrefillPayload(item);
  assert.equal(payload.title, "本地试抓取");
  assert.equal(payload.copy, "正文可以用来仿写");
  assert.equal(payload.platform, "抖音");
  assert.equal(payload.url, item.sourceUrl);
  assert.equal(payload.media[0]?.url, `/api/library2/items/${item.id}/media/001-aaaaaaaaaaaa.png`);
  assert.equal(payload.media.length, item.images.length);
  assert.equal(payload.media.some((media) => media.url.endsWith(".mp4")), false);
});
