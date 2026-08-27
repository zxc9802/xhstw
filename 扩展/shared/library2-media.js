(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Library2Media = api;
})(globalThis, function (root) {
  const LIVE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
  const ALLOWED_SUFFIXES = [
    "xiaohongshu.com",
    "xhscdn.com",
    "douyin.com",
    "iesdouyin.com",
    "douyinpic.com",
    "douyincdn.com",
    "byteimg.com",
    "ibyteimg.com",
    "tiktok.com",
    "tiktokcdn.com",
    "tiktokcdn-us.com",
    "tiktokcdn-eu.com",
    "muscdn.com",
    "tiktokv.com"
  ];

  function isAllowedMediaUrl(value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") return false;
      return ALLOWED_SUFFIXES.some((suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`));
    } catch (_) {
      return false;
    }
  }

  function sniffType(bytes) {
    if (!bytes || bytes.length < 12) return "";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return "";
  }

  function headerType(value) {
    const type = String(value || "").split(";", 1)[0].trim().toLowerCase();
    return ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(type) ? type : "";
  }

  function sniffVideoType(bytes) {
    if (!bytes || bytes.length < 12) return "";
    const lastOffset = Math.min(bytes.length - 4, 28);
    for (let offset = 4; offset <= lastOffset; offset += 1) {
      if (bytes[offset] === 0x66 && bytes[offset + 1] === 0x74
        && bytes[offset + 2] === 0x79 && bytes[offset + 3] === 0x70) return "video/mp4";
    }
    return "";
  }

  async function readBoundedBytes(response, maxBytes) {
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new Error("单个 Live 视频不能超过 100 MB");
    if (!response.body) return new Uint8Array(await response.arrayBuffer());
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error("单个 Live 视频不能超过 100 MB");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async function downloadImage(sourceUrl, fetchImpl = root.fetch, timeoutMs = 10_000) {
    if (!isAllowedMediaUrl(sourceUrl)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(sourceUrl, {
        credentials: "omit",
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) return null;
      if (response.url && !isAllowedMediaUrl(response.url)) return null;
      const buffer = new Uint8Array(await response.arrayBuffer());
      const contentType = headerType(response.headers.get("content-type")) || sniffType(buffer);
      if (!contentType || !buffer.byteLength) return null;
      return { bytes: buffer, contentType, size: buffer.byteLength };
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function downloadVideo(sourceUrl, fetchImpl = root.fetch, timeoutMs = 30_000) {
    if (!isAllowedMediaUrl(sourceUrl)) throw new Error("Live 视频地址不在白名单内");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(sourceUrl, {
        credentials: "omit",
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Live 视频下载失败（${response.status}）`);
      if (response.url && !isAllowedMediaUrl(response.url)) throw new Error("Live 视频重定向地址不在白名单内");
      const bytes = await readBoundedBytes(response, LIVE_VIDEO_MAX_BYTES);
      const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "video/mp4" || sniffVideoType(bytes) !== "video/mp4") throw new Error("Live 视频格式无效");
      return { bytes, contentType: "video/mp4", size: bytes.byteLength };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Live 视频下载超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ LIVE_VIDEO_MAX_BYTES, isAllowedMediaUrl, downloadImage, downloadVideo, sniffType, sniffVideoType });
});
