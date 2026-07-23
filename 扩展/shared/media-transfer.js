(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.XhsMediaTransfer = api;
})(globalThis, function (root) {
  const MAX_CHUNK_BYTES = 192 * 1024;
  const ALLOWED_SUFFIXES = ["xiaohongshu.com", "xhscdn.com"];

  class MediaTransferError extends Error {
    constructor(code, message) {
      super(`${code}: ${message}`);
      this.code = code;
    }
  }

  function isAllowedMediaUrl(value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") return false;
      return ALLOWED_SUFFIXES.some((suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`));
    } catch (_) {
      return false;
    }
  }

  function isAllowedMediaMime(value) {
    return typeof value === "string" && /^(?:image|video)\/[a-z0-9.+-]+$/i.test(value.split(";", 1)[0].trim());
  }

  function normalizeSourceUrl(value) {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  }

  async function createAssetKey(topicKey, role, order, sourceUrl) {
    const input = `${topicKey}\n${role}\n${order}\n${normalizeSourceUrl(sourceUrl)}`;
    const digest = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `sha256-${hex.slice(0, 32)}`;
  }

  function buildMediaJobs(topic) {
    const jobs = [];
    const media = Array.isArray(topic && topic.media) ? topic.media : [];
    media.forEach((item, itemIndex) => {
      if (!item || (item.type !== "image" && item.type !== "video")) return;
      if (isAllowedMediaUrl(item.url)) jobs.push({ itemIndex, role: item.type, sourceUrl: item.url });
      if (item.type === "video" && isAllowedMediaUrl(item.posterUrl)) {
        jobs.push({ itemIndex, role: "poster", sourceUrl: item.posterUrl });
      }
    });
    return jobs;
  }

  function encodeBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    }
    return btoa(binary);
  }

  async function downloadMedia({ sourceUrl, fetchImpl = root.fetch, onChunk }) {
    if (!isAllowedMediaUrl(sourceUrl)) {
      throw new MediaTransferError("MEDIA_URL_BLOCKED", "媒体地址不在白名单内");
    }
    const response = await fetchImpl(sourceUrl, {
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      referrer: "https://www.xiaohongshu.com/",
      referrerPolicy: "strict-origin-when-cross-origin"
    });
    if (!response.ok) {
      throw new MediaTransferError("MEDIA_FETCH_FAILED", `媒体请求返回 ${response.status}`);
    }
    if (response.url && !isAllowedMediaUrl(response.url)) {
      throw new MediaTransferError("MEDIA_REDIRECT_BLOCKED", "媒体重定向到了白名单外主机");
    }
    const mimeType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (!isAllowedMediaMime(mimeType)) {
      throw new MediaTransferError("MEDIA_TYPE_INVALID", "媒体响应类型无效");
    }
    if (!response.body) {
      throw new MediaTransferError("MEDIA_BODY_MISSING", "媒体响应没有可读取内容");
    }

    const reader = response.body.getReader();
    let carry = new Uint8Array(0);
    let byteLength = 0;
    let chunkIndex = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const joined = new Uint8Array(carry.length + value.length);
      joined.set(carry);
      joined.set(value, carry.length);
      let offset = 0;
      while (joined.length - offset >= MAX_CHUNK_BYTES) {
        const chunk = joined.slice(offset, offset + MAX_CHUNK_BYTES);
        await onChunk({ chunkIndex, data: encodeBase64(chunk), byteLength: chunk.length });
        byteLength += chunk.length;
        chunkIndex += 1;
        offset += MAX_CHUNK_BYTES;
      }
      carry = joined.slice(offset);
    }
    if (carry.length) {
      await onChunk({ chunkIndex, data: encodeBase64(carry), byteLength: carry.length });
      byteLength += carry.length;
      chunkIndex += 1;
    }
    return { mimeType, byteLength, chunkCount: chunkIndex };
  }

  return Object.freeze({
    MAX_CHUNK_BYTES,
    MediaTransferError,
    isAllowedMediaUrl,
    isAllowedMediaMime,
    createAssetKey,
    buildMediaJobs,
    downloadMedia
  });
});
