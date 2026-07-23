(function (root, factory) {
  const state = factory();
  if (typeof module === "object" && module.exports) module.exports = state;
  else root.XhsTaskState = state;
})(globalThis, function () {
  const RATE_LIMIT_COOLDOWN_MS = 60 * 60_000;

  function initialState() {
    return { requestId: null, tabId: null, stage: "idle", cooldownUntil: 0 };
  }

  function canStart(current, now) {
    if (current.requestId) return { ok: false, code: "BUSY", remainingMs: 0 };
    if (current.cooldownUntil > now) {
      return { ok: false, code: "RATE_LIMITED", remainingMs: current.cooldownUntil - now };
    }
    return { ok: true, remainingMs: 0 };
  }

  function startTask(current, requestId, tabId, now) {
    const allowed = canStart(current, now);
    if (!allowed.ok) throw new Error(allowed.code);
    return { ...current, requestId, tabId, stage: "opening" };
  }

  function advanceTask(current, requestId, stage) {
    if (current.requestId !== requestId) throw new Error("TASK_MISMATCH");
    if (stage !== "searching" && stage !== "enriching") throw new Error("INVALID_STAGE");
    return { ...current, stage };
  }

  function completeTask(current, requestId) {
    if (current.requestId !== requestId) throw new Error("TASK_MISMATCH");
    return { ...current, requestId: null, tabId: null, stage: "idle" };
  }

  function failTask(current, code, now) {
    return {
      requestId: null,
      tabId: null,
      stage: "idle",
      cooldownUntil: code === "RATE_LIMITED" ? now + RATE_LIMIT_COOLDOWN_MS : current.cooldownUntil
    };
  }

  function cancelTask(current, requestId) {
    if (current.requestId !== requestId) return current;
    return { ...current, requestId: null, tabId: null, stage: "idle" };
  }

  return Object.freeze({ initialState, canStart, startTask, advanceTask, completeTask, failTask, cancelTask });
});
