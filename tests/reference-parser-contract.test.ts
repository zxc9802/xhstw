import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("lib/adapters/reference-parser.ts", "utf8");

test("Xiaohongshu parsing reads media from the exact OpenCLI download output", () => {
  assert.equal(source.includes('const downloadRoot = createXiaohongshuDownloadRoot(url);'), true);
  assert.equal(source.includes('runOpenCli(["xiaohongshu", "download", url, "--output", downloadRoot])'), true);
  assert.equal(source.includes("mediaFromFolderTree(downloadRoot)"), true);
});

test("Xiaohongshu parsing does not rely on a guessed note-id folder", () => {
  assert.equal(source.includes("downloadedMediaForXiaohongshu(url)"), false);
  assert.equal(source.includes("latestDownloadedXiaohongshuMedia(downloadStartedAt)"), false);
});
