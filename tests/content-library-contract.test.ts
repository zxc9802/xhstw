import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/content-library/page.tsx", "utf8");

test("loads only the signed-in member cloud library", () => {
  assert.equal(source.includes("listContentItems"), true);
  assert.equal(source.includes("StoredContentManifest"), true);
  assert.equal(source.includes("finishedContentsSeed"), false);
  assert.equal(source.includes("FINISHED_CONTENT_STORAGE_KEY"), false);
  assert.equal(source.includes("window.localStorage"), false);
});

test("reads private images through the app proxy and deletes through the API", () => {
  assert.equal(source.includes("contentMediaUrl"), true);
  assert.equal(source.includes("deleteContentItem"), true);
  assert.equal(source.includes("persistImageFile"), false);
  assert.equal(source.includes("localPath"), false);
  assert.equal(source.includes("已保存本地"), false);
});

test("keeps explicit local export for cloud content", () => {
  assert.equal(source.includes("导出到本地"), true);
  assert.equal(source.includes("writeBlobFiles"), true);
  assert.equal(source.includes("utf8TextBlob"), true);
  assert.equal(source.includes('name: "标题和文案.txt"'), true);
  assert.equal(source.includes("标题：${item.title}"), true);
  assert.equal(source.includes("文案：\\n${item.body}"), true);
});

test("card and detail images open one top-level preview", () => {
  assert.equal(source.includes("previewImageUrl"), true);
  assert.equal(source.includes("setPreviewImageUrl"), true);
  assert.equal(source.includes("z-[80]"), true);
});

test("local image export excludes video-only projects", () => {
  assert.equal(source.includes('if (item.mediaKind !== "image") return [];'), true);
});
