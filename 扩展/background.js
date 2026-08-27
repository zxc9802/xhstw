importScripts("shared/protocol.js", "shared/collector.js", "shared/task-state.js", "shared/media-transfer.js", "shared/library2-media.js", "shared/library2-session.js");

const DETAIL_DELAY_MS = 4_000;
const QUERY_DELAY_MS = 15_000;
const TAB_LOAD_TIMEOUT_MS = 60_000;
const SEND_RETRY_LIMIT = 10;
const SEND_RETRY_DELAY_MS = 500;
const ACTIVE_STORAGE_KEY = "xhsActiveTask";
const COOLDOWN_STORAGE_KEY = "xhsCooldownUntil";
const BLOCK_CODES = new Set(["LOGIN_REQUIRED", "CAPTCHA", "RATE_LIMITED"]);
const SKIPPABLE_DETAIL_CODES = new Set(["NOTE_UNAVAILABLE", "DETAIL_INCOMPLETE"]);
const SEARCH_CANDIDATE_BATCH_SIZE = 5;
const MEDIA_REPLY_TIMEOUT_MS = 30_000;
const MEDIA_DOWNLOAD_BATCH_SIZE = 4;
const protocol = globalThis.XhsExtensionProtocol;
const collector = globalThis.XhsPageCollector;
const taskState = globalThis.XhsTaskState;
const mediaTransfer = globalThis.XhsMediaTransfer;
const library2Media = globalThis.Library2Media;
const library2Session = globalThis.Library2Session;
const LIBRARY2_SESSIONS_STORAGE_KEY = "library2SessionsV2";
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

function waitForMediaReply(context, assetKey, allowedTypes, expectedChunkIndex) {
  ensureRunning(context);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      context.mediaWaiter = null;
      reject(new TaskError("MEDIA_ACK_TIMEOUT", "网页保存媒体超时"));
    }, MEDIA_REPLY_TIMEOUT_MS);
    context.mediaWaiter = { assetKey, allowedTypes, expectedChunkIndex, resolve, reject, timer };
  });
}

function routeMediaReply(context, message) {
  const waiter = context && context.mediaWaiter;
  if (!waiter || message.requestId !== context.requestId || !waiter.allowedTypes.has(message.type)) return;
  if (!message.payload || message.payload.assetKey !== waiter.assetKey) return;
  if (message.type === "media:ack" && message.payload.chunkIndex !== waiter.expectedChunkIndex) return;
  clearTimeout(waiter.timer);
  context.mediaWaiter = null;
  if (message.type === "media:abort") {
    const error = new TaskError(message.payload.code, message.payload.message);
    waiter.reject(error);
  } else {
    waiter.resolve(message);
  }
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
  if (context.mediaWaiter) {
    clearTimeout(context.mediaWaiter.timer);
    context.mediaWaiter.reject(error);
    context.mediaWaiter = null;
  }
  void closeTaskTab(context);
}

function attachLocalKey(topic, job, assetKey, metadata) {
  const item = topic.media[job.itemIndex];
  if (!item) return;
  if (job.role === "poster") item.posterLocalAssetKey = assetKey;
  else {
    item.localAssetKey = assetKey;
    item.mimeType = metadata.mimeType;
    item.size = metadata.byteLength;
  }
}

async function downloadOneMedia(context, topicKey, topic, job, order) {
  const assetKey = await mediaTransfer.createAssetKey(topicKey, job.role, order, job.sourceUrl);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      post(context, "media:start", { assetKey, topicKey, mediaRole: job.role, sourceUrl: job.sourceUrl });
      const startReply = await waitForMediaReply(context, assetKey, new Set(["media:ready", "media:skip", "media:abort"]));
      if (startReply.type === "media:skip") {
        attachLocalKey(topic, job, assetKey, {
          mimeType: topic.media[job.itemIndex]?.mimeType || (job.role === "video" ? "video/mp4" : "image/jpeg"),
          byteLength: topic.media[job.itemIndex]?.size || 0
        });
        return;
      }
      const metadata = await mediaTransfer.downloadMedia({
        sourceUrl: job.sourceUrl,
        async onChunk(chunk) {
          post(context, "media:chunk", { assetKey, ...chunk });
          await waitForMediaReply(context, assetKey, new Set(["media:ack", "media:abort"]), chunk.chunkIndex);
        }
      });
      post(context, "media:complete", { assetKey, ...metadata });
      await waitForMediaReply(context, assetKey, new Set(["media:ack", "media:abort"]), metadata.chunkCount);
      attachLocalKey(topic, job, assetKey, metadata);
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof TaskError && error.code === "QUOTA_EXCEEDED") throw error;
      post(context, "media:error", {
        assetKey,
        code: error && error.code ? String(error.code).slice(0, 80) : "MEDIA_FETCH_FAILED",
        message: error instanceof Error ? error.message.slice(0, 300) : "媒体下载失败"
      });
    }
  }
  throw lastError || new TaskError("MEDIA_FETCH_FAILED", "媒体下载失败");
}

