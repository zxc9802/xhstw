(function (root, factory) {
  const collector = factory();
  if (typeof module === "object" && module.exports) module.exports = collector;
  else root.XhsPageCollector = collector;
})(globalThis, function () {
  const NOTE_ID_PATTERN = /(?:^|\/(?:explore|item|search_result)\/|\/discovery\/item\/)([0-9a-f]{16,32})(?:$|[/?#])/i;
  const MAX_FIELD_LENGTH = 2048;
  const MAX_MEDIA_NAME_LENGTH = 300;
  const MAX_MEDIA_ITEMS = 20;
  const BLOCK_MESSAGES = {
    RATE_LIMITED: "小红书提示访问频繁，请稍后再试",
    CAPTCHA: "请完成小红书安全验证后再试",
    LOGIN_REQUIRED: "请先登录小红书后再试"
  };
  const DETAIL_ROOT_SELECTOR = ".note-detail-mask, [role='dialog'][class*='note'], [role='dialog'] .note-container";
  const UNAVAILABLE_DETAIL_PATTERN = /^(?:当前笔记暂时无法浏览|笔记已删除|无权限查看|该内容无法查看|内容不存在)$/;

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

  function bounded(value, maximum) {
    return clean(value).slice(0, maximum);
  }

  function boundedHttpsUrl(value) {
    const url = clean(value);
    return url.length <= MAX_FIELD_LENGTH && isHttpsUrl(url) ? url : "";
  }

  function isHidden(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      const style = attr(current, "style").toLowerCase();
      if ((typeof current.hasAttribute === "function" && current.hasAttribute("hidden")) || attr(current, "aria-hidden").toLowerCase() === "true" || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/.test(style)) return true;
      try {
        const view = current.ownerDocument && current.ownerDocument.defaultView;
        const computed = view && typeof view.getComputedStyle === "function" ? view.getComputedStyle(current) : null;
        if (computed && (clean(computed.display).toLowerCase() === "none" || clean(computed.visibility).toLowerCase() === "hidden")) return true;
      } catch (_) {
        // Attribute and inline-style checks remain available without layout support.
      }
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
    const directRateLimit = /^(?:300013|安全限制|访问频繁|安全限制\s*[\/、，,]\s*访问频繁|访问频繁\s*[\/、，,]\s*安全限制|安全限制\s+访问频繁\s+300013)$/;
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
    if (/安全限制/.test(pageText) && /访问频繁\s*[，,]?\s*请稍后再试/.test(pageText) && /300013/.test(pageText) && /返回首页/.test(pageText)) {
      return { ok: false, code: "RATE_LIMITED", message: BLOCK_MESSAGES.RATE_LIMITED };
    }
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

  function findDetailRoot(input) {
    try {
      if (input && input.nodeType === 1 && typeof input.matches === "function" && input.matches(DETAIL_ROOT_SELECTOR) && !isHidden(input)) {
        return input;
      }
    } catch (_) {
      // Fall through to scoped lookup.
    }
    return queryAll(input, DETAIL_ROOT_SELECTOR).find((element) => !isHidden(element)) || null;
  }

  function unavailableDetailState(root) {
    for (const element of queryAll(root, "h1, .title, .error, .error-message, .note-error")) {
      const message = text(element);
      if (UNAVAILABLE_DETAIL_PATTERN.test(message)) {
        return { ok: false, code: "NOTE_UNAVAILABLE", message };
      }
    }
    return null;
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

  function findSearchCardLink(document, targetUrl) {
    const targetId = noteId(targetUrl);
    if (!targetId) return null;
    for (const card of queryAll(document, "section.note-item, .note-item, [data-note-id]")) {
      const links = queryAll(card, 'a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/item/"], a[href*="/search_result/"]');
      for (const link of links) {
        if (noteId(attr(link, "href")) === targetId && !isHidden(link)) return link;
      }
    }
    return null;
  }

  function visibleSearchCardLink(card) {
    const links = queryAll(card, 'a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/item/"], a[href*="/search_result/"]');
    for (const link of links) {
      if (!isHidden(link)) return link;
    }
    return null;
  }

  function parseSearchCards(document, queryText, limit) {
    try {
      const maximum = Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
      const rows = [];
      for (const card of queryAll(document, "section.note-item, .note-item, [data-note-id]")) {
        if (rows.length >= maximum) break;
        const link = visibleSearchCardLink(card);
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
      if (media.length >= MAX_MEDIA_ITEMS) break;
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

  function extractTags(content) {
    const tags = [];
    const seen = new Set();
    const matches = clean(content).match(/#[^\s#，。！？、,.!?;；:：()（）【】[\]{}<>]+/g) || [];
    for (const match of matches) {
      const tag = bounded(match.slice(1), 100);
      if (!tag || seen.has(tag) || tags.length >= 10) continue;
      seen.add(tag);
      tags.push(tag);
    }
    return tags;
  }

  function parseDetail(input, expectedTitle) {
    const state = detectPageState(input);
    if (!state.ok) return state;
    const detailRoot = input && input.nodeType === 1 ? input : findDetailRoot(input);
    if (!detailRoot) {
      return { ok: false, code: "PAGE_STRUCTURE_CHANGED", message: "未检测到有效的小红书详情内容" };
    }
    const unavailable = unavailableDetailState(detailRoot);
    if (unavailable) return unavailable;
    try {
      const title = text(detailRoot, "h1.title, .note-title, .note-content .title, .title") || clean(expectedTitle);
      const content = text(detailRoot, ".note-content .desc, .desc, .content, #detail-desc");
      const author = text(detailRoot, ".author .username, .author-name, .user .name, .username, .author");
      const publishedAt = text(detailRoot, "time, .date, .published-at");
      const engagementRoot = query(detailRoot, ".buttons.engage-bar-style, .interact-container") || detailRoot;
      const likes = text(engagementRoot, ".like-wrapper .count, .likes, .like-count");
      const comments = text(engagementRoot, ".chat-wrapper .count, .comments, .comment-count");
      const saves = text(engagementRoot, ".collect-wrapper .count, .saves, .collect-count, .favorite-count");
      const media = parseMedia(detailRoot);
      if (!content || !media.length) {
        return { ok: false, code: "DETAIL_INCOMPLETE", message: "详情正文或图片未完整加载" };
      }
      if (!title) {
        return { ok: false, code: "PAGE_STRUCTURE_CHANGED", message: "未检测到有效的小红书详情内容" };
      }
      return {
        ok: true,
        title,
        author,
        content,
        publishedAt,
        likes,
        comments,
        saves,
        tags: extractTags(content),
        media
      };
    } catch (_) {
      return { ok: false, code: "PAGE_STRUCTURE_CHANGED", message: "未检测到有效的小红书详情内容" };
    }
  }

  function safeMedia(media) {
    if (!Array.isArray(media)) return [];
    const seen = new Set();
    const result = [];
    for (const item of media) {
      const url = item && boundedHttpsUrl(item.url);
      if (result.length >= MAX_MEDIA_ITEMS || !item || (item.type !== "image" && item.type !== "video") || !url || seen.has(url)) continue;
      seen.add(url);
      result.push({
        type: item.type,
        url,
        ...(bounded(item.name, MAX_MEDIA_NAME_LENGTH) ? { name: bounded(item.name, MAX_MEDIA_NAME_LENGTH) } : {}),
        ...(boundedHttpsUrl(item.posterUrl) ? { posterUrl: boundedHttpsUrl(item.posterUrl) } : {})
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
    const title = bounded(sourceDetail.title, MAX_FIELD_LENGTH) || bounded(sourceRow.title, MAX_FIELD_LENGTH) || "未命名笔记";
    const rowCoverUrl = boundedHttpsUrl(sourceRow.coverUrl);
    let media = safeMedia(sourceDetail.media);
    if (!media.length && rowCoverUrl) {
      media = [{ type: "image", url: rowCoverUrl, name: "搜索封面" }];
    }
    const cover = media[0];
    const coverUrl = cover ? cover.url : rowCoverUrl;
    const url = normalizeNoteUrl(sourceRow.url);
    const normalizedUrl = noteId(sourceRow.url) ? boundedHttpsUrl(url) : "";
    const author = bounded(sourceDetail.author, MAX_FIELD_LENGTH) || bounded(sourceRow.author, MAX_FIELD_LENGTH) || "未知作者";
    const timestamp = bounded(now instanceof Date && !Number.isNaN(now.valueOf()) ? now.toISOString() : String(now), MAX_FIELD_LENGTH) || "-";

    return {
      id: bounded(topicId(sourceRow, title), MAX_FIELD_LENGTH),
      platform: "小红书",
      title,
      contentType: media.some((item) => item.type === "video") ? "视频" : "图文",
      likes: bounded(sourceDetail.likes, MAX_FIELD_LENGTH) || bounded(sourceRow.likes, MAX_FIELD_LENGTH) || "-",
      views: bounded(sourceDetail.views, MAX_FIELD_LENGTH) || bounded(sourceRow.views, MAX_FIELD_LENGTH) || "-",
      comments: bounded(sourceDetail.comments, MAX_FIELD_LENGTH) || bounded(sourceRow.comments, MAX_FIELD_LENGTH) || "-",
      saves: bounded(sourceDetail.saves, MAX_FIELD_LENGTH) || bounded(sourceRow.saves, MAX_FIELD_LENGTH) || "-",
      risk: "低",
      priority: "P2",
      status: "pending",
      sourceAccount: bounded(`本机浏览器 · ${author}`, MAX_FIELD_LENGTH),
      fetchedAt: timestamp,
      ...(normalizedUrl ? { url: normalizedUrl } : {}),
      ...(coverUrl ? { coverUrl, coverType: cover ? cover.type : "image" } : {}),
      ...(media.length ? { media, mediaType: media.some((item) => item.type === "video") ? "视频" : "图文" } : {}),
      ...(bounded(sourceRow.query, MAX_FIELD_LENGTH) ? { keyword: bounded(sourceRow.query, MAX_FIELD_LENGTH) } : {}),
      ...(bounded(sourceDetail.content, MAX_FIELD_LENGTH) ? { parsedContent: bounded(sourceDetail.content, MAX_FIELD_LENGTH) } : {})
    };
  }

  return Object.freeze({ clean, detectPageState, noteId, normalizeNoteUrl, findDetailRoot, findSearchCardLink, parseSearchCards, parseDetail, buildTopic });
});
