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
  const MEDIA_TYPES = ["全部", "图文", "视频"];
  const DATE_RANGES = ["全部", "一天内", "一周内", "半年内"];
  const SORT_BY = ["浏览量", "点赞量", "评论量", "收藏量"];

  function isRequestId(value) {
    return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
  }

  function invalid(error) {
    return { ok: false, error };
  }

  function validateTask(task) {
    if (task === null || typeof task !== "object" || Array.isArray(task)) {
      return invalid("任务格式不正确");
    }

    const keys = Object.keys(task);
    if (keys.length !== TASK_KEYS.length || keys.some((key) => !TASK_KEYS.includes(key))) {
      return invalid("任务包含不支持的字段");
    }
    if (!isRequestId(task.requestId)) return invalid("请求 ID 格式不正确");
    if (!Array.isArray(task.queries) || task.queries.length < 1 || task.queries.length > 2 || task.queries.some((query) => typeof query !== "string" || !query.trim() || query.length > 40)) {
      return invalid("关键词格式不正确");
    }
    if (!Number.isInteger(task.limitPerQuery) || task.limitPerQuery < 1 || task.limitPerQuery > 5) {
      return invalid("每个关键词的抓取数量必须为 1 到 5");
    }
    if (!MEDIA_TYPES.includes(task.mediaType)) return invalid("内容类型不正确");
    if (!DATE_RANGES.includes(task.dateRange)) return invalid("发布时间范围不正确");
    if (!SORT_BY.includes(task.sortBy)) return invalid("排序方式不正确");
    if (!Array.isArray(task.existingUrls) || task.existingUrls.some((url) => typeof url !== "string")) {
      return invalid("已有链接格式不正确");
    }
    return { ok: true };
  }

  function isEnvelope(message, direction) {
    return message !== null &&
      typeof message === "object" &&
      !Array.isArray(message) &&
      message.channel === CHANNEL &&
      message.protocolVersion === PROTOCOL_VERSION &&
      message.direction === direction &&
      typeof message.type === "string" &&
      Object.prototype.hasOwnProperty.call(message, "payload") &&
      isRequestId(message.requestId);
  }

  return Object.freeze({ CHANNEL, PROTOCOL_VERSION, validateTask, isEnvelope });
});
