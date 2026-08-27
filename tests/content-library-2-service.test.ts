import assert from "node:assert/strict";
import test from "node:test";
import type { ContentStorageGateway, StoredObject } from "../lib/content-storage/gateway";
import { userContentsPrefix } from "../lib/content-storage/contracts";
import {
  clearLibrary2Body,
  commitLibrary2Item,
  createLibrary2UploadIntent,
  deleteLibrary2Image,
  deleteLibrary2Item,
  listLibrary2Items
} from "../lib/content-library-2/service";
import { userLibrary2Prefix } from "../lib/content-library-2/contracts";

process.env.APP_SESSION_SECRET = "library2-service-test";

class MemoryGateway implements ContentStorageGateway {
  objects = new Map<string, StoredObject>();

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
    keys.forEach((key) => this.objects.delete(key));
  }
}

test("stores library2 items on a prefix isolated from the finished-content library", async () => {
  const gateway = new MemoryGateway();
  const intent = await createLibrary2UploadIntent("member-a", [{ contentType: "image/png", size: 4 }], gateway, {
    now: new Date("2026-08-25T08:00:00.000Z"),
    ids: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]
  });
  assert.match(intent.uploads[0]!.key, /\/library2\//);
  assert.doesNotMatch(intent.uploads[0]!.key, /\/contents\//);
  assert.equal(intent.uploads[0]!.key.startsWith(userLibrary2Prefix("member-a")), true);
  assert.equal(intent.uploads[0]!.key.startsWith(userContentsPrefix("member-a")), false);

  gateway.objects.set(intent.uploads[0]!.key, { bytes: new Uint8Array(4), contentType: "image/png" });
  const saved = await commitLibrary2Item("member-a", intent.contentId, {
    title: "防晒笔记",
    body: "白天出门记得补涂。",
    platform: "小红书",
    sourceUrl: "https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaa"
  }, intent.uploads, gateway);

  assert.equal(saved.library, "manual");
  assert.equal((await listLibrary2Items("member-a", gateway)).length, 1);
  assert.equal((await listLibrary2Items("member-b", gateway)).length, 0);
  assert.equal([...gateway.objects.keys()].some((key) => key.includes("/contents/")), false);
});

test("can delete one image or only the copy while keeping the rest of the item", async () => {
  const gateway = new MemoryGateway();
  const intent = await createLibrary2UploadIntent("member-a", [
    { contentType: "image/png", size: 4 },
    { contentType: "image/jpeg", size: 6 }
  ], gateway, {
    now: new Date("2026-08-25T08:00:00.000Z"),
    ids: [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    ]
  });
  for (const upload of intent.uploads) {
    gateway.objects.set(upload.key, {
      bytes: new Uint8Array(upload.size),
      contentType: upload.contentType
    });
  }
  await commitLibrary2Item("member-a", intent.contentId, {
    title: "两图一文",
    body: "先删图再删文。",
    platform: "抖音",
    sourceUrl: "https://www.douyin.com/note/123"
  }, intent.uploads, gateway);

  const afterImage = await deleteLibrary2Image("member-a", intent.contentId, intent.uploads[0]!.fileId, gateway);
  assert.equal(afterImage.images.length, 1);
  assert.equal(afterImage.images[0]?.fileId, intent.uploads[1]!.fileId);
  assert.equal(afterImage.body, "先删图再删文。");
  assert.equal(gateway.objects.has(intent.uploads[0]!.key), false);

  const afterBody = await clearLibrary2Body("member-a", intent.contentId, gateway);
  assert.equal(afterBody.body, "");
  assert.equal(afterBody.images.length, 1);
  assert.equal(afterBody.title, "两图一文");

  await deleteLibrary2Item("member-a", intent.contentId, gateway);
  assert.equal((await listLibrary2Items("member-a", gateway)).length, 0);
});
