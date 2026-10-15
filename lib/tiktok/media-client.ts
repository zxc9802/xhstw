export async function readMediaAnalysisStream(response: Response, onProgress: (message: string) => void): Promise<unknown> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "原视频分析请求失败");
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("原视频分析响应格式无效");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop() || "";
      for (const event of events) {
        const data = event.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (parsed.type === "error") throw new Error(parsed.message || "原视频分析失败");
        if (parsed.type === "phase" && typeof parsed.message === "string") onProgress(parsed.message);
        if (parsed.type === "done" && parsed.data) return parsed.data;
      }
      if (done) throw new Error("原视频分析连接中断，尚未完成，请重试");
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
