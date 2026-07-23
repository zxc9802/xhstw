(function (root, factory) {
  const protocol = factory();
  if (typeof module === "object" && module.exports) module.exports = protocol;
  else root.XhsExtensionProtocol = protocol;
})(globalThis, function () {
  const CHANNEL = "content-production-studio.xhs-extension";
  const PROTOCOL_VERSION = 3;
  const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ASSET_KEY_PATTERN = /^sha256-[0-9a-f]{32}$/;
  const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  const TASK_KEYS = ["requestId", "queries", "limitPerQuery", "mediaType", "dateRange", "sortBy", "existingUrls"];
  const ENVELOPE_KEYS = ["channel", "protocolVersion", "direction", "type", "requestId", "payload"];
  const TOPIC_KEYS = ["id", "platform", "title", "contentType", "likes", "views", "comments", "saves", "risk", "priority", "status", "sourceAccount", "fetchedAt", "url", "authorUrl", "coverUrl", "coverType", "media", "mediaType", "keyword", "parsedContent"];
  const TOPIC_REQUIRED_KEYS = ["id", "platform", "title", "contentType", "likes", "comments", "saves", "risk", "priority", "status", "sourceAccount", "fetchedAt"];
  const MEDIA_KEYS = ["type", "url", "name", "posterUrl", "localAssetKey", "posterLocalAssetKey", "mimeType", "size"];
  const hasOwn = Object.prototype.hasOwnProperty;

  function invalid(error) {
    return { ok: false, error };
  }

  function isPlainRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function inspectRecord(value, allowedKeys, requiredKeys) {
    if (!isPlainRecord(value)) return { failure: "shape" };
    const ownKeys = Reflect.ownKeys(value);
    if (requiredKeys.some((key) => !hasOwn.call(value, key))) return { failure: "missing" };
    if (ownKeys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) return { failure: "unknown" };
    const values = Object.create(null);
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn.call(descriptor, "value")) return { failure: "shape" };
      values[key] = descriptor.value;
    }
    return { values };
  }

  function inspectExactRecord(value, keys) {
    const record = inspectRecord(value, keys, keys);
    if (!record.values || Reflect.ownKeys(record.values).length !== keys.length) return null;
    return record.values;
  }

  function isRequestId(value) {
    return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
  }

  function isNonblankString(value, maxLength) {
    return typeof value === "string" && value.length <= maxLength && value.trim().length > 0;
  }

  function isBoundedString(value, maxLength) {
    return typeof value === "string" && value.length <= maxLength;
  }

  function isAssetKey(value) {
    return typeof value === "string" && ASSET_KEY_PATTERN.test(value);
  }

  function isMediaMime(value) {
    return typeof value === "string" && value.length <= 100 && /^(?:image|video)\/[a-z0-9.+-]+$/i.test(value);
  }

  function isSafeCount(value, maximum) {
    return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  }

  function isBase64Chunk(value) {
    return typeof value === "string" && value.length <= 262_144 && BASE64_PATTERN.test(value);
  }

  function isDenseArray(value, maxLength, validator) {
    if (!Array.isArray(value) || value.length > maxLength) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !hasOwn.call(value, "length")) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !hasOwn.call(descriptor, "value") || !validator(descriptor.value)) return false;
    }
    return true;
  }

  function isHttpsUrl(value) {
    if (!isNonblankString(value, 2048)) return false;
    try {
      return new URL(value).protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function isXhsUrl(value) {
    if (!isHttpsUrl(value)) return false;
    const hostname = new URL(value).hostname;
    return hostname === "www.xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
  }

  function validateTaskValues(values) {
    if (!isRequestId(values.requestId)) return invalid("请求 ID 格式不正确");
    if (!isDenseArray(values.queries, Number.MAX_SAFE_INTEGER, (query) => isNonblankString(query, 40)) || values.queries.length < 1) return invalid("关键词格式不正确");
    if (!Number.isSafeInteger(values.limitPerQuery) || values.limitPerQuery < 1 || values.limitPerQuery > Math.floor(Number.MAX_SAFE_INTEGER / values.queries.length)) return invalid("每个关键词的抓取数量必须是正整数");
    if (!["全部", "图文", "视频"].includes(values.mediaType)) return invalid("内容类型不正确");
    if (!["全部", "一天内", "一周内", "半年内"].includes(values.dateRange)) return invalid("发布时间范围不正确");
    if (!["浏览量", "点赞量", "评论量", "收藏量"].includes(values.sortBy)) return invalid("排序方式不正确");
    if (!isDenseArray(values.existingUrls, 2000, isXhsUrl)) return invalid("已有链接格式不正确");
    return { ok: true };
  }

  function validateTask(task) {
    try {
      const record = inspectRecord(task, TASK_KEYS, TASK_KEYS);
      if (record.failure === "missing") return invalid("任务缺少必填字段");
      if (record.failure === "unknown") return invalid("任务包含不支持的字段");
      if (!record.values) return invalid("任务格式不正确");
      return validateTaskValues(record.values);
    } catch (_) {
      return invalid("任务格式不正确");
    }
  }

  function isMedia(media) {
    const values = inspectRecord(media, MEDIA_KEYS, ["type", "url"]);
    if (!values.values) return false;
    return ["image", "video"].includes(values.values.type) &&
      isHttpsUrl(values.values.url) &&
      (!hasOwn.call(values.values, "name") || isBoundedString(values.values.name, 300)) &&
      (!hasOwn.call(values.values, "posterUrl") || isHttpsUrl(values.values.posterUrl)) &&
      (!hasOwn.call(values.values, "localAssetKey") || isAssetKey(values.values.localAssetKey)) &&
      (!hasOwn.call(values.values, "posterLocalAssetKey") || isAssetKey(values.values.posterLocalAssetKey)) &&
      (!hasOwn.call(values.values, "mimeType") || isMediaMime(values.values.mimeType)) &&
      (!hasOwn.call(values.values, "size") || isSafeCount(values.values.size, Number.MAX_SAFE_INTEGER));
  }

  function isTopic(topic) {
    const values = inspectRecord(topic, TOPIC_KEYS, TOPIC_REQUIRED_KEYS);
    if (!values.values) return false;
    for (const key of TOPIC_REQUIRED_KEYS) {
      if (!isNonblankString(values.values[key], 2048)) return false;
    }
    if (values.values.platform !== "小红书" || !["低", "中", "高"].includes(values.values.risk) || !["P0", "P1", "P2"].includes(values.values.priority) || !["pending", "approved", "rejected", "used", "optimizing"].includes(values.values.status)) return false;
    for (const key of ["views", "keyword", "parsedContent"]) {
      if (hasOwn.call(values.values, key) && !isBoundedString(values.values[key], 2048)) return false;
    }
    for (const key of ["url", "authorUrl", "coverUrl"]) {
      if (hasOwn.call(values.values, key) && !isHttpsUrl(values.values[key])) return false;
    }
    if (hasOwn.call(values.values, "coverType") && !["image", "video"].includes(values.values.coverType)) return false;
    if (hasOwn.call(values.values, "mediaType") && !["图文", "视频"].includes(values.values.mediaType)) return false;
    return !hasOwn.call(values.values, "media") || isDenseArray(values.values.media, 20, isMedia);
  }

  function validatePayload(type, payload) {
    if (type === "ping" || type === "cancel") return inspectExactRecord(payload, []) ? { ok: true } : { ok: false };
    if (type === "collect") {
      const values = inspectExactRecord(payload, TASK_KEYS);
      return values && validateTaskValues(values).ok ? { ok: true, task: values } : { ok: false };
    }
    if (type === "pong") {
      const values = inspectExactRecord(payload, ["version"]);
      return values && isNonblankString(values.version, 40) ? { ok: true } : { ok: false };
    }
    if (type === "progress") {
      const values = inspectExactRecord(payload, ["stage", "completed", "total", "message"]);
      return values && ["opening", "searching", "enriching", "downloading"].includes(values.stage) &&
        isSafeCount(values.completed, Number.MAX_SAFE_INTEGER) && isSafeCount(values.total, Number.MAX_SAFE_INTEGER) &&
        values.completed <= values.total && isBoundedString(values.message, 300) ? { ok: true } : { ok: false };
    }
    if (type === "result") {
      const values = inspectExactRecord(payload, ["topics", "message", "mediaCompleted", "mediaFailed"]);
      return values && isDenseArray(values.topics, Number.MAX_SAFE_INTEGER, isTopic) && isBoundedString(values.message, 300) &&
        isSafeCount(values.mediaCompleted, Number.MAX_SAFE_INTEGER) && isSafeCount(values.mediaFailed, Number.MAX_SAFE_INTEGER) ? { ok: true } : { ok: false };
    }
    if (type === "media:start") {
      const values = inspectExactRecord(payload, ["assetKey", "topicKey", "mediaRole", "sourceUrl"]);
      return values && isAssetKey(values.assetKey) && isNonblankString(values.topicKey, 160) &&
        ["image", "video", "poster"].includes(values.mediaRole) && isHttpsUrl(values.sourceUrl) ? { ok: true } : { ok: false };
    }
    if (type === "media:chunk") {
      const values = inspectExactRecord(payload, ["assetKey", "chunkIndex", "data", "byteLength"]);
      return values && isAssetKey(values.assetKey) && isSafeCount(values.chunkIndex, 100_000) &&
        isBase64Chunk(values.data) && isSafeCount(values.byteLength, 196_608) ? { ok: true } : { ok: false };
    }
    if (type === "media:complete") {
      const values = inspectExactRecord(payload, ["assetKey", "mimeType", "byteLength", "chunkCount"]);
      return values && isAssetKey(values.assetKey) && isMediaMime(values.mimeType) &&
        isSafeCount(values.byteLength, Number.MAX_SAFE_INTEGER) && isSafeCount(values.chunkCount, 100_000) ? { ok: true } : { ok: false };
    }
    if (type === "media:error" || type === "media:abort") {
      const values = inspectExactRecord(payload, ["assetKey", "code", "message"]);
      return values && isAssetKey(values.assetKey) && isNonblankString(values.code, 80) &&
        isNonblankString(values.message, 300) ? { ok: true } : { ok: false };
    }
    if (type === "media:ready" || type === "media:skip") {
      const values = inspectExactRecord(payload, ["assetKey"]);
      return values && isAssetKey(values.assetKey) ? { ok: true } : { ok: false };
    }
    if (type === "media:ack") {
      const values = inspectExactRecord(payload, ["assetKey", "chunkIndex"]);
      return values && isAssetKey(values.assetKey) && isSafeCount(values.chunkIndex, 100_000) ? { ok: true } : { ok: false };
    }
    if (type === "error") {
      const values = inspectExactRecord(payload, ["code", "message"]);
      return values && isNonblankString(values.code, 80) && isNonblankString(values.message, 300) ? { ok: true } : { ok: false };
    }
    return { ok: false };
  }

  function isEnvelope(message, direction) {
    try {
      if (direction !== "page-to-extension" && direction !== "extension-to-page") return false;
      const values = inspectExactRecord(message, ENVELOPE_KEYS);
      if (!values || values.channel !== CHANNEL || values.protocolVersion !== PROTOCOL_VERSION || values.direction !== direction || !isRequestId(values.requestId)) return false;
      const allowedTypes = direction === "page-to-extension"
        ? ["ping", "collect", "cancel", "media:ready", "media:skip", "media:ack", "media:abort"]
        : ["pong", "progress", "media:start", "media:chunk", "media:complete", "media:error", "result", "error"];
      if (!allowedTypes.includes(values.type)) return false;
      const payload = validatePayload(values.type, values.payload);
      return payload.ok && (values.type !== "collect" || values.requestId === payload.task.requestId);
    } catch (_) {
      return false;
    }
  }

  return Object.freeze({ CHANNEL, PROTOCOL_VERSION, validateTask, isEnvelope });
});
