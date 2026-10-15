import assert from "node:assert/strict";
import test from "node:test";
import { readMediaAnalysisStream } from "../lib/tiktok/media-client";

function streamResponse(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
}

test("phase updates survive split UTF-8 chunks and only a validated final event completes", async () => {
  const progress: string[] = [];
  const result = await readMediaAnalysisStream(streamResponse([{ type: "phase", message: "正在读取原视频" }, { type: "done", data: { id: "analysis" } }]), message => progress.push(message));
  assert.deepEqual(progress, ["正在读取原视频"]);
  assert.deepEqual(result, { id: "analysis" });
});

test("failed or interrupted media requests never look like analyzed video", async () => {
  await assert.rejects(readMediaAnalysisStream(streamResponse([{ type: "error", message: "原视频连接失败" }]), () => {}), /原视频连接失败/);
  await assert.rejects(readMediaAnalysisStream(streamResponse([{ type: "phase", message: "读取中" }]), () => {}), /中断|未完成/);
  await assert.rejects(readMediaAnalysisStream(Response.json({ ok: false, error: "服务未配置" }, { status: 503 }), () => {}), /服务未配置/);
});
