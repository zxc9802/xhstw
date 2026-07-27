import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET } from "../app/api/image/reference/[token]/route";
import {
  IMAGE_REFERENCE_TTL_MS,
  publishImageReferences
} from "../lib/adapters/image-reference-store";
import { middleware } from "../middleware";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

test("allows image providers to fetch temporary references without an SSO session", async () => {
  const response = await middleware(
    new NextRequest("https://xhstw.qycm.top/api/image/reference/test-token")
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("streams a stored reference with image safety headers", async () => {
  const published = publishImageReferences([PNG_DATA_URL], "https://app.test");
  const response = await GET(new Request(published.urls[0]), {
    params: Promise.resolve({ token: published.tokens[0] })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [137, 80, 78, 71, 13, 10, 26, 10]
  );
});

test("returns 404 for unknown and expired tokens", async () => {
  const unknown = await GET(new Request("https://app.test/api/image/reference/missing"), {
    params: Promise.resolve({ token: "missing" })
  });
  assert.equal(unknown.status, 404);

  const published = publishImageReferences(
    [PNG_DATA_URL],
    "https://app.test",
    Date.now() - IMAGE_REFERENCE_TTL_MS - 1
  );
  const expired = await GET(new Request(published.urls[0]), {
    params: Promise.resolve({ token: published.tokens[0] })
  });
  assert.equal(expired.status, 404);
});
