importScripts("shared/protocol.js", "shared/collector.js", "shared/task-state.js");

const DETAIL_DELAY_MS = 4_000;
const QUERY_DELAY_MS = 15_000;
const TAB_LOAD_TIMEOUT_MS = 60_000;
const SEND_RETRY_LIMIT = 10;
const SEND_RETRY_DELAY_MS = 500;
const ACTIVE_STORAGE_KEY = "xhsActiveTask";
const COOLDOWN_STORAGE_KEY = "xhsCooldownUntil";
const BLOCK_CODES = new Set(["LOGIN_REQUIRED", "CAPTCHA", "RATE_LIMITED"]);
const protocol = globalThis.XhsExtensionProtocol;
const collector = globalThis.XhsPageCollector;
const taskState = globalThis.XhsTaskState;
let active = null;
let recoveryPromise = null;

class TaskError extends Error {
  constructor(code, message) {
    const safeMessage = typeof message === "string" && message ? message.slice(0, 300) : "本机抓取失败";
    super(safeMessage);
    this.code = typeof code === "string" && code ? code.slice(0, 80) : "PAGE_ACTION_FAILED";
  }
}

function extensionEnvelope(type, requestId, payload) {
  return {
    channel: protocol.CHANNEL,
    protocolVersion: protocol.PROTOCOL_VERSION,
    direction: "extension-to-page",
    type,
    requestId,
    payload
  };
}

function post(context, type, payload) {
  if (!context.portConnected) throw new TaskError("EXTENSION_DISCONNECTED", "网页与扩展的连接已断开");
  const message = extensionEnvelope(type, context.requestId, payload);
  if (!protocol.isEnvelope(message, "extension-to-page")) {
    throw new TaskError("INTERNAL_PROTOCOL_ERROR", "扩展生成了无效响应");
  }
  context.port.postMessage(message);
}

function postError(port, requestId, code, message) {
  const response = extensionEnvelope("error", requestId, { code, message });
  if (protocol.isEnvelope(response, "extension-to-page")) {
    try {
      port.postMessage(response);
    } catch (_) {
      // The originating page may already be gone.
    }
  }
}

function searchUrl(query) {
  const url = new URL("https://www.xiaohongshu.com/search_result");
  url.searchParams.set("keyword", query);
  url.searchParams.set("source", "web_search_result_notes");
  return url.toString();
}

function isXhsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"));
  } catch (_) {
    return false;
  }
}

function noteKey(value) {
  return collector.noteId(value) || collector.normalizeNoteUrl(value);
}

function ensureRunning(context) {
  if (context.cancelled) throw context.cancelReason;
  if (active !== context) throw new TaskError("CANCELED", "抓取任务已取消");
}

function wait(context, milliseconds) {
  ensureRunning(context);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      context.abortWait = null;
      resolve();
    }, milliseconds);
    context.abortWait = () => {
      clearTimeout(timer);
      context.abortWait = null;
      reject(context.cancelReason || new TaskError("CANCELED", "抓取任务已取消"));
    };
  });
}

async function waitForTabComplete(context) {
  ensureRunning(context);
  const tabId = context.taskTabId;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      context.abortWait = null;
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(() => finish(new TaskError("PAGE_TIMEOUT", "小红书页面加载超时")), TAB_LOAD_TIMEOUT_MS);
    context.abortWait = () => finish(context.cancelReason || new TaskError("CANCELED", "抓取任务已取消"));
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch(() => finish(new TaskError("TAB_CLOSED", "小红书任务标签页已关闭")));
  });
}

async function navigate(context, url) {
  ensureRunning(context);
  if (!isXhsUrl(url)) throw new TaskError("INVALID_PAGE_URL", "小红书页面链接无效");
  await chrome.tabs.update(context.taskTabId, { url, active: true });
  await waitForTabComplete(context);
  ensureRunning(context);
}

async function sendToTaskTab(context, message) {
  let lastError;
  for (let attempt = 0; attempt < SEND_RETRY_LIMIT; attempt += 1) {
    ensureRunning(context);
    try {
      return await chrome.tabs.sendMessage(context.taskTabId, message);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < SEND_RETRY_LIMIT) await wait(context, SEND_RETRY_DELAY_MS);
    }
  }
  throw new TaskError("PAGE_STRUCTURE_CHANGED", lastError instanceof Error ? lastError.message : "无法连接小红书页面");
}

