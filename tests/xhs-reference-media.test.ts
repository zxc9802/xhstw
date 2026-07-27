import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";

const helperPath = "lib/xhs-reference-media.ts";

test("collected reference media keeps local asset keys and prefers local Blob URLs", async () => {
  assert.equal(existsSync(helperPath), true, "reference media helper is missing");
  const helper = await import(pathToFileURL(helperPath).href) as {
    normalizeXhsReferenceMedia(media: unknown): Array<{ url: string; localAssetKey?: string }>;
    loadXhsReferenceMediaBlob(
      media: { url: string; localAssetKey?: string },
      store: { getBlob(assetKey: string): Promise<Blob | null> }
    ): Promise<Blob | null>;
    loadXhsReferenceMediaObjectUrls(
      media: Array<{ url: string; localAssetKey?: string }>,
      store: { getBlob(assetKey: string): Promise<Blob | null> },
      createObjectUrl: (blob: Blob) => string
    ): Promise<Map<string, string>>;
    resolveXhsReferenceMedia(
      media: Array<{ url: string; localAssetKey?: string }>,
      objectUrls: ReadonlyMap<string, string>
    ): Array<{ url: string; localAssetKey?: string }>;
  };
  const assetKey = "sha256-0123456789abcdef0123456789abcdef";
  const media = helper.normalizeXhsReferenceMedia([{
    type: "image",
    url: "https://ci.xiaohongshu.com/expired.jpg",
    localAssetKey: assetKey
  }]);

  assert.equal(media[0].localAssetKey, assetKey);
  assert.equal(
    (await helper.loadXhsReferenceMediaBlob(
      media[0],
      { async getBlob(key) { return key === assetKey ? new Blob(["image"], { type: "image/jpeg" }) : null; } }
    ))?.type,
    "image/jpeg"
  );
  const objectUrls = await helper.loadXhsReferenceMediaObjectUrls(
    media,
    { async getBlob(key) { return key === assetKey ? new Blob(["image"], { type: "image/jpeg" }) : null; } },
    (blob) => `blob:${blob.type}`
  );
  assert.equal(helper.resolveXhsReferenceMedia(media, objectUrls)[0].url, "blob:image/jpeg");
});

test("content page rehydrates collected reference media from IndexedDB", () => {
  const source = readFileSync("app/content/page.tsx", "utf8");
  assert.match(source, /createXhsTopicMediaStore\(\)/);
  assert.match(source, /loadXhsReferenceMediaObjectUrls/);
  assert.match(source, /resolvedReferenceMedia/);
});

test("content generation uses stored reference bytes and never silently drops failed references", () => {
  const source = readFileSync("app/content/page.tsx", "utf8");
  assert.match(source, /loadXhsReferenceMediaBlob/);
  assert.match(source, /imageRefToUploadUrl\(asset\.storageUrl \?\? asset\.url\)/);
  assert.match(source, /小红书参考图本地数据不存在，请重新通过插件采集/);
  assert.doesNotMatch(source, /imageUrlForModelRequest\(item\.url\)\.catch\(\(\) => ""\)/);
  assert.match(source, /selectedSources\.map\(\(item\) => imageUrlForModelRequest\(item\)\)/);
});
