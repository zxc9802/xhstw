import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/content-library/page.tsx", "utf8");

test("loads current-member COS content and browser legacy content without writing new content locally", () => {
  assert.equal(source.includes("listContentItems"), true);
  assert.equal(source.includes("LEGACY_FINISHED_CONTENT_STORAGE_KEY"), true);
  assert.equal(source.includes("parseLegacyContentItems"), true);
  assert.equal(source.includes("mergeContentLibraryItems"), true);
  assert.equal(source.includes("window.localStorage.getItem(LEGACY_FINISHED_CONTENT_STORAGE_KEY)"), true);
  assert.equal(source.includes("finishedContentsSeed"), false);
  assert.equal(source.includes("window.localStorage.setItem(FINISHED_CONTENT_STORAGE_KEY"), false);
  assert.equal(source.includes("localStorage.removeItem"), false);
  assert.equal(source.includes("localStorage.clear"), false);
});

test("deletes COS and browser rows from cards, table rows, and details", () => {
  assert.equal(source.includes("resolveImageRefs"), true);
  assert.equal(source.includes("deleteContentItem"), true);
  assert.equal(source.includes("deleteLegacyContentItem"), true);
  assert.equal(source.includes("deleteImageRef"), true);
  assert.equal(source.includes("window.localStorage.setItem(LEGACY_FINISHED_CONTENT_STORAGE_KEY"), true);
  assert.equal(source.includes('item.source === "cos" ? <Button variant="danger"'), false);
  assert.equal(source.match(/void removeItem\(/g)?.length, 3);
  assert.equal(source.includes('title="删除内容"'), true);
  assert.equal(source.includes("浏览器旧内容"), true);
});

test("restores COS image upload, drag ordering, and Feishu sync", () => {
  assert.equal(source.includes("replaceContentDraft"), true);
  assert.equal(source.includes("reorderImageUrls"), true);
  assert.equal(source.includes("添加本地图片"), true);
  assert.equal(source.includes("拖动图片可调整顺序"), true);
  assert.equal(source.includes("同步到飞书"), true);
  assert.equal(source.includes("contentId: item.id"), true);
});

test("restores the previous content-library layout and operations", () => {
  for (const marker of [
    "成品内容库",
    "卡片视图",
    "表格视图",
    "筛选区",
    "页面文件夹",
    "多选",
    "批量导出",
    "发布平台",
    "发布账号"
  ]) {
    assert.equal(source.includes(marker), true, `missing classic UI marker: ${marker}`);
  }
  assert.equal(source.includes("DataTable"), true);
  assert.equal(source.includes("CardHeader"), true);
  assert.equal(source.includes("matchesTimeFilter(item.createdAt, filters.time)"), true);
  assert.equal(source.includes("新建临时页面文件夹"), false);
});

test("allows legacy rows to open the image editor and migrates edits to COS", () => {
  assert.equal(source.includes("saveContentDraft"), true);
  assert.equal(source.includes("legacyContentDraft"), true);
  assert.equal(source.includes("openEditor(item)"), true);
  assert.equal(source.includes('item.source === "cos" && item.mediaKind === "image"'), false);
  assert.equal(source.includes("已迁移到 COS"), true);
});

test("keeps explicit local export for cloud content", () => {
  assert.equal(source.includes("导出到本地"), true);
  assert.equal(source.includes("writeBlobFiles"), true);
  assert.equal(source.includes("utf8TextBlob"), true);
  assert.equal(source.includes('name: "标题和文案.txt"'), true);
  assert.equal(source.includes("标题：${item.title}"), true);
  assert.equal(source.includes("文案：\\n${item.body}"), true);
  assert.equal(source.includes("exportItemsToLocal(targets)"), true);
  assert.equal(source.includes("for (const item of targets) await chooseLocalExportFolder(item)"), false);
  assert.equal(source.includes("`${safeFileName(item.title)}_${safeFileName(item.id)}`"), true);
});

test("card and detail images open one top-level preview", () => {
  assert.equal(source.includes("previewImageUrl"), true);
  assert.equal(source.includes("setPreviewImageUrl"), true);
  assert.equal(source.includes("z-[80]"), true);
});

test("local image export excludes video-only projects", () => {
  assert.equal(source.includes('if (item.mediaKind !== "image") return [];'), true);
});
