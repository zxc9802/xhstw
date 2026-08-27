import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_REFERENCE_TTL_MS,
  MAX_IMAGE_REFERENCE_BYTES,
  ImageReferenceInputError,
  deleteImageReferences,
  getImageReference,
  publishImageReferences
} from "../lib/adapters/image-reference-store";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const TEMP_ASSET_URL = /^https:\/\/app\.test\/temp-assets\/\d+-[0-9a-f-]{36}\.png\?exp=\d+&sig=[A-Za-z0-9_-]+$/;

function publishedFilename(url: string) {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
}

test("publishes local data images as signed temp-asset URLs", () => {
  const now = 1_000;
  const result = publishImageReferences(
    [PNG_DATA_URL, "https://img.test/existing.jpg"],
    "https://app.test",
    now
  );

  assert.equal(result.urls.length, 2);
  assert.match(result.urls[0], TEMP_ASSET_URL);
  assert.equal(new URL(result.urls[0]).searchParams.get("exp"), String(now + IMAGE_REFERENCE_TTL_MS));
  assert.equal(result.urls[1], "https://img.test/existing.jpg");
  assert.equal(result.tokens.length, 1);
  assert.equal(result.tokens[0], publishedFilename(result.urls[0]));

  const stored = getImageReference(result.tokens[0], now);
  assert.equal(stored?.contentType, "image/png");
  assert.deepEqual([...stored!.bytes], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(stored?.expiresAt, now + IMAGE_REFERENCE_TTL_MS);
  deleteImageReferences(result.tokens);
});

test("uses PUBLIC_BASE_URL when publishing local references", () => {
  const previous = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://cdn.example.com";
  try {
    const result = publishImageReferences([PNG_DATA_URL], "https://app.test", 1_000);
    assert.match(
      result.urls[0],
      /^https:\/\/cdn\.example\.com\/temp-assets\/\d+-[0-9a-f-]{36}\.png\?exp=\d+&sig=[A-Za-z0-9_-]+$/
    );
    deleteImageReferences(result.tokens);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previous;
  }
});

test("deletes references explicitly and expires stale references", () => {
  const removed = publishImageReferences([PNG_DATA_URL], "https://app.test", 1_000);
  deleteImageReferences(removed.tokens);
  assert.equal(getImageReference(removed.tokens[0], 1_000), undefined);

  const expired = publishImageReferences([PNG_DATA_URL], "https://app.test", 2_000);
  assert.equal(
    getImageReference(expired.tokens[0], 2_000 + IMAGE_REFERENCE_TTL_MS + 1),
    undefined
  );
});

test("rejects malformed and unsupported local image data", () => {
  for (const source of [
    "blob:https://app.test/local",
    "data:image/gif;base64,R0lGODlh",
    "data:image/png;base64,***"
  ]) {
    assert.throws(
      () => publishImageReferences([source], "https://app.test"),
      (error) => error instanceof ImageReferenceInputError && error.status === 400
    );
  }
});

test("rejects a single image above the memory limit", () => {
  const oversized = Buffer.alloc(MAX_IMAGE_REFERENCE_BYTES + 1).toString("base64");
  assert.throws(
    () => publishImageReferences(
      [`data:image/jpeg;base64,${oversized}`],
      "https://app.test"
    ),
    (error) => error instanceof ImageReferenceInputError && error.status === 413
  );
});

test("rejects a request above the aggregate memory limit", () => {
  const nearLimit = `data:image/jpeg;base64,${Buffer.alloc(MAX_IMAGE_REFERENCE_BYTES).toString("base64")}`;
  assert.throws(
    () => publishImageReferences(
      [nearLimit, nearLimit, nearLimit, nearLimit, PNG_DATA_URL],
      "https://app.test"
    ),
    (error) => error instanceof ImageReferenceInputError && error.status === 413
  );
});

test("requires a public HTTPS origin only when a local image must be published", () => {
  assert.throws(
    () => publishImageReferences([PNG_DATA_URL], "http://localhost:3000"),
    (error) => error instanceof ImageReferenceInputError && error.status === 400
  );
  assert.deepEqual(
    publishImageReferences(["https://img.test/existing.jpg"], "http://localhost:3000").urls,
    ["https://img.test/existing.jpg"]
  );
});
