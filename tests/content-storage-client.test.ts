import assert from "node:assert/strict";
import test from "node:test";
import type { ContentDraft } from "../lib/content-storage/contracts";
import { saveContentDraft } from "../lib/content-storage/client";

const draft: ContentDraft = {
  title: "成品", summary: "摘要", body: "正文", platform: "小红书", account: "账号",
  type: "图文", mediaKind: "image", pages: [], referenceSources: [], tags: [], folder: null,
  prompts: [], negativePrompts: [], status: "需复查", duplicateRate: 0, duplicateLabel: "待检测",
  lowFlowRisk: "低", checkAdvice: [], reviewNotes: [], externalVideoUrls: []
};

test("requests PUT URLs, uploads image bytes, then commits the manifest", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (url === "/api/content-storage/upload-intents") {
      return Response.json({ ok: true, data: {
        contentId: "20260821T060000000Z-111111111111",
        uploads: [{
          fileId: "001-aaaaaaaaaaaa.png",
          key: "users/member/contents/20260821T060000000Z-111111111111/images/001-aaaaaaaaaaaa.png",
          contentType: "image/png",
          size: 4,
          uploadUrl: "https://cos.test/upload"
        }]
      } });
    }
    if (url === "https://cos.test/upload") return new Response(null, { status: 200 });
    if (url.endsWith("/commit")) return Response.json({ ok: true, data: { id: "saved" } });
    throw new Error(`unexpected ${url}`);
  };

  const progress: string[] = [];
  await saveContentDraft(draft, [new Blob([new Uint8Array(4)], { type: "image/png" })], {
    fetcher: fetcher as typeof fetch,
    onProgress: (done, total) => progress.push(`${done}/${total}`)
  });

  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ["POST", "/api/content-storage/upload-intents"],
    ["PUT", "https://cos.test/upload"],
    ["POST", "/api/content-storage/items/20260821T060000000Z-111111111111/commit"]
  ]);
  assert.deepEqual(progress, ["1/1"]);
});

test("does not commit when a direct COS upload fails", async () => {
  const urls: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url === "/api/content-storage/upload-intents") {
      return Response.json({ ok: true, data: {
        contentId: "20260821T060000000Z-111111111111",
        uploads: [{ fileId: "001-aaaaaaaaaaaa.png", key: "key", contentType: "image/png", size: 1, uploadUrl: "https://cos.test/upload" }]
      } });
    }
    return new Response(null, { status: 500 });
  };
  await assert.rejects(() => saveContentDraft(draft, [new Blob(["x"], { type: "image/png" })], { fetcher: fetcher as typeof fetch }), /上传失败/);
  assert.equal(urls.some((url) => url.endsWith("/commit")), false);
});
