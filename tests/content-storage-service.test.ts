import assert from "node:assert/strict";
import test from "node:test";
import type { ContentStorageGateway, StoredObject } from "../lib/content-storage/gateway";
import {
  commitContent,
  createUploadIntent,
  deleteContent,
  getContentMedia,
  listContents
} from "../lib/content-storage/service";
import type { ContentDraft } from "../lib/content-storage/contracts";

class MemoryGateway implements ContentStorageGateway {
  objects = new Map<string, StoredObject>();

  async createPutUrl(key: string) {
    return `https://upload.test/${encodeURIComponent(key)}`;
  }

  async headObject(key: string) {
    const value = this.objects.get(key);
    return value ? { contentType: value.contentType, size: value.bytes.byteLength } : undefined;
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
  gateway.objects.set(intent.uploads[0].key, {
    bytes: new Uint8Array(4),
    contentType: "image/png"
  });

  const saved = await commitContent("member-a", intent.contentId, draft, intent.uploads, gateway, new Date("2026-08-21T06:01:00.000Z"));

  assert.equal(saved.ownerId, "member-a");
  assert.deepEqual((await listContents("member-a", gateway)).map((item) => item.id), [intent.contentId]);
  assert.deepEqual(await listContents("member-b", gateway), []);
  assert.equal(await getContentMedia("member-b", intent.contentId, intent.uploads[0].fileId, gateway), undefined);
  assert.equal((await getContentMedia("member-a", intent.contentId, intent.uploads[0].fileId, gateway))?.contentType, "image/png");
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
