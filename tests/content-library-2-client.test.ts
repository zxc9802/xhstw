import assert from "node:assert/strict";
import test from "node:test";
import { saveLibrary2Item } from "../lib/content-library-2/client";

test("library2 client uploads images then commits to the manual library", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method });
    if (url === "/api/library2/upload-intents") {
      return Response.json({
        ok: true,
        data: {
          contentId: "20260825T080000000Z-111111111111",
          uploads: [{
            fileId: "001-aaaaaaaaaaaa.png",
            key: "users/member/library2/20260825T080000000Z-111111111111/images/001-aaaaaaaaaaaa.png",
            contentType: "image/png",
            size: 4,
            uploadUrl: "/api/library2/items/20260825T080000000Z-111111111111/media/001-aaaaaaaaaaaa.png/upload?token=t"
          }]
        }
      });
    }
    if (url.includes("/upload?token=")) return Response.json({ ok: true, data: { uploaded: true } });
    if (url.endsWith("/commit")) return Response.json({ ok: true, data: { id: "saved", library: "manual" } });
    throw new Error(`unexpected ${url}`);
  };

  await saveLibrary2Item({
    title: "手动上传",
    body: "文案",
    platform: "小红书",
    sourceUrl: "https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaa"
  }, [new Blob([new Uint8Array(4)], { type: "image/png" })], { fetcher: fetcher as typeof fetch });

  assert.deepEqual(calls.map((call) => call.method), ["POST", "PUT", "POST"]);
  assert.equal(calls[0]?.url.startsWith("/api/library2/"), true);
  assert.equal(calls.some((call) => call.url.includes("/content-storage/")), false);
});