async function transferTopicMedia(context, topic, topicKey, completed, total) {
  const jobs = mediaTransfer.buildMediaJobs(topic);
  for (let order = 0; order < jobs.length; order += 1) {
    if (context.mediaStorageBlocked) break;
    const job = jobs[order];
    post(context, "progress", {
      stage: "downloading",
      completed,
      total,
      message: `正在下载第 ${completed + 1}/${total} 篇的媒体 ${order + 1}/${jobs.length}`
    });
    try {
      await downloadOneMedia(context, topicKey, topic, job, order);
      context.mediaCompleted += 1;
    } catch (error) {
      const failure = error instanceof TaskError
        ? error
        : new TaskError(error && error.code ? error.code : "MEDIA_FETCH_FAILED", error instanceof Error ? error.message : "媒体下载失败");
      context.mediaFailed += 1;
      if (failure.code === "QUOTA_EXCEEDED") context.mediaStorageBlocked = true;
      post(context, "media:error", {
        assetKey: await mediaTransfer.createAssetKey(topicKey, job.role, order, job.sourceUrl),
        code: failure.code,
        message: failure.message
      });
    }
  }
}

async function runCollection(context, task) {
  const total = task.queries.length * task.limitPerQuery;
  const topics = [];
  const seen = new Set(task.existingUrls.map(noteKey));
  let skippedUnavailable = 0;
  const shortfalls = [];
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
      let capturedForQuery = 0;
      let candidateLimit = Math.max(SEARCH_CANDIDATE_BATCH_SIZE, task.limitPerQuery);
      const attemptedForQuery = new Set();
      while (capturedForQuery < task.limitPerQuery) {
        const searchResponse = pageResult(await sendToTaskTab(context, {
          action: "xhs:search",
          query,
          limit: candidateLimit,
          mediaType: task.mediaType,
          dateRange: task.dateRange,
          sortBy: task.sortBy
        }), "search");
        let attemptedThisPass = 0;

        for (const row of searchResponse.rows) {
          ensureRunning(context);
          if (capturedForQuery >= task.limitPerQuery || topics.length >= total) break;
          if (!row || typeof row !== "object") continue;
          const key = noteKey(row.url);
          if (!isXhsUrl(row.url) || !key || attemptedForQuery.has(key)) continue;
          attemptedForQuery.add(key);
          attemptedThisPass += 1;
          if (seen.has(key)) continue;
          await wait(context, DETAIL_DELAY_MS);
          context.state = taskState.advanceTask(context.state, context.requestId, "enriching");
          await persist(context);
          const rawDetailResponse = await sendToTaskTab(context, {
            action: "xhs:detail",
            expectedTitle: typeof row.title === "string" ? row.title.slice(0, 2_048) : "",
            targetUrl: row.url
          });
          if (rawDetailResponse && rawDetailResponse.ok === false && SKIPPABLE_DETAIL_CODES.has(rawDetailResponse.code)) {
            skippedUnavailable += 1;
            post(context, "progress", {
              stage: "enriching",
              completed: topics.length,
              total,
              message: `“${query}”跳过不可用内容，继续补抓`
            });
            continue;
          }
          const detailResponse = pageResult(rawDetailResponse, "detail");
          const topic = collector.buildTopic(row, detailResponse, new Date());
          await transferTopicMedia(context, topic, key, topics.length, total);
          topics.push(topic);
          capturedForQuery += 1;
          seen.add(key);
          post(context, "progress", {
            stage: "enriching",
            completed: topics.length,
            total,
            message: `已抓取 ${topics.length}/${total} 条`
          });
        }

        if (capturedForQuery >= task.limitPerQuery) break;
        if (searchResponse.rows.length < candidateLimit || attemptedThisPass === 0) break;
        candidateLimit += Math.max(SEARCH_CANDIDATE_BATCH_SIZE, task.limitPerQuery - capturedForQuery);
        post(context, "progress", {
          stage: "searching",
          completed: topics.length,
          total,
          message: `“${query}”数量不足，继续加载候选`
        });
      }
      if (capturedForQuery < task.limitPerQuery) shortfalls.push(`${query} ${capturedForQuery}/${task.limitPerQuery}`);
    }

    context.state = taskState.completeTask(context.state, context.requestId);
    await closeTaskTab(context);
    await restoreOrigin(context);
    await clearPersisted();
    const skippedMessage = skippedUnavailable ? `，跳过 ${skippedUnavailable} 条不可浏览或不完整内容` : "";
    const shortfallMessage = shortfalls.length ? `；未达到目标：${shortfalls.join("、")}` : "";
    post(context, "result", {
      topics,
      message: `本机浏览器已抓取 ${topics.length}/${total} 条${skippedMessage}${shortfallMessage}`.slice(0, 300),
      mediaCompleted: context.mediaCompleted,
      mediaFailed: context.mediaFailed
    });
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
    mediaWaiter: null,
    mediaStorageBlocked: false,
    mediaCompleted: 0,
    mediaFailed: 0,
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
    if (["media:ready", "media:skip", "media:ack", "media:abort"].includes(message.type)) {
      if (active && active.port === port) routeMediaReply(active, message);
      return;
    }
    if (message.type === "collect") void startCollection(port, originTabId, message);
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

