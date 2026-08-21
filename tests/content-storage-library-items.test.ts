import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudContentItem,
  mergeContentLibraryItems,
  parseLegacyContentItems
} from "../lib/content-storage/library-items";
import type { StoredContentManifest } from "../lib/content-storage/contracts";

test("parses old browser content without writing or migrating it", () => {
  const items = parseLegacyContentItems(JSON.stringify([{
    id: "legacy-1",
    title: "浏览器旧标题",
    summary: "旧摘要",
    body: "旧正文",
    platform: "小红书",
    account: "旧账号",
    type: "小红书长图文",
    mediaKind: "image",
    mediaUrls: ["cps-image://cover"],
    pages: [{ images: ["cps-image://page-2", "cps-image://cover"] }],
    tags: ["旧内容"],
    status: "已保存本地",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:30:00.000Z"
  }]));

  assert.equal(items.length, 1);
  assert.equal(items[0].source, "browser");
  assert.equal(items[0].title, "浏览器旧标题");
  assert.deepEqual(items[0].imageUrls, ["cps-image://cover", "cps-image://page-2"]);
  assert.deepEqual(items[0].videoUrls, []);
});

test("prefers the COS row when browser and cloud content share an id", () => {
  const manifest: StoredContentManifest = {
    schemaVersion: 1,
    id: "same-id",
    ownerId: "member-1",
    title: "COS 标题",
    summary: "",
    body: "COS 正文",
    platform: "小红书",
    account: "云端账号",
    type: "图文",
    mediaKind: "image",
    media: [{ storage: "cos", fileId: "001-a.jpg", key: "users/member-1/contents/same-id/images/001-a.jpg", contentType: "image/jpeg", size: 10 }],
    pages: [],
    referenceSources: [],
    tags: [],
    folder: null,
    prompts: [],
    negativePrompts: [],
    status: "可发布",
    systemState: "active",
    duplicateRate: 0,
    duplicateLabel: "",
    lowFlowRisk: "低",
    checkAdvice: [],
    reviewNotes: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z"
  };
  const browser = parseLegacyContentItems(JSON.stringify([{
    id: "same-id",
    title: "本地旧标题",
    body: "本地正文",
    mediaKind: "image",
    createdAt: "2026-07-01T10:00:00.000Z"
  }]));

  const merged = mergeContentLibraryItems([cloudContentItem(manifest)], browser);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "cos");
  assert.equal(merged[0].title, "COS 标题");
  assert.deepEqual(merged[0].imageUrls, ["/api/content-storage/items/same-id/media/001-a.jpg"]);
});

test("ignores malformed or incompatible legacy payloads", () => {
  assert.deepEqual(parseLegacyContentItems("not-json"), []);
  assert.deepEqual(parseLegacyContentItems(JSON.stringify({ id: "not-an-array" })), []);
  assert.deepEqual(parseLegacyContentItems(JSON.stringify([{ title: "missing id" }])), []);
});
