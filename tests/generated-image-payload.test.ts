import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { materializeGeneratedImagePayload } from "../lib/utils/generated-image-payload";

test("remote generated images are embedded before the API response leaves the server", async () => {
  const payload = await materializeGeneratedImagePayload(
    { images: [{ id: "image-1", url: "https://cdn.example.com/temporary.jpg" }] },
    async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })
  );

  assert.deepEqual(payload, {
    images: [{ id: "image-1", url: "data:image/jpeg;base64,AQID" }]
  });
});

test("already embedded generated images are kept without another fetch", async () => {
  let fetchCount = 0;
  const payload = await materializeGeneratedImagePayload(
    { images: ["data:image/png;base64,AQID"] },
    async () => {
      fetchCount += 1;
      return new Response();
    }
  );

  assert.deepEqual(payload, { images: ["data:image/png;base64,AQID"] });
  assert.equal(fetchCount, 0);
});

test("the generation route materializes provider URLs before responding", () => {
  const routeSource = readFileSync("app/api/image/generate/route.ts", "utf8");
  assert.equal(routeSource.includes("materializeGeneratedImagePayload(rawResult)"), true);
});
