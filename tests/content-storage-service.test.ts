import assert from "node:assert/strict";
import test from "node:test";
import type { ContentStorageGateway, StoredObject } from "../lib/content-storage/gateway";
import {
  commitContent,
  createReplacementUploadIntent,
  createUploadIntent,
  deleteContent,
  getContentMedia,
  listContents,
  replaceContent
} from "../lib/content-storage/service";
import type { ContentDraft } from "../lib/content-storage/contracts";

process.env.APP_SESSION_SECRET = "content-storage-service-test";

class MemoryGateway implements ContentStorageGateway {
  objects = new Map<string, StoredObject>();
  rejectDeletes = false;

  async headObject(key: string) {
    const value = this.objects.get(key);
    return value ? { contentType: value.contentType, size: value.bytes.byteLength } : undefined;
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes, contentType });
  }

  async putJson(key: string, value: unknown) {
    this.objects.set(key, {
      bytes: new TextEncoder().encode(JSON.stringify(value)),
      contentType: "application/json; charset=utf-8"
    });
  }

  async getJson(key: string) {
    const value = this.objects.get(key);
    return value ? JSON.parse(new TextDecoder().decode(value.bytes)) : undefined;
  }

  async listKeys(prefix: string) {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }

  async getObject(key: string) {
    return this.objects.get(key);
  }

  async deleteKeys(keys: string[]) {
    if (this.rejectDeletes) throw new Error("COS cleanup failed");
    keys.forEach((key) => this.objects.delete(key));
  }
}

const draft: ContentDraft = {
  title: "COS 成品",
  summary: "摘要",
  body: "最终正文",
  platform: "小红书",
  account: "测试账号",
  type: "小红书长图文",
  mediaKind: "image",
  pages: [],
  referenceSources: [],
  tags: ["COS"],
  folder: null,
  prompts: [],
  negativePrompts: [],
  status: "需复查",
  duplicateRate: 0,
  duplicateLabel: "待检测",
  lowFlowRisk: "低",
  checkAdvice: [],
  reviewNotes: [],
  externalVideoUrls: []
};

