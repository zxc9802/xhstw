import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/content-library-2/page.tsx", "utf8");
const library1 = readFileSync("app/content-library/page.tsx", "utf8");
const shell = readFileSync("components/layout/AppShell.tsx", "utf8");
const middleware = readFileSync("middleware.ts", "utf8");

test("splits the two content libraries in navigation and keeps library 1 intact", () => {
  assert.equal(shell.includes('{ label: "② 爆款选题库2", href: "/content-library-2"'), true);
  assert.equal(shell.includes('{ label: "④ 内容库1", href: "/content-library"'), true);
  assert.equal(shell.includes("Library2SessionBridge"), true);
  assert.equal(library1.includes('title="内容库1"'), true);
  assert.equal(library1.includes("成品内容库"), true);
  assert.equal(library1.includes("listContentItems"), true);
  assert.equal(library1.includes("listLibrary2Items"), false);
  assert.equal(page.includes("listContentItems"), false);
});

test("library 2 can delete images and copy independently", () => {
  assert.equal(page.includes("删除图片"), true);
  assert.equal(page.includes("删除文案"), true);
  assert.equal(page.includes("deleteLibrary2Image"), true);
  assert.equal(page.includes("clearLibrary2Body"), true);
  assert.equal(page.includes("deleteLibrary2Item"), true);
  assert.equal(page.includes("saveLibrary2Item"), true);
  assert.equal(page.includes("上传到爆款选题库2"), true);
});

test("library 2 previews a Live pair while deleting cover and video together", () => {
  assert.equal(page.includes("livePhotos"), true);
  assert.equal(page.includes(">LIVE<"), true);
  assert.equal(page.includes("<video"), true);
  assert.equal(page.includes("poster="), true);
  assert.equal(page.includes("静态封面和对应视频会一起删除"), true);
});

test("describes library 2 as the current account library instead of local-only storage", () => {
  assert.equal(page.includes("保存到当前登录账号的爆款选题库2"), true);
  assert.equal(page.includes("本机 outputs/content-storage"), false);
});

test("library 2 cards can enter the same fission flow as kept topics", () => {
  assert.equal(page.includes("爆款裂变"), true);
  assert.equal(page.includes("buildLibrary2GenerationHref"), true);
  const content = readFileSync("app/content/page.tsx", "utf8");
  assert.equal(content.includes("library2Id"), true);
  assert.equal(content.includes("getLibrary2Item"), true);
  assert.equal(content.includes("已从爆款选题库2带入参考内容"), true);
});

test("library2 APIs stay reachable for the plugin without SSO bounce", () => {
  assert.equal(middleware.includes('pathname.startsWith("/api/library2")'), true);
});
