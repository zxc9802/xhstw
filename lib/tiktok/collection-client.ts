import type { CollectionJob } from "./collection-jobs";
import type { CollectionResult } from "./provider";
import type { CollectionProgress } from "./batch-collection";

export type PendingCollection = { id: string; input: Record<string, unknown> };
export class CollectionJobError extends Error {
  constructor(message: string, readonly terminal = false) { super(message); }
}
type Options = { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; timeoutMs?: number; onProgress?: (progress: CollectionProgress) => void };

export async function retrieveCollection(pending: PendingCollection, submit: boolean, options: Options = {}): Promise<CollectionResult> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  if (submit) {
    try {
      const response = await fetcher("/api/tiktok/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pending.input, jobId: pending.id }), signal: AbortSignal.timeout(15000), redirect: "error" });
      // A lost acknowledgement is ambiguous: only query the saved ID, never submit again automatically.
      if (response.status >= 400 && response.status < 500) {
        const payload = await response.json().catch(() => ({}));
        throw new CollectionJobError(payload.error || "采集任务未被接受，请检查输入或登录状态", true);
      }
    } catch (error) { if (error instanceof CollectionJobError) throw error; }
  }
  const started = Date.now();
  do {
    try {
      const response = await fetcher(`/api/tiktok/collect?jobId=${encodeURIComponent(pending.id)}`, { cache: "no-store", signal: AbortSignal.timeout(15000), redirect: "error" });
      const payload = await response.json();
      if (response.status === 404) throw new CollectionJobError(payload.error || "采集任务不存在，未自动重新采集");
      if (response.ok && payload.ok) {
        const job = payload.data as CollectionJob;
        if (job.progress) options.onProgress?.(job.progress);
        if (job.status === "completed" && job.result) return job.result;
        if (job.status === "failed") throw new CollectionJobError(job.error || "采集失败，未自动重新采集", true);
      }
    } catch (error) { if (error instanceof CollectionJobError) throw error; }
    await sleep(2000);
  } while (Date.now() - started < (options.timeoutMs ?? 420000));
  throw new CollectionJobError("暂时无法取回结果，任务编号已保留。请点击“继续获取结果”；不会重新发起付费采集。");
}
