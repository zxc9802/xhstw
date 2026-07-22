import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/content-library/page.tsx", "utf8");

test("finished library exports real images to the selected local folder", () => {
  assert.equal(source.includes("导出到本地文件夹"), true);
  assert.equal(source.includes("导入本地文件夹"), false);
  assert.equal(source.includes("selectExportTargets"), true);
  assert.equal(source.includes("writeBlobFiles"), true);
  assert.equal(source.includes("当前为本地 mock 导出"), false);
});

test("card and detail images open one top-level preview", () => {
  assert.equal(source.includes("previewImageUrl"), true);
  assert.equal(source.includes("setPreviewImageUrl"), true);
  assert.equal(source.includes("z-[80]"), true);
});

test("table action menu does not nest interactive buttons", () => {
  assert.equal(source.includes('<button title="更多操作" className="group relative'), false);
  assert.equal(source.includes('<div className="group relative inline-flex'), true);
});
