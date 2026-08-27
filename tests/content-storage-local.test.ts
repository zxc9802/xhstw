import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isLocalContentStorageEnabled, LocalFileGateway } from "../lib/content-storage/local";

test("writes library2 objects to the local disk instead of COS", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "xhstw-local-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gateway = new LocalFileGateway(root);
  const key = "users/local-dev/library2/20260825T080000000Z-aaaaaaaaaaaa/images/001-bbbbbbbbbbbb.png";

  await gateway.putObject(key, new Uint8Array([1, 2, 3, 4]), "image/png");
  assert.deepEqual(await gateway.headObject(key), { contentType: "image/png", size: 4 });
  assert.deepEqual([...(await gateway.getObject(key))!.bytes], [1, 2, 3, 4]);

  await gateway.putJson(
    "users/local-dev/library2/20260825T080000000Z-aaaaaaaaaaaa/manifest.json",
    { id: "item-1", library: "manual" }
  );
  const keys = await gateway.listKeys("users/local-dev/library2/");
  assert.equal(keys.includes(key), true);
  assert.equal(keys.some((item) => item.endsWith("manifest.json")), true);
  assert.equal(keys.some((item) => item.endsWith(".meta.json")), false);

  await gateway.deleteKeys([key]);
  assert.equal(await gateway.headObject(key), undefined);
});

test("uses local storage when COS secrets are missing", () => {
  const previous = {
    CONTENT_STORAGE: process.env.CONTENT_STORAGE,
    TENCENT_COS_SECRET_ID: process.env.TENCENT_COS_SECRET_ID,
    TENCENT_COS_SECRET_KEY: process.env.TENCENT_COS_SECRET_KEY
  };
  try {
    delete process.env.CONTENT_STORAGE;
    delete process.env.TENCENT_COS_SECRET_ID;
    delete process.env.TENCENT_COS_SECRET_KEY;
    assert.equal(isLocalContentStorageEnabled(), true);
    process.env.CONTENT_STORAGE = "cos";
    process.env.TENCENT_COS_SECRET_ID = "id";
    process.env.TENCENT_COS_SECRET_KEY = "key";
    assert.equal(isLocalContentStorageEnabled(), false);
    process.env.CONTENT_STORAGE = "local";
    assert.equal(isLocalContentStorageEnabled(), true);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
