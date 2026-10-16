import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CollectionResult } from "./provider";
import { TikTokServiceError } from "./errors";
import { logCollectionRequest } from "./diagnostics";
import type { CollectionProgress } from "./batch-collection";
import { collectionLimits } from "./videos";

export type CollectionJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
  requestId: string;
  result?: CollectionResult;
  progress?: CollectionProgress;
  error?: string;
};
type StoredJob = CollectionJob & { inputHash: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

// Results live outside the build output. Mount outputs on a persistent volume to retain them across deployments.
export function collectionJobStore(root = path.join(process.cwd(), "outputs", "tiktok-collection-jobs")) {
  function filename(owner: string, id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new TikTokServiceError("采集任务编号无效，请刷新页面");
    return path.join(root, hash(owner), `${id.toLowerCase()}.json`);
  }
  function read(owner: string, id: string): StoredJob | null {
    try { return JSON.parse(readFileSync(filename(owner, id), "utf8")) as StoredJob; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  function save(owner: string, job: StoredJob) {
    const target = filename(owner, job.id), temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(job), { mode: 0o600 });
    renameSync(temporary, target);
  }
  function get(owner: string, id: string): CollectionJob | null {
    const stored = read(owner, id);
    if (!stored) return null;
    // A killed worker must never silently rerun paid requests on the next poll.
    if (["queued", "running"].includes(stored.status) && Date.now() - stored.updatedAt > collectionLimits.milliseconds + 60000) {
      stored.status = "failed";
      stored.error = "采集任务已中断，未自动重试；部分上游请求可能已经计费。";
      stored.updatedAt = Date.now();
      save(owner, stored);
    }
    const { inputHash: _inputHash, ...job } = stored;
    return job;
  }
  function create(owner: string, id: string, input: unknown, requestId: string) {
    const target = filename(owner, id), inputHash = hash(JSON.stringify(input));
    mkdirSync(path.dirname(target), { recursive: true });
    const job: StoredJob = { id, inputHash, requestId, status: "queued", createdAt: Date.now(), updatedAt: Date.now() };
    try { writeFileSync(target, JSON.stringify(job), { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (read(owner, id)?.inputHash !== inputHash) throw new TikTokServiceError("该任务编号已用于其他采集条件", 409);
      return { created: false, job: get(owner, id)! };
    }
    return { created: true, job: get(owner, id)! };
  }
  async function run(owner: string, id: string, task: (update: (progress: CollectionProgress) => void) => Promise<CollectionResult>) {
    const job = read(owner, id);
    if (!job || job.status !== "queued") return;
    job.status = "running"; job.updatedAt = Date.now(); save(owner, job);
    logCollectionRequest(job.requestId, "job.start", { jobId: id });
    try {
      job.result = await task(progress => { job.progress = progress; job.updatedAt = Date.now(); save(owner, job); }); job.status = "completed";
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof TikTokServiceError ? error.message : "采集任务失败，请查看服务日志；未自动重新采集。";
    }
    job.updatedAt = Date.now();
    save(owner, job);
    logCollectionRequest(job.requestId, job.status === "completed" ? "job.complete" : "job.error", { jobId: id, elapsedMs: job.updatedAt - job.createdAt, scanned: job.result?.scanned, retained: job.result?.videos.length, warnings: job.result?.warnings.length });
  }
  return { create, get, run };
}
