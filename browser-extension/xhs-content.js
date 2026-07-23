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
  const DETAIL_CLOSE_TIMEOUT_MS = 3_000;
  const FILTER_ACTION_TIMEOUT_MS = 2_000;
  const FILTER_WAIT_MS = 1_600;
  const SEARCH_SETTLE_MS = 1_200;
  const SCROLL_WAIT_MS = 900;
  const SCROLL_LIMIT = 6;
  const POLL_MS = 250;
  const SEARCH_KEYS = ["action", "query", "limit", "mediaType", "dateRange", "sortBy"];
  const DETAIL_KEYS = ["action", "expectedTitle", "targetUrl"];
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
        if (!isXhsNoteUrl(message.targetUrl)) return { ok: false };
        return { ok: true, action: message.action, value: message };
      }
    } catch (_) {
      return { ok: false };
    }
    return { ok: false };
  }

  function isXhsNoteUrl(value) {
    if (typeof value !== "string" || value.length > 2_048) return false;
    try {
      const url = new URL(value);
      const xhsHost = url.hostname === "www.xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com");
      const notePath = /\/(?:explore|item|search_result)\/[0-9a-f]{16,32}$/i.test(url.pathname)
        || /\/discovery\/item\/[0-9a-f]{16,32}$/i.test(url.pathname);
      return url.protocol === "https:" && xhsHost && notePath;
    } catch (_) {
      return false;
    }
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
    let current = element;
    while (current && current.nodeType === 1) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      try {
        const style = root.getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
      } catch (_) {
        // Some test DOMs do not implement layout; attribute checks above remain valid.
      }
      current = current.parentElement;
    }
    return Boolean(element);
  }

  function exactLabelElement(label) {
    if (!label) return null;
    for (const selector of ["button, [role='button'], [role='option'], li, label", "span, div"]) {
      for (const element of root.document.querySelectorAll(selector)) {
        if (collector().clean(element.textContent) === label && isVisible(element)) return element;
      }
    }
    return null;
  }

  function clickExactLabel(label) {
    const element = exactLabelElement(label);
    if (!element) return null;
    element.click();
    return element;
  }

  function isSelected(element) {
    let current = element;
    for (let depth = 0; current && current.nodeType === 1 && depth < 4; depth += 1) {
      const className = typeof current.className === "string" ? current.className : "";
      if (/\b(?:active|selected|checked)\b/i.test(className)
        || current.getAttribute("aria-selected") === "true"
        || current.getAttribute("aria-checked") === "true"
        || current.getAttribute("data-state") === "checked") return true;
      current = current.parentElement;
    }
    return false;
  }

  async function applyFilter(label) {
    if (!label) return;
    try {
      await waitUntil(() => Boolean(exactLabelElement(label)), FILTER_ACTION_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof Error && error.message === "PAGE_TIMEOUT") throw new Error("FILTER_NOT_FOUND");
      throw error;
    }
    const element = clickExactLabel(label);
    if (!element) throw new Error("FILTER_NOT_FOUND");
    await waitUntil(() => {
      const current = exactLabelElement(label);
      return Boolean(current && isSelected(current));
    }, FILTER_ACTION_TIMEOUT_MS);
  }

  function visibleElement(selector) {
    for (const element of root.document.querySelectorAll(selector)) {
      if (isVisible(element)) return element;
    }
    return null;
  }

  function submitSearch(query) {
    const input = visibleElement("input[placeholder*='搜索'], input[type='search']");
    const button = visibleElement("button.min-width-search-icon, button[class*='search-icon'], .input-button .search-icon");
    if (!input || !button || collector().clean(input.value) !== collector().clean(query)) {
      throw new Error("SEARCH_SUBMIT_FAILED");
    }
    button.click();
  }

  function openFilterPanel() {
    for (const selector of [".filter span", ".filter"]) {
      for (const element of root.document.querySelectorAll(selector)) {
        if (collector().clean(element.textContent) !== "筛选" || !isVisible(element)) continue;
        element.click();
        return true;
      }
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

    submitSearch(message.query.trim());
    await delay(SEARCH_SETTLE_MS);
    if (!openFilterPanel()) throw new Error("FILTER_NOT_FOUND");
    await applyFilter(DATE_LABELS[message.dateRange]);
    await applyFilter(SORT_LABELS[message.sortBy]);
    await applyFilter(MEDIA_LABELS[message.mediaType]);
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

  function closeDetail(detailRoot) {
    const button = detailRoot.querySelector("button[aria-label='关闭'], [aria-label='关闭'], .close-circle, .close");
    if (!button || !isVisible(button)) throw new Error("DETAIL_CLOSE_FAILED");
    button.click();
  }

  function expectedCarouselMediaCount(detailRoot) {
    const indexes = new Set();
    for (const slide of detailRoot.querySelectorAll("[data-swiper-slide-index]")) {
      const index = slide.getAttribute("data-swiper-slide-index");
      if (index !== null && index !== "") indexes.add(index);
    }
    return indexes.size;
  }

  async function detail(message) {
    const link = collector().findSearchCardLink(root.document, message.targetUrl);
    if (!link || !isVisible(link)) {
      return { ok: false, code: "PAGE_STRUCTURE_CHANGED", message: "未找到对应的小红书搜索卡片" };
    }
    link.click();
    await waitUntil(() => {
      if (!root.document.body) return false;
      if (!documentState().ok) return true;
      return Boolean(collector().findDetailRoot(root.document));
    }, DETAIL_TIMEOUT_MS);
    const state = documentState();
    if (!state.ok) return state;
    let response = null;
    await waitUntil(() => {
      const currentRoot = collector().findDetailRoot(root.document);
      if (!currentRoot) return false;
      const candidate = collector().parseDetail(currentRoot, message.expectedTitle);
      if (candidate.code === "NOTE_UNAVAILABLE") {
        response = candidate;
        return true;
      }
      if (!candidate.ok) return false;
      const expectedMediaCount = expectedCarouselMediaCount(currentRoot);
      if (expectedMediaCount && candidate.media.length < expectedMediaCount) return false;
      response = candidate;
      return true;
    }, DETAIL_TIMEOUT_MS);
    const detailRoot = collector().findDetailRoot(root.document);
    if (!detailRoot || !response) return { ok: false, code: "PAGE_STRUCTURE_CHANGED", message: "未检测到小红书详情弹层" };
    closeDetail(detailRoot);
    await waitUntil(() => !collector().findDetailRoot(root.document), DETAIL_CLOSE_TIMEOUT_MS);
    return response;
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
