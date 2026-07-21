import assert from "node:assert/strict";
import test from "node:test";
import { pollImageGenerationJob } from "../lib/utils/image-generation-job-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("polls queued and processing jobs until the image result is completed", async () => {
  const responses = [
    { ok: true, data: { status: "queued" } },
    { ok: true, data: { status: "processing" } },
    { ok: true, data: { status: "completed", result: { images: ["image-1"] } } }
  ];
  const requestedUrls: string[] = [];

  const result = await pollImageGenerationJob("job 1", {
    fetcher: async (input) => {
      requestedUrls.push(String(input));
      return jsonResponse(responses.shift());
    },
    intervalMs: 0,
    sleep: async () => undefined
  });

  assert.deepEqual(result, { images: ["image-1"] });
  assert.deepEqual(requestedUrls, [
    "/api/image/generate/job%201",
    "/api/image/generate/job%201",
    "/api/image/generate/job%201"
  ]);
});

test("throws the recorded provider error for a failed job", async () => {
  await assert.rejects(
    pollImageGenerationJob("failed-job", {
      fetcher: async () => jsonResponse({
        ok: true,
        data: { status: "failed", error: "provider failed" }
      })
    }),
    /provider failed/
  );
});

test("throws the server message when a job no longer exists", async () => {
  await assert.rejects(
    pollImageGenerationJob("missing-job", {
      fetcher: async () => jsonResponse({
        ok: false,
        message: "图片生成任务不存在或已失效，可能是服务已重启，请重新生成。"
      }, 404)
    }),
    /服务已重启，请重新生成/
  );
});

test("stops polling after the configured timeout", async () => {
  let currentTime = 0;
  let requestCount = 0;

  await assert.rejects(
    pollImageGenerationJob("slow-job", {
      fetcher: async () => {
        requestCount += 1;
        return jsonResponse({ ok: true, data: { status: "processing" } });
      },
      intervalMs: 10,
      timeoutMs: 20,
      now: () => currentTime,
      sleep: async (ms) => { currentTime += ms; }
    }),
    /等待超时/
  );

  assert.equal(requestCount, 3);
});
