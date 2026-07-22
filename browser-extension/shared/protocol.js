(function (root, factory) {
  const protocol = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = protocol;
  } else {
    root.XhsExtensionProtocol = protocol;
  }
})(globalThis, function () {
  const CHANNEL = "content-production-studio.xhs-extension";
  const PROTOCOL_VERSION = 1;
  const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const TASK_KEYS = ["requestId", "queries", "limitPerQuery", "mediaType", "dateRange", "sortBy", "existingUrls"];
  const ENVELOPE_KEYS = ["channel", "protocolVersion", "direction", "type", "requestId", "payload"];
  const TOPIC_KEYS = ["id", "platform", "title", "contentType", "status", "sourceAccount", "fetchedAt"];
  const hasOwn = Object.prototype.hasOwnProperty;

  function invalid(error) {
    return { ok: false, error };
  }

  function isPlainRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function hasExactOwnKeys(value, expectedKeys) {
    if (!isPlainRecord(value)) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === expectedKeys.length &&
      expectedKeys.every((key) => hasOwn.call(value, key)) &&
      keys.every((key) => typeof key === "string" && expectedKeys.includes(key));
  }

  function isRequestId(value) {
    return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
  }

  function isNonblankString(value, maxLength) {
    return typeof value === "string" && value.length <= maxLength && value.trim().length > 0;
  }

  function isDenseArray(value, maxLength, validator) {
    if (!Array.isArray(value) || value.length > maxLength) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !hasOwn.call(value, "length")) return false;
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !hasOwn.call(descriptor, "value") || !validator(descriptor.value)) return false;
    }
    return true;
  }

  function isXhsUrl(value) {
    if (!isNonblankString(value, 2048)) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && (url.hostname === "www.xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"));
    } catch (_) {
      return false;
    }
  }

  function validateTask(task) {
    try {
      if (!isPlainRecord(task)) return invalid("任务格式不正确");
      if (TASK_KEYS.some((key) => !hasOwn.call(task, key))) return invalid("任务缺少必填字段");
      if (Object.keys(task).some((key) => !TASK_KEYS.includes(key))) return invalid("任务包含不支持的字段");
      if (!isRequestId(task.requestId)) return invalid("请求 ID 格式不正确");
      if (!isDenseArray(task.queries, 2, (query) => isNonblankString(query, 40)) || task.queries.length < 1) return invalid("关键词格式不正确");
      if (!Number.isInteger(task.limitPerQuery) || task.limitPerQuery < 1 || task.limitPerQuery > 5) return invalid("每个关键词的抓取数量必须为 1 到 5");
      if (!["全部", "图文", "视频"].includes(task.mediaType)) return invalid("内容类型不正确");
      if (!["全部", "一天内", "一周内", "半年内"].includes(task.dateRange)) return invalid("发布时间范围不正确");
      if (!["浏览量", "点赞量", "评论量", "收藏量"].includes(task.sortBy)) return invalid("排序方式不正确");
      if (!isDenseArray(task.existingUrls, 2000, isXhsUrl)) return invalid("已有链接格式不正确");
      return { ok: true };
    } catch (_) {
      return invalid("任务格式不正确");
    }
  }

  function isTopic(topic) {
    if (!isPlainRecord(topic) || TOPIC_KEYS.some((key) => !hasOwn.call(topic, key))) return false;
    return TOPIC_KEYS.every((key) => isNonblankString(topic[key], Number.MAX_SAFE_INTEGER)) && topic.platform === "小红书";
  }

  function isPayload(type, payload) {
    if (type === "ping" || type === "cancel") return hasExactOwnKeys(payload, []);
    if (type === "collect") return hasExactOwnKeys(payload, TASK_KEYS) && validateTask(payload).ok;
    if (type === "pong") return hasExactOwnKeys(payload, ["version"]) && isNonblankString(payload.version, 40);
    if (type === "progress") {
      return hasExactOwnKeys(payload, ["stage", "completed", "total", "message"]) &&
        ["opening", "searching", "enriching"].includes(payload.stage) &&
        Number.isInteger(payload.completed) && payload.completed >= 0 &&
        Number.isInteger(payload.total) && payload.total >= 0 &&
        payload.completed <= payload.total &&
        typeof payload.message === "string" && payload.message.length <= 300;
    }
    if (type === "result") {
      return hasExactOwnKeys(payload, ["topics", "message"]) &&
        isDenseArray(payload.topics, 10, isTopic) &&
        typeof payload.message === "string" && payload.message.length <= 300;
    }
    if (type === "error") {
      return hasExactOwnKeys(payload, ["code", "message"]) &&
        isNonblankString(payload.code, 80) && isNonblankString(payload.message, 300);
    }
    return false;
  }

  function isEnvelope(message, direction) {
    try {
      if ((direction !== "page-to-extension" && direction !== "extension-to-page") || !hasExactOwnKeys(message, ENVELOPE_KEYS)) return false;
      if (message.channel !== CHANNEL || message.protocolVersion !== PROTOCOL_VERSION || message.direction !== direction || !isRequestId(message.requestId)) return false;
      const allowedTypes = direction === "page-to-extension" ? ["ping", "collect", "cancel"] : ["pong", "progress", "result", "error"];
      if (!allowedTypes.includes(message.type) || !isPayload(message.type, message.payload)) return false;
      return message.type !== "collect" || message.requestId === message.payload.requestId;
    } catch (_) {
      return false;
    }
  }

  return Object.freeze({ CHANNEL, PROTOCOL_VERSION, validateTask, isEnvelope });
});
