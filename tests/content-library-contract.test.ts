import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/content-library/page.tsx", "utf8");

test("loads current-member COS content and read-only browser legacy content", () => {
  assert.equal(source.includes("listContentItems"), true);
  assert.equal(source.includes("LEGACY_FINISHED_CONTENT_STORAGE_KEY"), true);
  assert.equal(source.includes("parseLegacyContentItems"), true);
  assert.equal(source.includes("mergeContentLibraryItems"), true);
  assert.equal(source.includes("window.localStorage.getItem(LEGACY_FINISHED_CONTENT_STORAGE_KEY)"), true);
  assert.equal(source.includes("finishedContentsSeed"), false);
  assert.equal(source.includes("localStorage.setItem"), false);
  assert.equal(source.includes("localStorage.removeItem"), false);
  assert.equal(source.includes("localStorage.clear"), false);
});

test("resolves legacy IndexedDB images and deletes only COS rows", () => {
  assert.equal(source.includes("resolveImageRefs"), true);
  assert.equal(source.includes("deleteContentItem"), true);
  assert.equal(source.includes('item.source === "cos"'), true);
  assert.equal(source.includes("浏览器旧内容"), true);
  assert.equal(source.includes("persistImageFile"), false);
  assert.equal(source.includes("localPath"), false);
});

test("restores COS image upload, drag ordering, and Feishu sync", () => {
  assert.equal(source.includes("replaceContentDraft"), true);
  assert.equal(source.includes("reorderImageUrls"), true);
  assert.equal(source.includes("添加本地图片"), true);
  assert.equal(source.includes("拖动图片可调整顺序"), true);
  assert.equal(source.includes("同步到飞书"), true);
  assert.equal(source.includes("contentId: item.id"), true);
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
