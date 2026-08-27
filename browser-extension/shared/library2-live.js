(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Library2Live = api;
})(globalThis, function (root) {
  const MAX_LIVE_PHOTOS = 20;
  const BLOB_CHUNK_BYTES = 192 * 1024;
  const LIVE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
  const NEXT_SELECTOR = ".swiper-button-next, button[aria-label*='下一'], [class*='arrow'][class*='right']";
  const PREVIOUS_SELECTOR = ".swiper-button-prev, button[aria-label*='上一'], [class*='arrow'][class*='left']";

  function isHidden(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      if (current.hasAttribute && current.hasAttribute("hidden")) return true;
      if (current.getAttribute && current.getAttribute("aria-hidden") === "true") return true;
      current = current.parentElement;
    }
    return false;
  }

  function findVisibleLiveRoot(document) {
    return Array.from(document.querySelectorAll(".live-photo-contain, [class*='live-photo-contain']"))
      .find((element) => !isHidden(element)) || null;
  }

  function logicalIndexes(scope) {
    const indexes = [];
    const seen = new Set();
    for (const slide of scope.querySelectorAll("[data-swiper-slide-index]")) {
      const value = slide.getAttribute("data-swiper-slide-index");
      if (value === null || value === "" || seen.has(value)) continue;
      seen.add(value);
      indexes.push(value);
      if (indexes.length >= MAX_LIVE_PHOTOS) break;
    }
    return indexes;
  }

  function activeSlide(scope) {
    const slides = Array.from(scope.querySelectorAll(".swiper-slide-active, [data-swiper-slide-index].active"));
    return slides.find((slide) => !slide.classList.contains("swiper-slide-duplicate")) || slides[0] || null;
  }

  function activeIndex(scope) {
    return activeSlide(scope)?.getAttribute("data-swiper-slide-index") || "";
  }

  function normalizeHttpsUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      if (parsed.protocol !== "https:") return "";
      parsed.hash = "";
      return parsed.toString();
    } catch (_) {
      return "";
    }
  }

  function isOfficialVideoUrl(value) {
    try {
      const parsed = new URL(value);
      const officialHost = parsed.hostname === "xhscdn.com" || parsed.hostname.endsWith(".xhscdn.com")
        || parsed.hostname === "xiaohongshu.com" || parsed.hostname.endsWith(".xiaohongshu.com");
      return parsed.protocol === "https:" && officialHost && /\.mp4(?:$|[?#])/i.test(parsed.href);
    } catch (_) {
      return false;
    }
  }

  function coverUrl(slide) {
    const image = slide && (slide.matches("img.live-img")
      ? slide
      : slide.querySelector("img.live-img, .live-img img, img"));
    return normalizeHttpsUrl(image && (image.currentSrc || image.src || image.getAttribute("src")));
  }

  function activeVideoValue(slide) {
    const video = slide && (slide.matches("video.live-video")
      ? slide
      : slide.querySelector("video.live-video, .live-video video, video"));
    if (!video) return "";
    const source = video.querySelector && video.querySelector("source");
    return String(video.currentSrc || video.src || video.getAttribute("src")
      || (source && (source.src || source.getAttribute("src"))) || "");
  }

  function resourceVideo(performanceValue, usedVideos) {
    let entries = [];
    try {
      entries = performanceValue && typeof performanceValue.getEntriesByType === "function"
        ? performanceValue.getEntriesByType("resource")
        : [];
    } catch (_) {
      entries = [];
    }
    const candidates = entries
      .filter((entry) => entry && typeof entry.name === "string" && isOfficialVideoUrl(entry.name) && !usedVideos.has(entry.name))
      .sort((left, right) => Number(left.startTime || 0) - Number(right.startTime || 0));
    return candidates.length ? candidates[candidates.length - 1].name : "";
  }

  function resolveVideoSource(slide, performanceValue, usedVideos) {
    const activeValue = activeVideoValue(slide);
    if (isOfficialVideoUrl(activeValue)) return { kind: "remote", url: activeValue };
    const resource = resourceVideo(performanceValue, usedVideos);
    if (resource) return { kind: "remote", url: resource };
    if (activeValue.startsWith("blob:https://www.xiaohongshu.com/")) return { kind: "blob", url: activeValue };
    return null;
  }

  async function moveTo(scope, target, options) {
    if (activeIndex(scope) === target) return;
    const delay = options.delay || ((milliseconds) => new Promise((resolve) => root.setTimeout(resolve, milliseconds)));
    const directions = [NEXT_SELECTOR, PREVIOUS_SELECTOR];
    const attempts = logicalIndexes(scope).length || 1;
    for (const selector of directions) {
      const control = scope.querySelector(selector);
      if (!control) continue;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (activeIndex(scope) === target) return;
        const before = activeIndex(scope);
        control.click();
        await delay(Math.min(Number(options.maxWaitMs) || 800, 800));
        if (activeIndex(scope) === target) return;
        if (activeIndex(scope) === before) break;
      }
    }
    throw new Error("Live 轮播切换失败");
  }

  async function collectXhsLivePhotos(document, options = {}) {
    const scope = findVisibleLiveRoot(document);
    if (!scope) throw new Error("当前详情没有可读取的 Live 图片");
    const indexes = logicalIndexes(scope);
    if (!indexes.length) throw new Error("没有识别到 Live 图片数量");
    const originalIndex = activeIndex(scope);
    const usedVideos = new Set();
    const pairs = [];
    let thrown;

    try {
      for (let order = 0; order < indexes.length; order += 1) {
        await moveTo(scope, indexes[order], options);
        const slide = activeSlide(scope);
        const currentCover = coverUrl(slide);
        const videoSource = resolveVideoSource(slide, options.performance || root.performance, usedVideos);
        if (!currentCover || !videoSource) throw new Error(`第 ${order + 1} 张 Live 图片没有对应视频`);
        if (videoSource.kind === "remote") usedVideos.add(videoSource.url);
        pairs.push({ order, coverUrl: currentCover, videoSource });
      }
    } catch (error) {
      thrown = error;
    } finally {
      if (originalIndex && activeIndex(scope) !== originalIndex) {
        try {
          await moveTo(scope, originalIndex, options);
        } catch (restoreError) {
          if (!thrown) thrown = restoreError;
        }
      }
    }

    if (thrown) throw thrown;
    return pairs;
  }

  function encodeBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    }
    return btoa(binary);
  }

  function decodeBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function sniffMp4(bytes) {
    if (!bytes || bytes.length < 12) return false;
    for (let offset = 4; offset <= Math.min(bytes.length - 4, 28); offset += 1) {
      if (bytes[offset] === 0x66 && bytes[offset + 1] === 0x74
        && bytes[offset + 2] === 0x79 && bytes[offset + 3] === 0x70) return true;
    }
    return false;
  }

  async function streamBlob(port, blobUrl, options = {}) {
    if (typeof blobUrl !== "string" || !blobUrl.startsWith("blob:https://www.xiaohongshu.com/")) {
      throw new Error("页面 Live 视频地址无效");
    }
    const fetchImpl = options.fetchImpl || root.fetch;
    const chunkBytes = Math.max(1, Number(options.chunkBytes) || BLOB_CHUNK_BYTES);
    let byteLength = 0;
    let chunkIndex = 0;
    let carry = new Uint8Array(0);
    try {
      const response = await fetchImpl(blobUrl);
      if (!response.ok || !response.body) throw new Error("页面 Live 视频读取失败");
      const contentType = String(response.headers.get("content-type") || "video/mp4").split(";", 1)[0].trim().toLowerCase();
      port.postMessage({ type: "start", contentType });
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const joined = new Uint8Array(carry.length + value.length);
          joined.set(carry);
          joined.set(value, carry.length);
          let offset = 0;
          while (joined.length - offset >= chunkBytes) {
            const chunk = joined.slice(offset, offset + chunkBytes);
            byteLength += chunk.byteLength;
            if (byteLength > LIVE_VIDEO_MAX_BYTES) throw new Error("单个 Live 视频不能超过 100 MB");
            port.postMessage({ type: "chunk", chunkIndex, data: encodeBase64(chunk), byteLength: chunk.byteLength });
            chunkIndex += 1;
            offset += chunkBytes;
          }
          carry = joined.slice(offset);
        }
      } finally {
        reader.releaseLock();
      }
      if (carry.length) {
        byteLength += carry.byteLength;
        if (byteLength > LIVE_VIDEO_MAX_BYTES) throw new Error("单个 Live 视频不能超过 100 MB");
        port.postMessage({ type: "chunk", chunkIndex, data: encodeBase64(carry), byteLength: carry.byteLength });
        chunkIndex += 1;
      }
      port.postMessage({ type: "complete", byteLength, chunkCount: chunkIndex, contentType });
      return { byteLength, chunkCount: chunkIndex };
    } catch (error) {
      const message = error instanceof Error ? error.message : "页面 Live 视频读取失败";
      port.postMessage({ type: "error", message });
      throw error;
    }
  }

  function readBlobFromTab(connect, tabId, blobUrl, options = {}) {
    return new Promise((resolve, reject) => {
      const port = connect(tabId, { name: "library2-live-blob" });
      const chunks = [];
      let expectedChunkIndex = 0;
      let byteLength = 0;
      let contentType = "";
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        try { port.disconnect(); } catch (_) {}
        if (error) reject(error);
        else resolve(value);
      };
      const timer = root.setTimeout(() => finish(new Error("页面 Live 视频读取超时")), Number(options.timeoutMs) || 30_000);
      port.onMessage.addListener((message) => {
        try {
          if (!message || typeof message !== "object") throw new Error("页面 Live 视频分块无效");
          if (message.type === "start") {
            contentType = String(message.contentType || "").split(";", 1)[0].trim().toLowerCase();
            return;
          }
          if (message.type === "chunk") {
            if (message.chunkIndex !== expectedChunkIndex || typeof message.data !== "string") throw new Error("页面 Live 视频分块顺序无效");
            const chunk = decodeBase64(message.data);
            if (chunk.byteLength !== message.byteLength) throw new Error("页面 Live 视频分块大小无效");
            byteLength += chunk.byteLength;
            if (byteLength > LIVE_VIDEO_MAX_BYTES) throw new Error("单个 Live 视频不能超过 100 MB");
            chunks.push(chunk);
            expectedChunkIndex += 1;
            return;
          }
          if (message.type === "error") throw new Error(String(message.message || "页面 Live 视频读取失败"));
          if (message.type !== "complete" || message.chunkCount !== expectedChunkIndex || message.byteLength !== byteLength) {
            throw new Error("页面 Live 视频完成信息无效");
          }
          const bytes = new Uint8Array(byteLength);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          if (contentType !== "video/mp4" || !sniffMp4(bytes)) throw new Error("Live 视频格式无效");
          finish(null, { bytes, contentType: "video/mp4", size: byteLength });
        } catch (error) {
          finish(error instanceof Error ? error : new Error("页面 Live 视频读取失败"));
        }
      });
      port.onDisconnect.addListener(() => {
        if (!settled) finish(new Error("页面 Live 视频连接已断开"));
      });
      port.postMessage({ type: "read", url: blobUrl });
    });
  }

  return Object.freeze({ BLOB_CHUNK_BYTES, collectXhsLivePhotos, readBlobFromTab, streamBlob });
});
