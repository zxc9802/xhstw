(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioPageExtract = api;
})(globalThis, function (root) {
  const MAX_IMAGES = 20;
  const MAX_TEXT = 20_000;
  const AVATAR_PATTERN = /avatar|profile|icon|emoji|comment|logo|qrcode|qr-code|head(?:er|shot)?|favicon/i;

  function clean(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function bounded(value, max) {
    return clean(value).slice(0, max);
  }

  function detectPlatform(href) {
    try {
      const host = new URL(href).hostname.toLowerCase();
      if (host === "www.xiaohongshu.com" || host.endsWith(".xiaohongshu.com")) return "小红书";
      if (host === "www.douyin.com" || host.endsWith(".douyin.com") || host.endsWith(".iesdouyin.com")) return "抖音";
      if (host === "www.tiktok.com" || host.endsWith(".tiktok.com")) return "TikTok";
      return "";
    } catch (_) {
      return "";
    }
  }

  function isHttpsUrl(value) {
    try {
      return new URL(value).protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function normalizeImageUrl(value) {
    const raw = clean(value);
    if (!raw) return "";
    try {
      const url = new URL(raw, "https://www.xiaohongshu.com");
      if (url.protocol !== "https:") return "";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
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
    try {
      const element = selector ? root.querySelector(selector) : root;
      return clean(element && element.textContent);
    } catch (_) {
      return "";
    }
  }

  function collectDomImages(root) {
    const urls = [];
    const seen = new Set();
    for (const element of queryAll(root, "img, source, [style*='background-image']")) {
      const candidates = [
        element.getAttribute && element.getAttribute("src"),
        element.getAttribute && element.getAttribute("data-src"),
        element.getAttribute && element.getAttribute("data-url"),
        element.src,
        element.currentSrc
      ];
      const srcset = element.getAttribute && element.getAttribute("srcset");
      if (srcset) candidates.push(srcset.split(",")[0].trim().split(" ")[0]);
      const style = element.getAttribute && element.getAttribute("style");
      const background = style && style.match(/url\(["']?(https:[^"')]+)["']?\)/i);
      if (background) candidates.push(background[1]);
      const altText = element.getAttribute && element.getAttribute("alt");
      const descriptor = [
        element.className,
        element.id,
        /image posted by/i.test(altText || "") ? "" : altText,
        element.getAttribute && element.getAttribute("aria-label")
      ].join(" ");
      if (AVATAR_PATTERN.test(descriptor)) continue;
      for (const candidate of candidates) {
        const url = normalizeImageUrl(candidate);
        if (!url || seen.has(url) || /avatar|head\d+|default-avatar|logo/i.test(url)) continue;
        seen.add(url);
        urls.push(url);
        if (urls.length >= MAX_IMAGES) return urls;
      }
    }
    return urls;
  }

  function parseJsonScripts(document, testers) {
    for (const script of queryAll(document, "script")) {
      const raw = script.textContent || "";
      if (!raw || raw.length > 4_000_000) continue;
      for (const tester of testers) {
        try {
          const extracted = tester(raw);
          if (extracted) return extracted;
        } catch (_) {
          // Keep scanning other scripts.
        }
      }
    }
    return null;
  }

  function walkStrings(value, visit, depth = 0) {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      visit(value);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 80).forEach((item) => walkStrings(item, visit, depth + 1));
      return;
    }
    if (typeof value === "object") {
      Object.values(value).slice(0, 80).forEach((item) => walkStrings(item, visit, depth + 1));
    }
  }

  function xhsNoteId(href) {
    try {
      const match = new URL(href).pathname.match(/\/(?:explore|item|search_result|discovery\/item)\/([0-9a-f]{16,32})(?:\/|$)/i);
      return match ? match[1] : "";
    } catch (_) {
      return "";
    }
  }

  function isEffectivelyHidden(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      if (typeof current.hasAttribute === "function" && current.hasAttribute("hidden")) return true;
      if (current.getAttribute && current.getAttribute("aria-hidden") === "true") return true;
      current = current.parentElement;
    }
    return false;
  }

  function xhsDetailRoot(document) {
    const collector = root.XhsPageCollector;
    if (collector && typeof collector.findDetailRoot === "function") {
      const rootNode = collector.findDetailRoot(document);
      if (rootNode && !isEffectivelyHidden(rootNode)) return rootNode;
    }
    return queryAll(document, ".note-detail-mask, [role='dialog'][class*='note'], [role='dialog'] .note-container")
      .find((element) => !isEffectivelyHidden(element)) || null;
  }

  function isXhsImageDetail(document, href) {
    return Boolean(xhsDetailRoot(document) || xhsNoteId(href));
  }

  function extractXhs(document, href) {
    const detailRoot = xhsDetailRoot(document);
    if (!detailRoot && !xhsNoteId(href)) return { ok: false, reason: "not-detail" };
    const scope = detailRoot || document;
    const collector = root.XhsPageCollector;
    if (collector && typeof collector.parseDetail === "function") {
      const detail = collector.parseDetail(detailRoot || document, "");
      if (detail && detail.ok) {
        const media = Array.isArray(detail.media) ? detail.media : [];
        const videos = media.filter((item) => item && item.type === "video");
        const images = media.filter((item) => item && item.type === "image").map((item) => normalizeImageUrl(item.url)).filter(Boolean);
        if (videos.length && !images.length) return { ok: false, reason: "video" };
        if (!images.length && !detail.content) return { ok: false, reason: "incomplete" };
        return {
          ok: true,
          kind: "image",
          platform: "小红书",
          sourceUrl: href.split("#")[0],
          title: bounded(detail.title, 200),
          body: bounded(detail.content, MAX_TEXT),
          imageUrls: images.slice(0, MAX_IMAGES)
        };
      }
    }
    const title = text(scope, "h1.title, .note-title, .title") || text(scope, "h1");
    const body = text(scope, "#detail-desc, .note-content .desc, .desc, .content");
    const imageUrls = collectDomImages(scope);
    if (!imageUrls.length && !body) return { ok: false, reason: "incomplete" };
    if (queryAll(scope, "video").length && !imageUrls.length) return { ok: false, reason: "video" };
    return {
      ok: true,
      kind: "image",
      platform: "小红书",
      sourceUrl: href.split("#")[0],
      title: bounded(title, 200),
      body: bounded(body, MAX_TEXT),
      imageUrls
    };
  }

  function safeJson(raw) {
    const text = clean(raw);
    if (!text) return null;
    for (const candidate of [text, (() => {
      try {
        return decodeURIComponent(text);
      } catch (_) {
        return "";
      }
    })()]) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (_) {
        // Keep trying other encodings.
      }
    }
    return null;
  }

  function douyinNoteId(href) {
    try {
      const url = new URL(href, "https://www.douyin.com");
      const queryId = url.searchParams.get("modal_id")
        || url.searchParams.get("note_id")
        || url.searchParams.get("aweme_id")
        || url.searchParams.get("item_ids")
        || "";
      if (/^\d+$/.test(queryId)) return queryId;
      const pathId = url.pathname.match(/\/(?:note|video|slides|jingxuan|share\/(?:note|video))\/(\d+)(?:\/|$)/i);
      return pathId ? pathId[1] : "";
    } catch (_) {
      return "";
    }
  }

  function isDouyinListPath(pathname) {
    return pathname === "/" || /\/(search|recommend|discover|jingxuan|user|follow|friend|channel|hot)(\/|$)/i.test(pathname);
  }

  function isDouyinImageDetail(_document, href) {
    return Boolean(douyinNoteId(href));
  }

  function collectDouyinDataBlobs(document) {
    const blobs = [];
    const push = (value) => {
      if (value && typeof value === "object") blobs.push(value);
    };
    const render = document.getElementById("RENDER_DATA") || document.querySelector("script#RENDER_DATA");
    if (render && render.textContent) push(safeJson(render.textContent));
    for (const script of queryAll(document, "script")) {
      const raw = script.textContent || "";
      if (!raw || raw.length > 4_000_000) continue;
      if (!/aweme|RENDER_DATA|_ROUTER_DATA|note_id|image_post_info|modal_id/i.test(raw)) continue;
      push(safeJson(raw));
      const encoded = raw.match(/id="RENDER_DATA"[^>]*>([^<]+)</);
      if (encoded) push(safeJson(encoded[1]));
      const assigned = raw.match(/(?:window\._ROUTER_DATA|self\.__ROUTER_DATA)\s*=\s*(\{[\s\S]+)/);
      if (assigned) push(safeJson(assigned[1].replace(/;?\s*$/, "")));
    }
    return blobs;
  }

  function findRecordById(value, id, depth = 0) {
    if (depth > 18 || value == null || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findRecordById(item, id, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const keys = ["aweme_id", "awemeId", "note_id", "noteId", "group_id", "cid", "itemId", "item_id"];
    for (const key of keys) {
      if (value[key] != null && String(value[key]) === String(id)) return value;
    }
    if (value.id != null && String(value.id) === String(id) && (value.images || value.desc || value.image_post_info || value.imagePostInfo)) {
      return value;
    }
    for (const child of Object.values(value)) {
      const found = findRecordById(child, id, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function resolveAweme(record) {
    if (!record || typeof record !== "object") return null;
    if (record.images || record.image_post_info || record.imagePostInfo || record.image_infos || record.desc) return record;
    const nested = record.aweme || record.aweme_info || record.awemeInfo || record.aweme_detail || record.awemeDetail;
    return nested && typeof nested === "object" ? nested : record;
  }

  function firstImageUrl(image) {
    if (typeof image === "string") return image;
    if (!image || typeof image !== "object") return "";
    const buckets = [image.url_list, image.urlList, image.download_url_list, image.downloadUrlList];
    for (const key of ["display_image", "displayImage", "download_image", "downloadImage"]) {
      const nested = image[key];
      if (nested && typeof nested === "object") {
        buckets.push(nested.url_list, nested.urlList);
      }
    }
    if (image.url) buckets.push([image.url]);
    for (const bucket of buckets) {
      if (!Array.isArray(bucket)) continue;
      const first = bucket.find((item) => typeof item === "string" && item);
      if (first) return first;
    }
    return "";
  }

  function awemeImageList(record) {
    const aweme = resolveAweme(record);
    if (!aweme) return [];
    const post = aweme.image_post_info && typeof aweme.image_post_info === "object"
      ? aweme.image_post_info
      : (aweme.imagePostInfo && typeof aweme.imagePostInfo === "object" ? aweme.imagePostInfo : {});
    const lists = [aweme.images, aweme.image_infos, aweme.imageInfos, post.images];
    const images = lists.find((item) => Array.isArray(item) && item.length) || [];
    return images.map(firstImageUrl).filter(Boolean);
  }

  function douyinRecordCompleteness(record) {
    return awemeImageList(record).length * 1000 + (awemeDesc(record) ? 1 : 0);
  }

  function moreCompleteDouyinRecord(current, candidate) {
    if (!candidate) return current;
    if (!current || douyinRecordCompleteness(candidate) > douyinRecordCompleteness(current)) return candidate;
    return current;
  }

  function findBestDouyinRecordById(value, id, depth = 0) {
    if (depth > 18 || value == null || typeof value !== "object") return null;
    let best = null;
    if (!Array.isArray(value)) {
      const keys = ["aweme_id", "awemeId", "note_id", "noteId", "group_id", "cid", "itemId", "item_id"];
      const matches = keys.some((key) => value[key] != null && String(value[key]) === String(id))
        || (value.id != null && String(value.id) === String(id));
      if (matches) best = resolveAweme(value);
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      best = moreCompleteDouyinRecord(best, findBestDouyinRecordById(child, id, depth + 1));
    }
    return best;
  }

  function awemeDesc(record) {
    const aweme = resolveAweme(record);
    return aweme ? clean(aweme.desc || aweme.description || "") : "";
  }

  function isAwemeVideoOnly(record) {
    const aweme = resolveAweme(record);
    if (!aweme || awemeImageList(aweme).length) return false;
    const type = aweme.aweme_type ?? aweme.awemeType;
    if (type === 68 || type === "68") return false;
    const video = aweme.video;
    return Boolean(video && (video.play_addr || video.playAddr || video.play_url));
  }

  function findRecordInBlobs(blobs, id) {
    let best = null;
    for (const blob of blobs) {
      best = moreCompleteDouyinRecord(best, findBestDouyinRecordById(blob, id));
    }
    return best;
  }

  function extractObjectAroundId(raw, id) {
    const tokens = [`"aweme_id":"${id}"`, `"aweme_id": "${id}"`, `"awemeId":"${id}"`, `"group_id":"${id}"`];
    const indices = [];
    for (const token of tokens) {
      let index = raw.indexOf(token);
      while (index >= 0) {
        indices.push(index);
        index = raw.indexOf(token, index + token.length);
      }
    }
    let best = null;
    for (const index of [...new Set(indices)]) {
      const starts = [];
      let cursor = index;
      while (cursor >= 0 && starts.length < 24) {
        cursor = raw.lastIndexOf("{", cursor - 1);
        if (cursor >= 0) starts.push(cursor);
      }
      for (const start of starts) {
        let depth = 0;
        for (let i = start; i < raw.length && i < start + 400000; i += 1) {
          if (raw[i] === "{") depth += 1;
          else if (raw[i] === "}") {
            depth -= 1;
            if (depth === 0) {
              const parsed = safeJson(raw.slice(start, i + 1));
              const found = parsed ? findBestDouyinRecordById(parsed, id) || resolveAweme(parsed) : null;
              if (found && (awemeImageList(found).length || awemeDesc(found))) {
                best = moreCompleteDouyinRecord(best, found);
                break;
              }
            }
          }
        }
      }
    }
    return best;
  }

  function findAwemeInScripts(document, id) {
    if (!id) return null;
    let best = null;
    for (const script of queryAll(document, "script")) {
      const raw = script.textContent || "";
      if (!raw.includes(id)) continue;
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch (_) {
        decoded = raw;
      }
      const found = extractObjectAroundId(decoded.includes(id) ? decoded : raw, id);
      best = moreCompleteDouyinRecord(best, found);
    }
    return best;
  }

  function isInDouyinFeed(element) {
    return Boolean(element.closest && element.closest([
      ".search-list",
      "[data-e2e='scroll-list']",
      "[data-e2e='search-result']",
      "[data-e2e='search-card']",
      "[class*='water-fall']",
      "[class*='WaterFall']",
      "[class*='Waterfall']"
    ].join(", ")));
  }

  function douyinContentRoot(document, itemId) {
    if (itemId) {
      const currentItem = queryAll(document, `[class~='video_${itemId}']`)
        .find((element) => !isEffectivelyHidden(element));
      if (currentItem) return currentItem;
    }
    const dialog = queryAll(document, "[role='dialog'], [aria-modal='true']").find((element) => !isEffectivelyHidden(element));
    if (dialog) return dialog;
    const slide = queryAll(document, "[data-e2e='slide-list'], [data-e2e='image-item'], [data-e2e='note-detail']")
      .find((element) => !isEffectivelyHidden(element));
    if (slide) return slide.closest("[role='dialog'], [aria-modal='true']") || slide.parentElement || slide;
    const overlay = queryAll(document, [
      "[class*='playerContainer']",
      "[class*='player-container']",
      "[class*='PlayerContainer']",
      "[class*='NoteModal']",
      "[class*='note-modal']",
      ".swiper-wrapper"
    ].join(", ")).find((element) => !isEffectivelyHidden(element) && !isInDouyinFeed(element));
    if (!overlay) return null;
    return overlay.closest("[class*='modal'], [class*='Modal'], [class*='player'], [class*='Player']") || overlay.parentElement || overlay;
  }

  function douyinImageKey(value) {
    try {
      const path = new URL(value).pathname;
      const transform = path.lastIndexOf("~");
      return transform > path.lastIndexOf("/") ? path.slice(0, transform) : path;
    } catch (_) {
      return value;
    }
  }

  function douyinImageQuality(value) {
    try {
      const url = new URL(value);
      if (/aweme-images/i.test(url.pathname) || url.searchParams.get("biz_tag") === "aweme_images" || url.searchParams.get("sc") === "image") return 2;
      if (/~noop/i.test(url.pathname) || url.searchParams.get("biz_tag") === "pcweb_cover" || url.searchParams.get("sc") === "cover") return 0;
    } catch (_) {
      // Keep the neutral quality for an already-normalized URL.
    }
    return 1;
  }

  function douyinVisibleDetailRoot(document) {
    const candidates = queryAll(document, [
      "[role='dialog'][aria-modal='true']",
      "[aria-modal='true']",
      "[class*='NoteModal']",
      "[class*='note-modal']",
      "[class*='playerContainer']",
      "[class*='PlayerContainer']"
    ].join(", "));
    return candidates.find((element) => {
      if (isEffectivelyHidden(element) || isInDouyinFeed(element)) return false;
      const hasImages = queryAll(element, "img, source, [style*='background-image']").length > 0;
      const hasCopy = Boolean(text(element, "h1, [data-e2e='note-title'], [data-e2e='note-desc'], [data-e2e='browse-video-desc'], [data-e2e='video-desc']"));
      return hasImages && hasCopy;
    }) || null;
  }

  function findRecordForVisibleDouyinDetail(blobs, scope) {
    if (!scope) return null;
    const visibleCopy = clean(scope.textContent || "");
    const visibleImageKeys = new Set(collectDomImages(scope).map(douyinImageKey));
    const visit = (value, depth = 0) => {
      if (depth > 18 || value == null || typeof value !== "object") return null;
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = visit(item, depth + 1);
          if (found) return found;
        }
        return null;
      }
      const aweme = resolveAweme(value);
      const images = awemeImageList(aweme);
      if (images.length) {
        const description = awemeDesc(aweme);
        const copyMatches = description.length >= 4
          && (visibleCopy.includes(description) || description.includes(visibleCopy));
        const imageMatches = images.some((image) => visibleImageKeys.has(douyinImageKey(normalizeImageUrl(image))));
        if (copyMatches || imageMatches) return aweme;
      }
      for (const child of Object.values(value)) {
        const found = visit(child, depth + 1);
        if (found) return found;
      }
      return null;
    };
    for (const blob of blobs) {
      const found = visit(blob);
      if (found) return found;
    }
    return null;
  }

  function extractDouyin(document, href) {
    const url = new URL(href, "https://www.douyin.com");
    const itemId = douyinNoteId(href);
    const visibleDetail = douyinVisibleDetailRoot(document);
    if (!itemId && !visibleDetail) return { ok: false, reason: "not-detail" };
    const listPage = isDouyinListPath(url.pathname);
    const blobs = collectDouyinDataBlobs(document);
    const blobRecord = itemId ? findRecordInBlobs(blobs, itemId) : null;
    const scriptRecord = itemId ? findAwemeInScripts(document, itemId) : null;
    const record = itemId
      ? moreCompleteDouyinRecord(blobRecord, scriptRecord)
      : findRecordForVisibleDouyinDetail(blobs, visibleDetail);
    const itemScope = itemId ? douyinContentRoot(document, itemId) : null;
    const scope = itemScope || visibleDetail || (listPage ? null : document);
    const imageUrls = [];
    const seen = new Map();
    const addUrl = (value) => {
      const urlValue = normalizeImageUrl(value);
      if (!urlValue || !/douyinpic|byteimg|douyincdn|xhscdn/i.test(urlValue) && !/\.(?:jpg|jpeg|png|webp|avif)(?:$|\?)/i.test(urlValue)) return;
      if (AVATAR_PATTERN.test(urlValue)) return;
      const key = douyinImageKey(urlValue);
      const quality = douyinImageQuality(urlValue);
      const existing = seen.get(key);
      if (existing) {
        if (quality > existing.quality) {
          imageUrls[existing.index] = urlValue;
          existing.quality = quality;
        }
        return;
      }
      if (imageUrls.length < MAX_IMAGES) {
        seen.set(key, { index: imageUrls.length, quality });
        imageUrls.push(urlValue);
      }
    };
    const recordImages = awemeImageList(record);
    const domImages = scope && !isAwemeVideoOnly(record) ? collectDomImages(scope) : [];
    (domImages.length > recordImages.length ? domImages : recordImages).forEach(addUrl);
    if (!imageUrls.length && !listPage && blobs[0] && !record) {
      walkStrings(blobs[0], (value) => {
        if (/^https:\/\//.test(value) && /(jpg|jpeg|png|webp|avif)/i.test(value)) addUrl(value);
      });
    }
    const textRoot = scope || (listPage ? null : document);
    const description = awemeDesc(record);
    const title = (description ? description.split(/[#\n]/)[0] : "")
      || (textRoot ? text(textRoot, "h1, [data-e2e='note-title'], [data-e2e='aweme-title'], .title") : "")
      || (textRoot ? text(textRoot, "[data-e2e='browse-video-desc'], [data-e2e='video-desc']") : "");
    const body = description
      || (textRoot ? text(textRoot, "[data-e2e='note-desc'], [data-e2e='browse-video-desc'], [data-e2e='video-desc'], .desc, .note-content") : "");
    const explicitImageNote = /\/(?:note|share\/note|slides)\//i.test(url.pathname) || Boolean(url.searchParams.get("note_id"));
    if (!imageUrls.length) {
      if (isAwemeVideoOnly(record)) return { ok: false, reason: "video" };
      if (!listPage && !explicitImageNote && queryAll(scope || document, "video").length) {
        return { ok: false, reason: "video" };
      }
      if (listPage && scope && queryAll(scope, "video").length && !queryAll(scope, "img").length) {
        return { ok: false, reason: "video" };
      }
    }
    if (!imageUrls.length && !body && !title) return { ok: false, reason: "incomplete" };
    return {
      ok: true,
      kind: "image",
      platform: "抖音",
      sourceUrl: href.split("#")[0],
      title: bounded(title, 200),
      body: bounded(body, MAX_TEXT),
      imageUrls
    };
  }

  function isEnabledDouyinCarouselControl(element) {
    return Boolean(element)
      && !isEffectivelyHidden(element)
      && !(element.hasAttribute && element.hasAttribute("disabled"))
      && !(element.getAttribute && element.getAttribute("aria-disabled") === "true");
  }

  function douyinCarouselControl(scope) {
    const candidates = queryAll(scope, [
      "button",
      "[role='button']",
      "[tabindex]",
      "[class*='next']",
      "[class*='Next']",
      "[class*='arrow']",
      "[class*='Arrow']"
    ].join(", ")).filter(isEnabledDouyinCarouselControl);
    const semantic = candidates.find((element) => {
      const descriptor = clean([
        element.getAttribute && element.getAttribute("aria-label"),
        element.getAttribute && element.getAttribute("title"),
        element.getAttribute && element.getAttribute("data-e2e"),
        element.className,
        element.id,
        element.textContent
      ].join(" "));
      return /下一(?:张|页|幅)|next(?:[-_\s]?(?:image|photo|slide|page))?/i.test(descriptor)
        && !/上一(?:张|页|幅)|prev(?:ious)?/i.test(descriptor);
    });
    if (semantic) return semantic;

    const imageBox = queryAll(scope, "img")
      .map((element) => ({ element, box: element.getBoundingClientRect && element.getBoundingClientRect() }))
      .filter(({ element, box }) => box && box.width > 0 && box.height > 0 && !AVATAR_PATTERN.test([
        element.className,
        element.id,
        element.getAttribute && element.getAttribute("alt")
      ].join(" ")))
      .sort((left, right) => right.box.width * right.box.height - left.box.width * left.box.height)[0];
    if (!imageBox) return null;
    const imageMiddle = (imageBox.box.top + imageBox.box.bottom) / 2;
    return candidates
      .map((element) => ({ element, box: element.getBoundingClientRect && element.getBoundingClientRect() }))
      .filter(({ box }) => box
        && box.width > 0
        && box.height > 0
        && box.left >= imageBox.box.right - 12
        && (box.top + box.bottom) / 2 >= imageBox.box.top
        && (box.top + box.bottom) / 2 <= imageBox.box.bottom)
      .sort((left, right) => {
        const leftDistance = Math.max(0, left.box.left - imageBox.box.right) + Math.abs((left.box.top + left.box.bottom) / 2 - imageMiddle);
        const rightDistance = Math.max(0, right.box.left - imageBox.box.right) + Math.abs((right.box.top + right.box.bottom) / 2 - imageMiddle);
        return leftDistance - rightDistance;
      })[0]?.element || null;
  }

  async function collectDouyinCarouselImages(document, href, note) {
    if (detectPlatform(href) !== "抖音") return Array.isArray(note && note.imageUrls) ? note.imageUrls : [];
    const itemId = douyinNoteId(href);
    if (!itemId) return Array.isArray(note && note.imageUrls) ? note.imageUrls : [];
    const imageUrls = [];
    const seen = new Map();
    const addUrl = (value) => {
      const urlValue = normalizeImageUrl(value);
      if (!urlValue || AVATAR_PATTERN.test(urlValue)) return;
      const key = douyinImageKey(urlValue);
      const quality = douyinImageQuality(urlValue);
      const existing = seen.get(key);
      if (existing) {
        if (quality > existing.quality) {
          imageUrls[existing.index] = urlValue;
          existing.quality = quality;
        }
        return;
      }
      if (imageUrls.length < MAX_IMAGES) {
        seen.set(key, { index: imageUrls.length, quality });
        imageUrls.push(urlValue);
      }
    };
    (Array.isArray(note && note.imageUrls) ? note.imageUrls : []).forEach(addUrl);
    let scope = douyinContentRoot(document, itemId);
    if (!scope) return imageUrls;
    collectDomImages(scope).forEach(addUrl);
    const copy = clean(note && note.body);
    const copyMarker = copy && clean(scope.textContent || "").includes(copy) ? copy : "";
    const isCurrentItem = () => {
      if (root.location && root.location.href && douyinNoteId(root.location.href) !== itemId) return false;
      const currentScope = douyinContentRoot(document, itemId);
      if (!currentScope || isEffectivelyHidden(currentScope)) return false;
      if (copyMarker && !clean(currentScope.textContent || "").includes(copyMarker)) return false;
      scope = currentScope;
      return true;
    };

    for (let step = 0; step < MAX_IMAGES - 1 && imageUrls.length < MAX_IMAGES; step += 1) {
      if (!isCurrentItem()) break;
      const next = douyinCarouselControl(scope);
      if (!next || typeof next.click !== "function") break;
      const previousCount = imageUrls.length;
      next.click();
      let foundNewImage = false;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (!isCurrentItem()) return imageUrls;
        collectDomImages(scope).forEach(addUrl);
        if (imageUrls.length > previousCount) {
          foundNewImage = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!foundNewImage) break;
      if ((next.hasAttribute && next.hasAttribute("disabled"))
        || (next.getAttribute && next.getAttribute("aria-disabled") === "true")) break;
    }
    return imageUrls;
  }

  function isTiktokPhotoDetail(href) {
    try {
      return /\/photo\//i.test(new URL(href, "https://www.tiktok.com").pathname);
    } catch (_) {
      return false;
    }
  }

  function tiktokPhotoId(href) {
    try {
      const match = new URL(href, "https://www.tiktok.com").pathname.match(/\/photo\/(\d+)(?:\/|$)/i);
      return match ? match[1] : "";
    } catch (_) {
      return "";
    }
  }

  function tiktokDetailRoot(document, itemId) {
    const rootSelector = "[data-e2e='photo-post'], article, [data-e2e='browse-video'], [data-e2e='browse-photo'], [data-e2e='photo-mode'], [data-e2e='recommend-list-item-container'], [role='dialog']";
    const detailDialogs = queryAll(document, "[role='dialog']").filter((element) => {
      if (isEffectivelyHidden(element) || !queryAll(element, "img").length) return false;
      return Boolean(text(element, "h1, [data-e2e='browse-video-desc'], [data-e2e='new-desc-span'], .tiktok-desc"));
    });
    if (detailDialogs.length === 1) return detailDialogs[0];
    for (const link of queryAll(document, "a[href*='/photo/']")) {
      const linkHref = (link.getAttribute && link.getAttribute("href")) || link.href || "";
      if (tiktokPhotoId(linkHref) !== itemId) continue;
      const detailRoot = typeof link.closest === "function" ? link.closest(rootSelector) : null;
      if (detailRoot) return detailRoot;
    }
    const roots = queryAll(document, rootSelector).filter((element) => !isEffectivelyHidden(element));
    if (roots.length === 1) return roots[0];
    const captions = queryAll(document, "[data-e2e='browse-video-desc'], [data-e2e='new-desc-span'], .tiktok-desc");
    return roots.length === 0 && captions.length <= 1 ? document : null;
  }

  function collectTiktokDataBlobs(document) {
    const blobs = [];
    const push = (value) => {
      if (value && typeof value === "object") blobs.push(value);
    };
    const universal = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__")
      || document.querySelector("script#__UNIVERSAL_DATA_FOR_REHYDRATION__");
    if (universal && universal.textContent) push(safeJson(universal.textContent));
    for (const script of queryAll(document, "script")) {
      const raw = script.textContent || "";
      if (!raw || raw.length > 4_000_000 || !/photoModeImageList|imagePost|itemStruct/i.test(raw)) continue;
      push(safeJson(raw));
    }
    return blobs;
  }

  function resolveTiktokItem(record) {
    if (!record || typeof record !== "object") return null;
    const nested = record.itemStruct || (record.itemInfo && record.itemInfo.itemStruct);
    return nested && typeof nested === "object" ? nested : record;
  }

  function tiktokImageList(record) {
    const item = resolveTiktokItem(record);
    if (!item) return [];
    const post = item.imagePost && typeof item.imagePost === "object"
      ? item.imagePost
      : (item.image_post && typeof item.image_post === "object" ? item.image_post : {});
    const list = [item.photoModeImageList, post.images, item.images]
      .find((value) => Array.isArray(value) && value.length) || [];
    return list.map((image) => {
      if (typeof image === "string") return image;
      const nested = image && (image.imageURL || image.imageUrl || image.image_url);
      return firstImageUrl(nested || image);
    }).filter(Boolean);
  }

  function extractTiktok(document, href) {
    if (!isTiktokPhotoDetail(href)) return { ok: false, reason: "not-detail" };
    const itemId = tiktokPhotoId(href);
    const scope = tiktokDetailRoot(document, itemId);
    const record = collectTiktokDataBlobs(document)
      .map((blob) => findRecordById(blob, itemId))
      .find(Boolean) || null;
    const imageUrls = [];
    const seen = new Set();
    const addUrl = (value) => {
      const urlValue = normalizeImageUrl(value);
      if (!urlValue || seen.has(urlValue)) return;
      seen.add(urlValue);
      if (imageUrls.length < MAX_IMAGES) imageUrls.push(urlValue);
    };
    tiktokImageList(record).forEach(addUrl);
    if (!imageUrls.length && scope) collectDomImages(scope).forEach(addUrl);
    const item = resolveTiktokItem(record);
    const description = item ? clean(item.desc || item.description || "") : "";
    const title = (scope ? text(scope, "h1, [data-e2e='browse-video-desc'], [data-e2e='new-desc-span']") : "")
      || description.split(/\n/)[0];
    const body = description
      || (scope ? text(scope, "[data-e2e='browse-video-desc'], [data-e2e='new-desc-span'], .tiktok-desc") : "");
    if (!imageUrls.length && !body && !title) return { ok: false, reason: "incomplete" };
    return {
      ok: true,
      kind: "image",
      platform: "TikTok",
      sourceUrl: href.split("#")[0],
      title: bounded(title, 200),
      body: bounded(body, MAX_TEXT),
      imageUrls
    };
  }

  function extract(document, href) {
    const platform = detectPlatform(href);
    if (platform === "小红书") return extractXhs(document, href);
    if (platform === "抖音") return extractDouyin(document, href);
    if (platform === "TikTok") return extractTiktok(document, href);
    return { ok: false, reason: "unsupported" };
  }

  return Object.freeze({
    clean,
    collectDouyinCarouselImages,
    detectPlatform,
    douyinNoteId,
    extract,
    isHttpsUrl,
    isXhsImageDetail,
    isDouyinImageDetail,
    isTiktokPhotoDetail
  });
});