function pageResult(response, expectedKind) {
  if (!response || typeof response !== "object") throw new TaskError("PAGE_STRUCTURE_CHANGED", "小红书页面没有返回有效结果");
  if (response.ok === false) {
    const code = typeof response.code === "string" ? response.code.slice(0, 80) : "PAGE_ACTION_FAILED";
    const message = typeof response.message === "string" && response.message ? response.message.slice(0, 300) : "小红书页面操作失败";
    throw new TaskError(code, message);
  }
  if (response.ok !== true) throw new TaskError("PAGE_STRUCTURE_CHANGED", "小红书页面结果格式异常");
  if (expectedKind === "search" && !Array.isArray(response.rows)) throw new TaskError("PAGE_STRUCTURE_CHANGED", "小红书搜索结果格式异常");
  return response;
}

async function persist(context) {
  await chrome.storage.session.set({
    [ACTIVE_STORAGE_KEY]: {
      requestId: context.requestId,
      originTabId: context.originTabId,
      taskTabId: context.taskTabId,
      stage: context.state.stage
    }
  });
}

async function clearPersisted() {
  await chrome.storage.session.remove(ACTIVE_STORAGE_KEY);
}

async function closeTaskTab(context) {
  if (!Number.isInteger(context.taskTabId) || context.taskTabClosed) return;
  context.taskTabClosed = true;
  try {
    await chrome.tabs.remove(context.taskTabId);
  } catch (_) {
    // It may have been closed manually.
  }
}

async function restoreOrigin(context) {
  if (!Number.isInteger(context.originTabId) || context.originClosed) return;
  try {
    await chrome.tabs.update(context.originTabId, { active: true });
  } catch (_) {
    context.originClosed = true;
  }
}

function cancelContext(context, error, suppressError) {
  if (!context || context.cancelled) return;
  context.cancelled = true;
  context.cancelReason = error;
  context.suppressError = context.suppressError || suppressError;
  if (context.abortWait) context.abortWait();
  void closeTaskTab(context);
}

async function runCollection(context, task) {
  const total = Math.min(10, task.queries.length * task.limitPerQuery);
  const topics = [];
  const seen = new Set(task.existingUrls.map(noteKey));
  try {
    post(context, "progress", { stage: "opening", completed: 0, total, message: "正在打开小红书" });
    const tab = await chrome.tabs.create({ url: searchUrl(task.queries[0]), active: true });
    if (!Number.isInteger(tab.id)) throw new TaskError("TAB_CREATE_FAILED", "无法创建小红书任务标签页");
    context.taskTabId = tab.id;
    context.state = { ...context.state, tabId: tab.id };
    await persist(context);
    await waitForTabComplete(context);

    for (let queryIndex = 0; queryIndex < task.queries.length; queryIndex += 1) {
      ensureRunning(context);
      const query = task.queries[queryIndex];
      if (queryIndex > 0) {
        await wait(context, QUERY_DELAY_MS);
        await navigate(context, searchUrl(query));
      }
      context.state = taskState.advanceTask(context.state, context.requestId, "searching");
      await persist(context);
      post(context, "progress", { stage: "searching", completed: topics.length, total, message: `正在搜索“${query}”` });
      const searchResponse = pageResult(await sendToTaskTab(context, {
        action: "xhs:search",
        query,
        limit: task.limitPerQuery,
        mediaType: task.mediaType,
        dateRange: task.dateRange,
        sortBy: task.sortBy
      }), "search");

      for (const row of searchResponse.rows.slice(0, task.limitPerQuery)) {
        ensureRunning(context);
        if (!row || typeof row !== "object") continue;
        const detailUrl = collector.normalizeNoteUrl(row.url);
        const key = noteKey(row.url);
        if (!isXhsUrl(detailUrl) || !key || seen.has(key) || topics.length >= total) continue;
        await wait(context, DETAIL_DELAY_MS);
        await navigate(context, detailUrl);
        context.state = taskState.advanceTask(context.state, context.requestId, "enriching");
        await persist(context);
        const detailResponse = pageResult(await sendToTaskTab(context, {
          action: "xhs:detail",
          expectedTitle: typeof row.title === "string" ? row.title.slice(0, 2_048) : ""
        }), "detail");
        const topic = collector.buildTopic(row, detailResponse, new Date());
        topics.push(topic);
        seen.add(key);
        post(context, "progress", {
          stage: "enriching",
          completed: topics.length,
          total,
          message: `已抓取 ${topics.length}/${total} 条`
        });
      }
    }

    context.state = taskState.completeTask(context.state, context.requestId);
    await closeTaskTab(context);
    await restoreOrigin(context);
    await clearPersisted();
    post(context, "result", { topics, message: `本机浏览器已抓取 ${topics.length} 条` });
    if (active === context) active = null;
  } catch (error) {
    const failure = error instanceof TaskError ? error : new TaskError("PAGE_ACTION_FAILED", error instanceof Error ? error.message.slice(0, 300) : "本机抓取失败");
    context.state = taskState.failTask(context.state, failure.code, Date.now());
    if (failure.code === "RATE_LIMITED") {
      await chrome.storage.local.set({ [COOLDOWN_STORAGE_KEY]: context.state.cooldownUntil });
    }
    const keepTaskTab = BLOCK_CODES.has(failure.code);
    if (!keepTaskTab) {
      await closeTaskTab(context);
      await restoreOrigin(context);
    }
    await clearPersisted();
    if (!context.suppressError && context.portConnected) postError(context.port, context.requestId, failure.code, failure.message);
    if (active === context) active = null;
  }
}

