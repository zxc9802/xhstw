import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET } from "../app/temp-assets/[filename]/route";
import {
  IMAGE_REFERENCE_TTL_MS,
  deleteImageReferences,
  publishImageReferences
} from "../lib/adapters/image-reference-store";
import { middleware } from "../middleware";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

function filenameFromUrl(url: string) {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
}

test("allows image providers to fetch temp-asset references without an SSO session", async () => {
  const response = await middleware(
    new NextRequest("https://xhstw.qycm.top/temp-assets/test-file.png")
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("streams a stored reference from a signed temp-asset URL", async () => {
  const published = publishImageReferences([PNG_DATA_URL], "https://app.test");
  const response = await GET(new Request(published.urls[0]), {
    params: Promise.resolve({ filename: filenameFromUrl(published.urls[0]) })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [137, 80, 78, 71, 13, 10, 26, 10]
  );
  deleteImageReferences(published.tokens);
});

test("returns 400 for unsigned URLs and 410 for expired temp assets", async () => {
  const unknown = await GET(new Request("https://app.test/temp-assets/missing.png"), {
    params: Promise.resolve({ filename: "missing.png" })
  });
  assert.equal(unknown.status, 400);

  const published = publishImageReferences(
    [PNG_DATA_URL],
    "https://app.test",
    Date.now() - IMAGE_REFERENCE_TTL_MS - 1
  );
  const expired = await GET(new Request(published.urls[0]), {
    params: Promise.resolve({ filename: filenameFromUrl(published.urls[0]) })
  });
  assert.equal(expired.status, 410);
  deleteImageReferences(published.tokens);
});