async function openLibrary2Origins() {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        "http://127.0.0.1:3000/*",
        "https://xhstw.qycm.top/*"
      ]
    });
    return tabs.map((tab) => library2Session.normalizeOrigin(tab.url)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function library2Api(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error((payload && payload.message) || `请求失败（${response.status}）`);
  }
  return payload.data;
}

async function uploadLibrary2(payload) {
  const stored = await chrome.storage.local.get([
    LIBRARY2_SESSIONS_STORAGE_KEY,
    "library2Token",
    "library2ExpiresAt",
    "library2AppOrigin"
  ]);
  const now = Date.now();
  const openOrigins = await openLibrary2Origins();
  let session = library2Session.selectSession(stored[LIBRARY2_SESSIONS_STORAGE_KEY], openOrigins, now);
  if (!session) {
    const legacyOrigin = library2Session.normalizeOrigin(stored.library2AppOrigin);
    const legacySessions = library2Session.upsertSession({}, {
      appOrigin: legacyOrigin,
      token: stored.library2Token,
      expiresAt: stored.library2ExpiresAt
    }, 0);
    session = library2Session.selectSession(legacySessions, openOrigins, now);
  }
  if (!session) {
    return { ok: false, message: "请先打开图文生产中台并登录，授权插件上传到爆款选题库2" };
  }
  const appOrigin = session.appOrigin;
  const images = [];
  const urls = Array.isArray(payload && payload.imageUrls) ? payload.imageUrls.slice(0, 20) : [];
  for (let index = 0; index < urls.length; index += MEDIA_DOWNLOAD_BATCH_SIZE) {
    const batch = await Promise.all(urls.slice(index, index + MEDIA_DOWNLOAD_BATCH_SIZE).map(async (url) => {
      try {
        return await library2Media.downloadImage(url);
      } catch (_) {
        return null;
      }
    }));
    for (const downloaded of batch) {
      if (downloaded) images.push(downloaded);
    }
  }
  if (!images.length && !String(payload && payload.body || "").trim() && !String(payload && payload.title || "").trim()) {
    return { ok: false, message: "没有提取到图片或文案" };
  }
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.token}`
  };
  const intent = await library2Api(`${appOrigin}/api/library2/upload-intents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      images: images.map((image) => ({ contentType: image.contentType, size: image.size }))
    })
  });
  if (!intent || !Array.isArray(intent.uploads) || intent.uploads.length !== images.length) {
    return { ok: false, message: "上传地址数量不一致" };
  }
  for (const [index, upload] of intent.uploads.entries()) {
    const response = await fetch(new URL(upload.uploadUrl, appOrigin).toString(), {
      method: "PUT",
      headers: { "Content-Type": upload.contentType },
      body: images[index].bytes
    });
    if (!response.ok) return { ok: false, message: `第 ${index + 1} 张图片上传失败` };
  }
  const platform = payload && ["小红书", "抖音", "TikTok"].includes(payload.platform) ? payload.platform : "小红书";
  await library2Api(`${appOrigin}/api/library2/items/${encodeURIComponent(intent.contentId)}/commit`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: {
        title: String(payload && payload.title || "").slice(0, 200),
        body: String(payload && payload.body || "").slice(0, 20_000),
        platform,
        sourceUrl: String(payload && payload.sourceUrl || "").slice(0, 2048)
      },
      uploads: intent.uploads
    })
  });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "library2:session") {
    const appOrigin = library2Session.normalizeOrigin(message.appOrigin);
    if (!appOrigin || typeof message.token !== "string" || !message.token || !Number.isInteger(message.expiresAt)) {
      sendResponse({ ok: false });
      return;
    }
    void chrome.storage.local.get(LIBRARY2_SESSIONS_STORAGE_KEY).then((stored) => {
      const sessions = library2Session.upsertSession(stored[LIBRARY2_SESSIONS_STORAGE_KEY], {
        appOrigin,
        token: message.token,
        expiresAt: message.expiresAt
      }, Date.now());
      return chrome.storage.local.set({ [LIBRARY2_SESSIONS_STORAGE_KEY]: sessions });
    }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "library2:upload") {
    void uploadLibrary2(message.payload || {}).then(sendResponse, (error) => {
      sendResponse({ ok: false, message: error && error.message ? String(error.message).slice(0, 300) : "上传失败" });
    });
    return true;
  }
});

recoveryPromise = recoverStaleSession().catch(() => {});
