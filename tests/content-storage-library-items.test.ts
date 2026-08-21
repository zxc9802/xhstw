import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudContentItem,
  deleteLegacyContentItem,
  editableContentDraft,
  legacyContentDraft,
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
    duplicateRate: 18,
    duplicateLabel: "低风险",
    lowFlowRisk: "中",
    localPath: "outputs/legacy-1",
    prompts: ["旧提示词"],
    negativePrompts: ["旧反向词"],
    checkAdvice: ["旧建议"],
    reviewNotes: ["旧审核记录"],
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:30:00.000Z"
  }]));

  assert.equal(items.length, 1);
  assert.equal(items[0].source, "browser");
  assert.equal(items[0].title, "浏览器旧标题");
  assert.deepEqual(items[0].imageUrls, ["cps-image://cover", "cps-image://page-2"]);
  assert.deepEqual(items[0].videoUrls, []);
  assert.equal(items[0].duplicateRate, 18);
  assert.equal(items[0].lowFlowRisk, "中");
  assert.equal(items[0].localPath, "outputs/legacy-1");
  assert.deepEqual(items[0].prompts, ["旧提示词"]);
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

test("builds an editable draft without losing stored metadata", () => {
  const manifest = cloudContentItem({
    schemaVersion: 1,
    id: "same-id",
    ownerId: "member-1",
    title: "原标题",
    summary: "原摘要",
    body: "原正文",
    platform: "小红书",
    account: "账号",
    type: "图文",
    mediaKind: "image",
    media: [{ storage: "external", fileId: "video-1", mediaType: "video", url: "https://example.com/video.mp4" }],
    pages: [], referenceSources: [], tags: ["原标签"], folder: "文件夹", prompts: ["提示词"], negativePrompts: [],
    status: "可发布", systemState: "active", duplicateRate: 1, duplicateLabel: "低重复", lowFlowRisk: "低",
    checkAdvice: ["建议"], reviewNotes: ["备注"],
    createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z"
  }).manifest!;

  const draft = editableContentDraft(manifest, { title: "新标题", body: "新正文", tags: ["新标签"] });

  assert.equal(draft.title, "新标题");
  assert.equal(draft.summary, "原摘要");
  assert.deepEqual(draft.prompts, ["提示词"]);
  assert.deepEqual(draft.externalVideoUrls, ["https://example.com/video.mp4"]);
});

test("builds a COS draft when a browser legacy row is edited", () => {
  const legacy = parseLegacyContentItems(JSON.stringify([{
    id: "legacy-migrate",
    title: "旧标题",
    summary: "旧摘要",
    body: "旧正文",
    platform: "小红书",
    account: "旧账号",
    type: "小红书长图文",
    mediaKind: "image",
    tags: ["旧标签"],
    prompts: ["提示词"],
    status: "已保存本地",
    createdAt: "2026-07-01T10:00:00.000Z"
  }]))[0];

  const draft = legacyContentDraft(legacy, { title: "新标题", body: "新正文", tags: ["新标签"] });

  assert.equal(draft.legacySourceId, "legacy-migrate");
  assert.equal(draft.title, "新标题");
  assert.equal(draft.summary, "旧摘要");
  assert.deepEqual(draft.prompts, ["提示词"]);
  assert.equal(draft.status, "需复查");
});

test("hides a browser legacy row after its COS migration exists", () => {
  const browser = parseLegacyContentItems(JSON.stringify([{
    id: "legacy-migrate",
    title: "浏览器旧标题",
    body: "旧正文",
    mediaKind: "image",
    createdAt: "2026-07-01T10:00:00.000Z"
  }]));
  const migratedManifest: StoredContentManifest = {
    schemaVersion: 1,
    id: "20260821T123456789Z-550e8400e29b",
    ownerId: "member-1",
    legacySourceId: "legacy-migrate",
    title: "迁移后标题",
    summary: "",
    body: "迁移后正文",
    platform: "小红书",
    account: "账号",
    type: "图文",
    mediaKind: "image",
    media: [], pages: [], referenceSources: [], tags: [], folder: null, prompts: [], negativePrompts: [],
    status: "需复查", systemState: "active", duplicateRate: 0, duplicateLabel: "待检测", lowFlowRisk: "低",
    checkAdvice: [], reviewNotes: [], createdAt: "2026-08-21T12:34:56.789Z", updatedAt: "2026-08-21T12:34:56.789Z"
  };

  const merged = mergeContentLibraryItems([cloudContentItem(migratedManifest)], browser);

  assert.deepEqual(merged.map((item) => item.title), ["迁移后标题"]);
});

test("deletes one legacy row while preserving other raw records and returning local image refs", () => {
  const raw = JSON.stringify([
    {
      id: "legacy-delete",
      title: "待删除",
      mediaUrls: ["cps-image://cover", "https://example.com/remote.jpg"],
      pages: [{ images: ["cps-image://page-2", "cps-image://cover"] }],
      customField: "保持原始结构"
    },
    { id: "legacy-keep", title: "保留", customField: { nested: true } }
  ]);

  const result = deleteLegacyContentItem(raw, "legacy-delete");

  assert.deepEqual(JSON.parse(result.serialized), [
    { id: "legacy-keep", title: "保留", customField: { nested: true } }
  ]);
  assert.deepEqual(result.imageRefs, ["cps-image://cover", "cps-image://page-2"]);
});
