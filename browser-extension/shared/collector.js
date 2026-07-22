(function (root, factory) {
  const collector = factory();
  if (typeof module === "object" && module.exports) module.exports = collector;
  else root.XhsPageCollector = collector;
})(globalThis, function () {
  const NOTE_ID_PATTERN = /(?:^|\/(?:explore|item|search_result)\/|\/discovery\/item\/)([0-9a-f]{16,32})(?:$|[/?#])/i;
  const BLOCK_MESSAGES = {
    RATE_LIMITED: "小红书提示访问频繁，请稍后再试",
    CAPTCHA: "请完成小红书安全验证后再试",
    LOGIN_REQUIRED: "请先登录小红书后再试"
  };

  function clean(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function query(root, selector) {
    try {
      return root && typeof root.querySelector === "function" ? root.querySelector(selector) : null;
    } catch (_) {
      return null;
    }
  }

  function queryAll(root, selector) {
    try {
      return root && typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll(selector)) : [];
    } catch (_) {
      return [];
    }
  }

  function text(root, selector) {
    const element = selector ? query(root, selector) : root;
    return clean(element && element.textContent);
  }

  function isHttpsUrl(value) {
    if (!clean(value)) return false;
    try {
      return new URL(value).protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function isHidden(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      const style = attr(current, "style").toLowerCase();
      if ((typeof current.hasAttribute === "function" && current.hasAttribute("hidden")) || attr(current, "aria-hidden").toLowerCase() === "true" || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/.test(style)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function visibleText(root) {
    try {
      const collect = (node) => {
        if (!node) return "";
        if (node.nodeType === 1 && isHidden(node)) return "";
        if (node.nodeType === 3) return node.nodeValue || "";
        if (!node.childNodes) return "";
        return Array.from(node.childNodes).map(collect).join(" ");
      };
      const value = clean(collect(root));
      if (value || (root && root.childNodes && root.childNodes.length)) return value;
      return clean(root && root.textContent);
    } catch (_) {
      return "";
    }
  }

  function hasVisible(root, selector) {
    return queryAll(root, selector).some((element) => !isHidden(element));
  }

  function pageStateFromText(value, direct) {
    const pageText = clean(value);
    const exact = (pattern) => pattern.test(pageText);
    const directRateLimit = /^(?:300013|安全限制|访问频繁|安全限制\s*[\/、，,]\s*访问频繁|访问频繁\s*[\/、，,]\s*安全限制)$/;
    const rateLimitPage = /^(?:错误\s*)?300013\s*[：:,，]\s*(?:访问频繁|安全限制)(?:\s*[，,].*)?$|^(?:小红书|系统)(?:提示)?\s*(?:访问频繁|安全限制)\s*[，,:：]\s*(?:请稍后再试|操作频繁).*$/;
    const directCaptcha = /^(?:验证码|请完成(?:安全)?验证码|请完成验证|滑块验证)$/;
    if (rateLimitPage.test(pageText) || (direct && exact(directRateLimit))) {
      return { ok: false, code: "RATE_LIMITED", message: BLOCK_MESSAGES.RATE_LIMITED };
    }
    if ((direct && exact(directCaptcha)) || /^(?:请完成(?:安全)?验证码|请完成验证|请进行滑块验证|需要(?:安全)?验证码)$/.test(pageText)) {
      return { ok: false, code: "CAPTCHA", message: BLOCK_MESSAGES.CAPTCHA };
    }
    if (direct && exact(/^(?:登录后查看|手机号登录|扫码登录)$/)) {
      return { ok: false, code: "LOGIN_REQUIRED", message: BLOCK_MESSAGES.LOGIN_REQUIRED };
    }
    return null;
  }

  function detectPageState(input) {
    if (typeof input === "string") return pageStateFromText(input, true) || { ok: true };
    const pageText = visibleText(input);
    const textState = pageStateFromText(pageText, true);
    if (textState) return textState;
    if (hasVisible(input, ".rate-limit, .security, [data-rate-limit], [data-security]") && /300013|安全限制|访问频繁/.test(pageText)) {
      return { ok: false, code: "RATE_LIMITED", message: BLOCK_MESSAGES.RATE_LIMITED };
    }
    if (hasVisible(input, ".captcha, .verify, .slider-verify, [data-captcha], [data-verify]") && /验证码|验证|滑块/.test(pageText)) {
      return { ok: false, code: "CAPTCHA", message: BLOCK_MESSAGES.CAPTCHA };
    }
    const loginInput = hasVisible(input, 'input[type="password"], input[name*="password" i]');
    const loginPanel = hasVisible(input, ".login-container, .login-panel, [data-login-form], [data-testid='login']");
    if (loginInput || loginPanel) return { ok: false, code: "LOGIN_REQUIRED", message: BLOCK_MESSAGES.LOGIN_REQUIRED };
    return { ok: true };
  }

  function noteId(value) {
    const source = clean(value);
    if (/^[0-9a-f]{16,32}$/i.test(source)) return source;
    const match = source.match(NOTE_ID_PATTERN);
    return match ? match[1] : "";
  }

  function normalizeNoteUrl(value) {
    const id = noteId(value);
    if (!id) return value;
    let source;
    try {
      source = new URL(String(value), "https://www.xiaohongshu.com");
    } catch (_) {
      source = new URL("https://www.xiaohongshu.com");
    }
    const target = new URL(`https://www.xiaohongshu.com/explore/${id}`);
    const token = source.searchParams.get("xsec_token");
    const sourceValue = source.searchParams.get("xsec_source");
    if (token) target.searchParams.set("xsec_token", token);
    target.searchParams.set("xsec_source", sourceValue || "pc_search");
    return target.toString();
  }

  function attr(element, name) {
    try {
      return clean(element && typeof element.getAttribute === "function" ? element.getAttribute(name) : "");
    } catch (_) {
      return "";
    }
  }

  function mediaUrl(element) {
    const current = clean(element && element.currentSrc);
    return current || attr(element, "src");
  }

  function parseSearchCards(document, queryText, limit) {
    try {
      const maximum = Math.max(0, Number.isInteger(limit) ? limit : 0);
      const rows = [];
      for (const card of queryAll(document, "section.note-item, .note-item, [data-note-id]")) {
        if (rows.length >= maximum) break;
        const link = query(card, 'a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/item/"], a[href*="/search_result/"]');
        const href = attr(link, "href");
        const url = normalizeNoteUrl(href);
        const title = text(card, ".title") || text(link);
        if (!title || !noteId(href)) continue;
        const author = text(card, ".author");
        const coverUrl = mediaUrl(query(card, "img"));
        const likes = text(card, ".likes, .like-count");
        const publishedAt = text(card, "time, .date, .published-at");
        rows.push({
          title,
          ...(author ? { author } : {}),
          url,
          ...(isHttpsUrl(coverUrl) ? { coverUrl } : {}),
          ...(likes ? { likes } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          query: clean(queryText)
        });
      }
      return rows;
    } catch (_) {
      return [];
    }
  }

  function parseMedia(document) {
    const media = [];
    const seen = new Set();
    for (const element of queryAll(document, "img, video")) {
      if (media.length >= 10) break;
      const url = mediaUrl(element);
      let ancestor = element;
      let context = "";
      while (ancestor && ancestor.nodeType === 1) {
        context += ` ${attr(ancestor, "class")} ${attr(ancestor, "id")} ${attr(ancestor, "role")} ${attr(ancestor, "aria-label")}`;
        ancestor = ancestor.parentElement;
      }
      const descriptor = `${url} ${attr(element, "class")} ${attr(element, "alt")} ${context}`.toLowerCase();
      if (!isHttpsUrl(url) || /avatar|profile|icon|emoji|comment/.test(descriptor) || seen.has(url)) continue;
      seen.add(url);
      const type = String(element.tagName).toLowerCase() === "video" ? "video" : "image";
      const name = attr(element, "alt") || attr(element, "title");
      const posterUrl = type === "video" ? attr(element, "poster") : "";
      media.push({
        type,
        url,
        ...(name ? { name } : {}),
        ...(isHttpsUrl(posterUrl) ? { posterUrl } : {})
      });
    }
    return media;
  }

  function parseDetail(document, expectedTitle) {
    const state = detectPageState(document);
    if (!state.ok) return state;
    try {
      const title = text(document, "h1.title, .note-title, .title") || clean(expectedTitle);
      return {
        ok: true,
        title,
        author: text(document, ".author, .author-name"),
        content: text(document, ".content, .note-content, #detail-desc"),
        publishedAt: text(document, "time, .date, .published-at"),
        likes: text(document, ".likes, .like-count"),
        comments: text(document, ".comments, .comment-count"),
        saves: text(document, ".saves, .collect-count, .favorite-count"),
        media: parseMedia(document)
      };
    } catch (_) {
      return {
        ok: true,
        title: clean(expectedTitle),
        author: "",
        content: "",
        publishedAt: "",
        likes: "",
        comments: "",
        saves: "",
        media: []
      };
    }
  }

  function safeMedia(media) {
    if (!Array.isArray(media)) return [];
    const seen = new Set();
    const result = [];
    for (const item of media) {
      if (result.length >= 10 || !item || (item.type !== "image" && item.type !== "video") || !isHttpsUrl(item.url) || seen.has(item.url)) continue;
      seen.add(item.url);
      result.push({
        type: item.type,
        url: item.url,
        ...(clean(item.name) ? { name: clean(item.name) } : {}),
        ...(isHttpsUrl(item.posterUrl) ? { posterUrl: item.posterUrl } : {})
      });
    }
    return result;
  }

  function topicId(row, title) {
    const id = noteId(row && row.url);
    if (id) return `local_xhs_${id}`;
    const fallback = clean(title).replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 120);
    return `local_xhs_${fallback || "untitled"}`;
  }

  function buildTopic(row, detail, now) {
    const sourceRow = row && typeof row === "object" ? row : {};
    const sourceDetail = detail && typeof detail === "object" ? detail : {};
    const title = clean(sourceDetail.title) || clean(sourceRow.title) || "未命名笔记";
    let media = safeMedia(sourceDetail.media);
    if (!media.length && isHttpsUrl(sourceRow.coverUrl)) {
      media = [{ type: "image", url: sourceRow.coverUrl, name: "搜索封面" }];
    }
    const coverUrl = isHttpsUrl(sourceRow.coverUrl) ? sourceRow.coverUrl : (media[0] && media[0].url);
    const cover = media.find((item) => item.url === coverUrl);
    const url = normalizeNoteUrl(sourceRow.url);
    const normalizedUrl = noteId(sourceRow.url) && isHttpsUrl(url) ? url : "";
    const author = clean(sourceDetail.author) || clean(sourceRow.author) || "未知作者";
    const timestamp = now instanceof Date && !Number.isNaN(now.valueOf()) ? now.toISOString() : String(now);

    return {
      id: topicId(sourceRow, title),
      platform: "小红书",
      title,
      contentType: media.some((item) => item.type === "video") ? "视频" : "图文",
      likes: clean(sourceDetail.likes) || clean(sourceRow.likes) || "-",
      views: clean(sourceDetail.views) || clean(sourceRow.views) || "-",
      comments: clean(sourceDetail.comments) || clean(sourceRow.comments) || "-",
      saves: clean(sourceDetail.saves) || clean(sourceRow.saves) || "-",
      risk: "低",
      priority: "P2",
      status: "pending",
      sourceAccount: `本机浏览器 · ${author}`,
      fetchedAt: timestamp,
      ...(normalizedUrl ? { url: normalizedUrl } : {}),
      ...(coverUrl ? { coverUrl, coverType: cover ? cover.type : "image" } : {}),
      ...(media.length ? { media, mediaType: media.some((item) => item.type === "video") ? "视频" : "图文" } : {}),
      ...(clean(sourceRow.query) ? { keyword: clean(sourceRow.query) } : {}),
      ...(clean(sourceDetail.content) ? { parsedContent: clean(sourceDetail.content) } : {})
    };
  }

  return Object.freeze({ clean, detectPageState, noteId, normalizeNoteUrl, parseSearchCards, parseDetail, buildTopic });
});
