(function (root, factory) {
  const actions = factory(root);
  if (typeof module === "object" && module.exports) module.exports = actions;
  else {
    root.XhsContentActions = actions;
    actions.register();
  }
})(globalThis, function (root) {
  const SEARCH_TIMEOUT_MS = 20_000;
  const DETAIL_TIMEOUT_MS = 10_000;
  const FILTER_WAIT_MS = 1_600;
  const SCROLL_WAIT_MS = 900;
  const SCROLL_LIMIT = 6;
  const POLL_MS = 250;
  const SEARCH_KEYS = ["action", "query", "limit", "mediaType", "dateRange", "sortBy"];
  const DETAIL_KEYS = ["action", "expectedTitle"];
  const MEDIA_TYPES = new Set(["全部", "图文", "视频"]);
  const DATE_RANGES = new Set(["全部", "一天内", "一周内", "半年内"]);
  const SORTS = new Set(["浏览量", "点赞量", "评论量", "收藏量"]);
  const DATE_LABELS = { "一天内": "一天内", "一周内": "一周内", "半年内": "半年内" };
  const SORT_LABELS = { "浏览量": "综合", "点赞量": "最多点赞", "评论量": "最多评论", "收藏量": "最多收藏" };
  const MEDIA_LABELS = { "图文": "图文", "视频": "视频" };

  function isExactRecord(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  }

  function validateMessage(message) {
    try {
      if (isExactRecord(message, SEARCH_KEYS) && message.action === "xhs:search") {
        if (typeof message.query !== "string" || !message.query.trim() || message.query.length > 40) return { ok: false };
        if (!Number.isSafeInteger(message.limit) || message.limit < 1 || message.limit > 5) return { ok: false };
        if (!MEDIA_TYPES.has(message.mediaType) || !DATE_RANGES.has(message.dateRange) || !SORTS.has(message.sortBy)) return { ok: false };
        return { ok: true, action: message.action, value: message };
      }
      if (isExactRecord(message, DETAIL_KEYS) && message.action === "xhs:detail") {
        if (typeof message.expectedTitle !== "string" || message.expectedTitle.length > 2_048) return { ok: false };
        return { ok: true, action: message.action, value: message };
      }
    } catch (_) {
      return { ok: false };
    }
    return { ok: false };
  }

  function delay(milliseconds) {
    return new Promise((resolve) => root.setTimeout(resolve, milliseconds));
  }

  async function waitUntil(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await delay(POLL_MS);
    }
    throw new Error("PAGE_TIMEOUT");
  }

  function collector() {
    if (!root.XhsPageCollector) throw new Error("COLLECTOR_UNAVAILABLE");
    return root.XhsPageCollector;
  }

  function documentState() {
    return collector().detectPageState(root.document);
  }

  function isVisible(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    try {
      const style = root.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
    } catch (_) {
      // Some test DOMs do not implement layout; attribute checks above remain valid.
    }
    return true;
  }

  function clickExactLabel(label) {
    if (!label) return false;
    const candidates = root.document.querySelectorAll("button, [role='button'], [role='option'], li, label, span, div");
    for (const element of candidates) {
      if (collector().clean(element.textContent) !== label || !isVisible(element)) continue;
      element.click();
      return true;
    }
    return false;
  }

  async function search(message) {
    await waitUntil(() => {
      if (!root.document.body) return false;
      if (!documentState().ok) return true;
      return Boolean(root.document.querySelector("section.note-item, .note-item, [data-note-id]"));
    }, SEARCH_TIMEOUT_MS);

    let state = documentState();
    if (!state.ok) return state;

    clickExactLabel("筛选");
    clickExactLabel(DATE_LABELS[message.dateRange]);
    clickExactLabel(SORT_LABELS[message.sortBy]);
    clickExactLabel(MEDIA_LABELS[message.mediaType]);
    await delay(FILTER_WAIT_MS);

    let rows = [];
    for (let scrollCount = 0; scrollCount <= SCROLL_LIMIT; scrollCount += 1) {
      state = documentState();
      if (!state.ok) return state;
      rows = collector().parseSearchCards(root.document, message.query.trim(), message.limit);
      if (rows.length >= message.limit || scrollCount === SCROLL_LIMIT) break;
      root.scrollBy({ top: Math.round(root.innerHeight * 0.9), behavior: "smooth" });
      await delay(SCROLL_WAIT_MS);
    }
    return { ok: true, rows };
  }

  async function detail(message) {
    await waitUntil(() => {
      if (!root.document.body) return false;
      if (!documentState().ok) return true;
      return Boolean(root.document.querySelector("h1.title, .note-title, .title, img, video"));
    }, DETAIL_TIMEOUT_MS);
    return collector().parseDetail(root.document, message.expectedTitle);
  }

  async function handleMessage(message) {
    const checked = validateMessage(message);
    if (!checked.ok) return { ok: false, code: "INVALID_ACTION", message: "不支持的页面操作" };
    try {
      return checked.action === "xhs:search" ? await search(checked.value) : await detail(checked.value);
    } catch (error) {
      const code = error instanceof Error && error.message === "PAGE_TIMEOUT" ? "PAGE_TIMEOUT" : "PAGE_ACTION_FAILED";
      return { ok: false, code, message: code === "PAGE_TIMEOUT" ? "小红书页面加载超时" : "小红书页面操作失败" };
    }
  }

  function register() {
    const chrome = root.chrome;
    if (!chrome || !chrome.runtime || !chrome.runtime.onMessage) return;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      handleMessage(message).then(sendResponse);
      return true;
    });
  }

  return Object.freeze({ validateMessage, handleMessage, register });
});
