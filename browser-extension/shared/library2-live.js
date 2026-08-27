(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Library2Live = api;
})(globalThis, function (root) {
  const MAX_LIVE_PHOTOS = 20;
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

  return Object.freeze({ collectXhsLivePhotos });
});
