(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Library2Media = api;
})(globalThis, function (root) {
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

  return Object.freeze({ isAllowedMediaUrl, downloadImage, sniffType });
});
