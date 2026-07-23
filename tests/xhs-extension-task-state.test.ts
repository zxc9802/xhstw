import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

type TaskState = {
  requestId: string | null;
  tabId: number | null;
  stage: "idle" | "opening" | "searching" | "enriching";
  cooldownUntil: number;
};

type StartDecision =
  | { ok: true; remainingMs: 0 }
  | { ok: false; code: "BUSY" | "RATE_LIMITED"; remainingMs: number };

const state = require("../browser-extension/shared/task-state.js") as {
  initialState(): TaskState;
  canStart(current: TaskState, now: number): StartDecision;
  startTask(current: TaskState, requestId: string, tabId: number, now: number): TaskState;
  advanceTask(current: TaskState, requestId: string, stage: string): TaskState;
  completeTask(current: TaskState, requestId: string): TaskState;
  failTask(current: TaskState, code: string, now: number): TaskState;
  cancelTask(current: TaskState, requestId: string): TaskState;
};

const NOW = Date.parse("2026-07-22T10:00:00+08:00");

test("runs one task through opening, searching, enriching, and completion", () => {
  const idle = state.initialState();
  const opening = state.startTask(idle, "task-1", 7, NOW);
  const searching = state.advanceTask(opening, "task-1", "searching");
  const enriching = state.advanceTask(searching, "task-1", "enriching");
  const completed = state.completeTask(enriching, "task-1");

  assert.deepEqual(idle, { requestId: null, tabId: null, stage: "idle", cooldownUntil: 0 });
  assert.deepEqual(opening, { requestId: "task-1", tabId: 7, stage: "opening", cooldownUntil: 0 });
  assert.equal(searching.stage, "searching");
  assert.equal(enriching.stage, "enriching");
  assert.deepEqual(completed, { requestId: null, tabId: null, stage: "idle", cooldownUntil: 0 });
  assert.notEqual(opening, idle);
  assert.equal(idle.stage, "idle");
});

test("rejects a second active task with BUSY before considering cooldown", () => {
  const active: TaskState = {
    requestId: "task-1",
    tabId: 7,
    stage: "searching",
    cooldownUntil: NOW + 3_600_000
  };

  assert.deepEqual(state.canStart(active, NOW), { ok: false, code: "BUSY", remainingMs: 0 });
  assert.throws(() => state.startTask(active, "task-2", 8, NOW), { message: "BUSY" });
  assert.deepEqual(active, {
    requestId: "task-1",
    tabId: 7,
    stage: "searching",
    cooldownUntil: NOW + 3_600_000
  });
});

test("rate limits the browser for exactly sixty minutes", () => {
  const started = state.startTask(state.initialState(), "task-1", 7, NOW);
  const blocked = state.failTask(started, "RATE_LIMITED", NOW);

  assert.equal(blocked.cooldownUntil, NOW + 60 * 60_000);
  assert.deepEqual(state.canStart(blocked, NOW + 59 * 60_000 + 59_000), {
    ok: false,
    code: "RATE_LIMITED",
    remainingMs: 1_000
  });
  assert.deepEqual(state.canStart(blocked, NOW + 60 * 60_000), { ok: true, remainingMs: 0 });
});

test("only RATE_LIMITED creates a cooldown and other failures preserve one", () => {
  const previousCooldown = NOW - 1;
  const active: TaskState = {
    requestId: "task-1",
    tabId: 7,
    stage: "searching",
    cooldownUntil: previousCooldown
  };
  const failed = state.failTask(active, "CAPTCHA", NOW);

  assert.deepEqual(failed, {
    requestId: null,
    tabId: null,
    stage: "idle",
    cooldownUntil: previousCooldown
  });
  assert.equal(active.requestId, "task-1");
});

test("wrong request ids cannot advance or complete the active task", () => {
  const active = state.startTask(state.initialState(), "task-1", 7, NOW);

  assert.throws(() => state.advanceTask(active, "task-2", "searching"), { message: "TASK_MISMATCH" });
  assert.throws(() => state.completeTask(active, "task-2"), { message: "TASK_MISMATCH" });
  assert.deepEqual(active, { requestId: "task-1", tabId: 7, stage: "opening", cooldownUntil: 0 });
});

test("advanceTask accepts only searching and enriching stages", () => {
  const active = state.startTask(state.initialState(), "task-1", 7, NOW);

  for (const invalidStage of ["idle", "opening", "completed", "failed", ""]) {
    assert.throws(() => state.advanceTask(active, "task-1", invalidStage), { message: "INVALID_STAGE" });
  }
  assert.deepEqual(active, { requestId: "task-1", tabId: 7, stage: "opening", cooldownUntil: 0 });
});

test("cancellation clears only the matching task and preserves cooldown", () => {
  const active: TaskState = {
    requestId: "task-1",
    tabId: 7,
    stage: "enriching",
    cooldownUntil: NOW - 1
  };

  const ignored = state.cancelTask(active, "task-2");
  const cancelled = state.cancelTask(active, "task-1");

  assert.equal(ignored, active);
  assert.deepEqual(cancelled, {
    requestId: null,
    tabId: null,
    stage: "idle",
    cooldownUntil: NOW - 1
  });
  assert.notEqual(cancelled, active);
});

test("completion clears the matching task without clearing its cooldown", () => {
  const active: TaskState = {
    requestId: "task-1",
    tabId: 7,
    stage: "enriching",
    cooldownUntil: NOW - 1
  };

  assert.deepEqual(state.completeTask(active, "task-1"), {
    requestId: null,
    tabId: null,
    stage: "idle",
    cooldownUntil: NOW - 1
  });
  assert.equal(active.stage, "enriching");
});
