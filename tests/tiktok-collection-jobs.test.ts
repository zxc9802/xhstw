import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { collectionJobStore } from "../lib/tiktok/collection-jobs";
import { CollectionJobError, retrieveCollection } from "../lib/tiktok/collection-client";
import type { CollectionResult } from "../lib/tiktok/provider";

const result: CollectionResult = { videos: [], warnings: [], scanned: 20, hasMore: false, nextOffset: null, capturedAt: "2026-10-16T05:12:53Z", evidencePages: [], keyword: "test", country: "MY", sample: "test", provider: "scrapecreators" };
const pending = () => ({ id: crypto.randomUUID(), input: { keyword: "test", limit: 20 } });
const reply = (status: string, extra = {}) => Response.json({ ok: true, data: { status, ...extra } });

test("collection survives losing the submitting connection and duplicate submissions do not rerun", async t => {
  t.mock.method(console, "info", () => {});
  const root = mkdtempSync(path.join(tmpdir(), "tiktok-jobs-")), store = collectionJobStore(root), job = pending();
  let finish!: (value: CollectionResult) => void, paidCalls = 0;
  assert.equal(store.create("owner", job.id, job.input, crypto.randomUUID()).created, true);
  const task = async () => { paidCalls++; return new Promise<CollectionResult>(resolve => { finish = resolve; }); };
  const running = store.run("owner", job.id, task);
  assert.equal(store.get("owner", job.id)?.status, "running");
  assert.equal(store.create("owner", job.id, job.input, crypto.randomUUID()).created, false);
  await store.run("owner", job.id, task);
  finish(result); await running;
  // A fresh store reads the saved result, without keeping the original request or an in-memory map.
  assert.deepEqual(collectionJobStore(root).get("owner", job.id)?.result, result);
  await store.run("owner", job.id, task);
  assert.equal(paidCalls, 1);
  assert.equal(store.create("owner", job.id, job.input, crypto.randomUUID()).created, false);
  assert.throws(() => store.create("owner", job.id, { keyword: "other" }, crypto.randomUUID()), /其他采集条件/);
  assert.equal(store.get("another-user", job.id), null);
  assert.throws(() => store.get("owner", "../escape"), /编号无效/);
});

test("interrupted jobs are reported as interrupted, never automatically restarted", async t => {
  t.mock.method(console, "info", () => {});
  const root = mkdtempSync(path.join(tmpdir(), "tiktok-jobs-")), store = collectionJobStore(root), job = pending();
  store.create("owner", job.id, job.input, crypto.randomUUID());
  const file = path.join(root, readdirSync(root)[0], `${job.id}.json`);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...saved, updatedAt: Date.now() - 181000 }));
  assert.equal(store.get("owner", job.id)?.status, "failed");
  await store.run("owner", job.id, async () => { throw new Error("Must not restart"); });
  assert.match(store.get("owner", job.id)?.error ?? "", /已中断/);
});

test("lost POST acknowledgement recovers by GET without another POST", async () => {
  const methods: string[] = [];
  const value = await retrieveCollection(pending(), true, { sleep: async () => {}, fetcher: (async (_url, init) => {
    const method = init?.method ?? "GET"; methods.push(method);
    if (method === "POST") throw new TypeError("Failed to fetch");
    return methods.length === 2 ? reply("running") : reply("completed", { result });
  }) as typeof fetch });
  assert.deepEqual(value, result);
  assert.deepEqual(methods, ["POST", "GET", "GET"]);
});

test("refresh recovery and transient polling failures never submit paid work", async () => {
  let calls = 0;
  const value = await retrieveCollection(pending(), false, { sleep: async () => {}, fetcher: (async (_url, init) => {
    assert.equal(init?.method, undefined); calls++;
    if (calls === 1) throw new TypeError("Connection closed");
    if (calls === 2) return new Response("<html>gateway error</html>", { status: 502 });
    return reply("completed", { result });
  }) as typeof fetch });
  assert.deepEqual(value, result); assert.equal(calls, 3);
});

test("unknown jobs and polling timeout keep their IDs, failed jobs do not loop", async () => {
  await assert.rejects(retrieveCollection(pending(), false, { fetcher: (async () => Response.json({ ok: false, error: "未找到任务" }, { status: 404 })) as typeof fetch }), error => error instanceof CollectionJobError && !error.terminal);
  await assert.rejects(retrieveCollection(pending(), false, { timeoutMs: 0, sleep: async () => {}, fetcher: (async () => reply("running")) as typeof fetch }), error => error instanceof CollectionJobError && !error.terminal);
  await assert.rejects(retrieveCollection(pending(), false, { fetcher: (async () => reply("failed", { error: "upstream failed" })) as typeof fetch }), error => error instanceof CollectionJobError && error.terminal);
});
