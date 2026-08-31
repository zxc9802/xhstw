import assert from "node:assert/strict";
import test from "node:test";
import { storedMediaResponse } from "../lib/content-storage/media-response";

test("serves stored image bytes with a canonical content type", async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const response = storedMediaResponse({
    bytes,
    contentType: "image/png; charset=utf-8"
  });

  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Content-Length"), "4");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
});

test("does not leak bytes from a larger backing buffer", async () => {
  const backing = Uint8Array.from([9, 1, 2, 3, 4, 8]);
  const response = storedMediaResponse({
    bytes: backing.subarray(1, 5),
    contentType: "image/jpeg"
  });

  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
});
