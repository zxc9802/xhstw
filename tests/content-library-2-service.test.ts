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
  getLibrary2Media,
  listLibrary2Items
} from "../lib/content-library-2/service";
import { library2ManifestKey, userLibrary2Prefix } from "../lib/content-library-2/contracts";

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
  }, intent.uploads, [], gateway);

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
  }, intent.uploads, [], gateway);

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

test("creates ordered Live upload targets bound to their static covers", async () => {
  const gateway = new MemoryGateway();
  const intent = await createLibrary2UploadIntent("member-a", {
    images: [
      { contentType: "image/jpeg", size: 4 },
      { contentType: "image/jpeg", size: 5 }
    ],
    livePhotos: [
      { order: 0, coverIndex: 0, contentType: "video/mp4", size: 12 },
      { order: 1, coverIndex: 1, contentType: "video/mp4", size: 14 }
    ]
  }, gateway, {
    now: new Date("2026-08-27T08:00:00.000Z"),
    ids: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555"
    ]
  });

  assert.equal(intent.liveUploads.length, 2);
  assert.equal(intent.liveUploads[0]!.coverFileId, intent.uploads[0]!.fileId);
  assert.equal(intent.liveUploads[1]!.coverFileId, intent.uploads[1]!.fileId);
  assert.match(intent.liveUploads[0]!.key, /\/library2\/.*\/live\/001-[0-9a-f]{12}\.mp4$/);
  assert.match(intent.liveUploads[0]!.uploadUrl, /\/live\/001-[0-9a-f]{12}\.mp4\/upload\?token=/);
});

test("rejects invalid, duplicate, dangling, and oversized Live descriptors", async () => {
  const gateway = new MemoryGateway();
  const images = [
    { contentType: "image/jpeg", size: 4 },
    { contentType: "image/jpeg", size: 4 }
  ];
  const valid = [
    { order: 0, coverIndex: 0, contentType: "video/mp4", size: 12 },
    { order: 1, coverIndex: 1, contentType: "video/mp4", size: 12 }
  ];

  await assert.rejects(createLibrary2UploadIntent("member-a", { images, livePhotos: [valid[0], { ...valid[1], order: 0 }] }, gateway), /顺序/);
  await assert.rejects(createLibrary2UploadIntent("member-a", { images, livePhotos: [valid[0], { ...valid[1], coverIndex: 0 }] }, gateway), /封面/);
  await assert.rejects(createLibrary2UploadIntent("member-a", { images, livePhotos: [{ ...valid[0], coverIndex: 2 }] }, gateway), /封面/);
  await assert.rejects(createLibrary2UploadIntent("member-a", { images, livePhotos: [{ ...valid[0], contentType: "video/webm" }] }, gateway), /MP4/);
  await assert.rejects(createLibrary2UploadIntent("member-a", { images, livePhotos: [{ ...valid[0], size: 100 * 1024 * 1024 + 1 }] }, gateway), /100 MB/);

  await assert.rejects(createLibrary2UploadIntent("member-a", {
    images: Array.from({ length: 6 }, () => ({ contentType: "image/jpeg", size: 4 })),
    livePhotos: Array.from({ length: 6 }, (_, index) => ({
      order: index,
      coverIndex: index,
      contentType: "video/mp4",
      size: 90 * 1024 * 1024
    }))
  }, gateway), /500 MB/);
});

test("keeps old image-only manifests readable without a Live migration", async () => {
  const gateway = new MemoryGateway();
  const contentId = "20260827T080000000Z-aaaaaaaaaaaa";
  await gateway.putJson(library2ManifestKey("member-a", contentId), {
    schemaVersion: 1,
    id: contentId,
    ownerId: "member-a",
    library: "manual",
    platform: "小红书",
    sourceUrl: "",
    title: "旧图文",
    body: "旧清单没有 livePhotos",
    images: [],
    createdAt: "2026-08-27T08:00:00.000Z",
    updatedAt: "2026-08-27T08:00:00.000Z"
  });

  const [item] = await listLibrary2Items("member-a", gateway);
  assert.equal(item?.title, "旧图文");
  assert.equal(item?.livePhotos, undefined);
});

test("commits Live pairs only after every object exists and deletes a pair with its cover", async () => {
  const gateway = new MemoryGateway();
  const intent = await createLibrary2UploadIntent("member-a", {
    images: [
      { contentType: "image/jpeg", size: 4 },
      { contentType: "image/jpeg", size: 5 }
    ],
    livePhotos: [
      { order: 0, coverIndex: 0, contentType: "video/mp4", size: 12 },
      { order: 1, coverIndex: 1, contentType: "video/mp4", size: 12 }
    ]
  }, gateway);
  for (const upload of intent.uploads) {
    gateway.objects.set(upload.key, { bytes: new Uint8Array(upload.size), contentType: upload.contentType });
  }
  gateway.objects.set(intent.liveUploads[0]!.key, { bytes: new Uint8Array(12), contentType: "video/mp4" });
  const draft = {
    title: "完整 Live",
    body: "两组 Live",
    platform: "小红书",
    sourceUrl: "https://www.xiaohongshu.com/explore/6a8f682f000000002503f464"
  };

  await assert.rejects(
    commitLibrary2Item("member-a", intent.contentId, draft, intent.uploads, intent.liveUploads, gateway),
    /第 2 个 Live 视频尚未上传/
  );
  assert.equal(await gateway.getJson(library2ManifestKey("member-a", intent.contentId)), undefined);

  gateway.objects.set(intent.liveUploads[1]!.key, { bytes: new Uint8Array(12), contentType: "video/mp4" });
  const saved = await commitLibrary2Item("member-a", intent.contentId, draft, intent.uploads, intent.liveUploads, gateway);
  assert.deepEqual(saved.livePhotos?.map((pair) => [pair.order, pair.coverFileId, pair.videoFileId]), [
    [0, intent.uploads[0]!.fileId, intent.liveUploads[0]!.fileId],
    [1, intent.uploads[1]!.fileId, intent.liveUploads[1]!.fileId]
  ]);
  assert.equal((await getLibrary2Media("member-a", intent.contentId, intent.liveUploads[0]!.fileId, gateway))?.contentType, "video/mp4");
  assert.equal(await getLibrary2Media("member-b", intent.contentId, intent.liveUploads[0]!.fileId, gateway), undefined);

  const afterDelete = await deleteLibrary2Image("member-a", intent.contentId, intent.uploads[0]!.fileId, gateway);
  assert.equal(afterDelete.images.length, 1);
  assert.deepEqual(afterDelete.livePhotos?.map((pair) => pair.coverFileId), [intent.uploads[1]!.fileId]);
  assert.equal(gateway.objects.has(intent.uploads[0]!.key), false);
  assert.equal(gateway.objects.has(intent.liveUploads[0]!.key), false);

  await deleteLibrary2Item("member-a", intent.contentId, gateway);
  assert.equal(gateway.objects.has(intent.uploads[1]!.key), false);
  assert.equal(gateway.objects.has(intent.liveUploads[1]!.key), false);
  assert.equal(await gateway.getJson(library2ManifestKey("member-a", intent.contentId)), undefined);
});