async function startCollection(port, originTabId, message) {
  if (active) {
    postError(port, message.requestId, "BUSY", "当前浏览器已有抓取任务正在运行");
    return;
  }
  const context = {
    requestId: message.requestId,
    port,
    portConnected: true,
    originTabId,
    originClosed: false,
    taskTabId: null,
    taskTabClosed: false,
    cancelled: false,
    cancelReason: null,
    abortWait: null,
    suppressError: false,
    state: null
  };
  active = context;

  try {
    await recoveryPromise;
    ensureRunning(context);
    if (!Number.isInteger(originTabId)) throw new TaskError("ORIGIN_TAB_UNAVAILABLE", "无法识别任务来源页面");
    const stored = await chrome.storage.local.get(COOLDOWN_STORAGE_KEY);
    const cooldownUntil = Number.isFinite(stored[COOLDOWN_STORAGE_KEY]) ? stored[COOLDOWN_STORAGE_KEY] : 0;
    const initial = { ...taskState.initialState(), cooldownUntil };
    const allowed = taskState.canStart(initial, Date.now());
    if (!allowed.ok) {
      const minutes = Math.max(1, Math.ceil(allowed.remainingMs / 60_000));
      throw new TaskError(allowed.code, `当前浏览器处于风控冷却期，请约 ${minutes} 分钟后再试`);
    }
    context.state = taskState.startTask(initial, message.requestId, -1, Date.now());
    await persist(context);
    void runCollection(context, message.payload);
  } catch (error) {
    const failure = error instanceof TaskError ? error : new TaskError("PAGE_ACTION_FAILED", "无法启动本机抓取任务");
    await clearPersisted().catch(() => {});
    postError(port, message.requestId, failure.code, failure.message);
    if (active === context) active = null;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "xhs-app-bridge") return;
  const originTabId = port.sender && port.sender.tab ? port.sender.tab.id : null;
  port.onMessage.addListener((message) => {
    if (!protocol.isEnvelope(message, "page-to-extension")) return;
    if (message.type === "ping") {
      const response = extensionEnvelope("pong", message.requestId, { version: chrome.runtime.getManifest().version });
      if (protocol.isEnvelope(response, "extension-to-page")) port.postMessage(response);
      return;
    }
    if (message.type === "cancel") {
      if (active && active.requestId === message.requestId && active.port === port) {
        cancelContext(active, new TaskError("CANCELED", "抓取任务已取消"), true);
      }
      return;
    }
    void startCollection(port, originTabId, message);
  });
  port.onDisconnect.addListener(() => {
    if (active && active.port === port) {
      active.portConnected = false;
      cancelContext(active, new TaskError("EXTENSION_DISCONNECTED", "网页与扩展的连接已断开"), true);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!active) return;
  if (tabId === active.originTabId) {
    active.originClosed = true;
    cancelContext(active, new TaskError("ORIGIN_TAB_CLOSED", "任务来源页面已关闭"), true);
  } else if (tabId === active.taskTabId && !active.taskTabClosed) {
    active.taskTabClosed = true;
    cancelContext(active, new TaskError("TAB_CLOSED", "小红书任务标签页已关闭"), false);
  }
});

async function recoverStaleSession() {
  const stored = await chrome.storage.session.get(ACTIVE_STORAGE_KEY);
  const stale = stored[ACTIVE_STORAGE_KEY];
  if (stale && Number.isInteger(stale.taskTabId)) {
    try {
      await chrome.tabs.remove(stale.taskTabId);
    } catch (_) {
      // The previous task tab may already be gone.
    }
  }
  await clearPersisted();
}

recoveryPromise = recoverStaleSession().catch(() => {});