test("commits selected images and lists them only for the authenticated member", async () => {
  const gateway = new MemoryGateway();
  const intent = await createUploadIntent("member-a", [{ contentType: "image/png", size: 4 }], gateway, {
    now: new Date("2026-08-21T06:00:00.000Z"),
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  const uploadUrl = new URL(intent.uploads[0].uploadUrl, "https://app.test");
  assert.equal(uploadUrl.pathname, `/api/content-storage/items/${intent.contentId}/media/${intent.uploads[0].fileId}/upload`);
  assert.ok(uploadUrl.searchParams.get("token"));
  gateway.objects.set(intent.uploads[0].key, {
    bytes: new Uint8Array(4),
    contentType: "image/png"
  });

  const saved = await commitContent(
    "member-a",
    intent.contentId,
    { ...draft, legacySourceId: "legacy-browser-row" },
    intent.uploads,
    gateway,
    new Date("2026-08-21T06:01:00.000Z")
  );

  assert.equal(saved.ownerId, "member-a");
  assert.equal(saved.legacySourceId, "legacy-browser-row");
  assert.deepEqual((await listContents("member-a", gateway)).map((item) => item.id), [intent.contentId]);
  assert.deepEqual(await listContents("member-b", gateway), []);
  assert.equal(await getContentMedia("member-b", intent.contentId, intent.uploads[0].fileId, gateway), undefined);
  assert.equal((await getContentMedia("member-a", intent.contentId, intent.uploads[0].fileId, gateway))?.contentType, "image/png");
});

test("commits when COS HeadObject returns a charset-suffixed content type", async () => {
  const gateway = new MemoryGateway();
  const intent = await createUploadIntent("member-a", [{ contentType: "image/png", size: 4 }], gateway, {
    now: new Date("2026-08-21T06:00:00.000Z"),
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  gateway.objects.set(intent.uploads[0].key, {
    bytes: new Uint8Array(4),
    contentType: "image/png; charset=utf-8"
  });

  const saved = await commitContent("member-a", intent.contentId, draft, intent.uploads, gateway);
  assert.equal(saved.media[0]?.storage, "cos");
});

test("does not write a manifest when an uploaded image is missing or mismatched", async () => {
  const gateway = new MemoryGateway();
  const intent = await createUploadIntent("member-a", [{ contentType: "image/webp", size: 5 }], gateway, {
    now: new Date("2026-08-21T06:00:00.000Z"),
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });

  await assert.rejects(() => commitContent("member-a", intent.contentId, draft, intent.uploads, gateway), /尚未上传/);
  assert.deepEqual(await listContents("member-a", gateway), []);
});

test("deletes only the current member manifest and referenced images", async () => {
  const gateway = new MemoryGateway();
  const intent = await createUploadIntent("member-a", [{ contentType: "image/jpeg", size: 2 }], gateway, {
    now: new Date("2026-08-21T06:00:00.000Z"),
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  gateway.objects.set(intent.uploads[0].key, { bytes: new Uint8Array(2), contentType: "image/jpeg" });
  await commitContent("member-a", intent.contentId, draft, intent.uploads, gateway);

  await deleteContent("member-b", intent.contentId, gateway);
  assert.equal((await listContents("member-a", gateway)).length, 1);
  await deleteContent("member-a", intent.contentId, gateway);
  assert.deepEqual(await listContents("member-a", gateway), []);
  assert.equal(gateway.objects.has(intent.uploads[0].key), false);
});

test("replaces COS images in the submitted order and removes the old objects", async () => {
  const gateway = new MemoryGateway();
  const originalIntent = await createUploadIntent("member-a", [
    { contentType: "image/jpeg", size: 2 },
    { contentType: "image/png", size: 3 }
  ], gateway, {
    now: new Date("2026-08-21T06:00:00.000Z"),
    ids: [
      "11111111-2222-4333-8444-555555555555",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
    ]
  });
  originalIntent.uploads.forEach((upload) => {
    gateway.objects.set(upload.key, { bytes: new Uint8Array(upload.size), contentType: upload.contentType });
  });
  const original = await commitContent(
    "member-a",
    originalIntent.contentId,
    draft,
    originalIntent.uploads,
    gateway,
    new Date("2026-08-21T06:01:00.000Z")
  );

  const replacementIntent = await createReplacementUploadIntent(
    "member-a",
    original.id,
    [
      { contentType: "image/webp", size: 4 },
      { contentType: "image/png", size: 5 }
    ],
    gateway,
    {
      ids: [
        "cccccccc-dddd-4eee-8fff-111111111111",
        "dddddddd-eeee-4fff-8111-222222222222"
      ]
    }
  );
  replacementIntent.uploads.forEach((upload) => {
    gateway.objects.set(upload.key, { bytes: new Uint8Array(upload.size), contentType: upload.contentType });
  });

  const updated = await replaceContent(
    "member-a",
    original.id,
    { ...draft, title: "调整后成品" },
    replacementIntent.uploads,
    gateway,
    new Date("2026-08-21T07:00:00.000Z")
  );

  assert.equal(updated.title, "调整后成品");
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.updatedAt, "2026-08-21T07:00:00.000Z");
  assert.deepEqual(updated.media.map((media) => media.fileId), replacementIntent.uploads.map((upload) => upload.fileId));
  assert.deepEqual(updated.media.flatMap((media) => media.storage === "cos" ? [media.contentType] : []), ["image/webp", "image/png"]);
  assert.equal(originalIntent.uploads.some((upload) => gateway.objects.has(upload.key)), false);
});

test("cannot create replacement uploads for another member content", async () => {
  const gateway = new MemoryGateway();
  const intent = await createUploadIntent("member-a", [], gateway, {
    now: new Date("2026-08-21T06:00:00.000Z"),
    ids: ["11111111-2222-4333-8444-555555555555"]
  });
  await commitContent("member-a", intent.contentId, draft, [], gateway);

  await assert.rejects(
    () => createReplacementUploadIntent("member-b", intent.contentId, [], gateway),
    /内容不存在/
  );
});

test("keeps a successful replacement successful when stale object cleanup fails", async () => {
  const gateway = new MemoryGateway();
  const originalIntent = await createUploadIntent("member-a", [{ contentType: "image/png", size: 1 }], gateway, {
    now: new Date("2026-08-21T06:00:00.000Z"),
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  gateway.objects.set(originalIntent.uploads[0].key, { bytes: new Uint8Array(1), contentType: "image/png" });
  await commitContent("member-a", originalIntent.contentId, draft, originalIntent.uploads, gateway);
  const replacementIntent = await createReplacementUploadIntent(
    "member-a",
    originalIntent.contentId,
    [{ contentType: "image/webp", size: 2 }],
    gateway,
    { ids: ["bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"] }
  );
  gateway.objects.set(replacementIntent.uploads[0].key, { bytes: new Uint8Array(2), contentType: "image/webp" });
  gateway.rejectDeletes = true;

  const saved = await replaceContent("member-a", originalIntent.contentId, draft, replacementIntent.uploads, gateway);

  assert.deepEqual(saved.media.flatMap((media) => media.storage === "cos" ? [media.contentType] : []), ["image/webp"]);
  assert.deepEqual((await listContents("member-a", gateway))[0].media.map((media) => media.fileId), [replacementIntent.uploads[0].fileId]);
});
