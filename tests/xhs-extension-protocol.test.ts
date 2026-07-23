import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const protocol = require("../browser-extension/shared/protocol.js") as {
  CHANNEL: string;
  PROTOCOL_VERSION: number;
  validateTask(task: unknown): { ok: true } | { ok: false; error: string };
  isEnvelope(message: unknown, direction: string): boolean;
};

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_KEY = "sha256-0123456789abcdef0123456789abcdef";

function task(overrides: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST_ID,
    queries: ["夏日穿搭"],
    limitPerQuery: 5,
    mediaType: "全部",
    dateRange: "全部",
    sortBy: "浏览量",
    existingUrls: [],
    ...overrides
  };
}

function envelope(type: string, payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    channel: protocol.CHANNEL,
    protocolVersion: protocol.PROTOCOL_VERSION,
    direction: "page-to-extension",
    type,
    requestId: REQUEST_ID,
    payload,
    ...overrides
  };
}

function extensionEnvelope(type: string, payload: unknown) {
  return envelope(type, payload, { direction: "extension-to-page" });
}

function topic(overrides: Record<string, unknown> = {}) {
  return {
    id: "topic-1",
    platform: "小红书",
    title: "夏日穿搭",
    contentType: "图文",
    likes: "100",
    comments: "10",
    saves: "20",
    risk: "低",
    priority: "P1",
    status: "pending",
    sourceAccount: "账号",
    fetchedAt: "2026-07-22T00:00:00.000Z",
    ...overrides
  };
}

function defineHidden(object: object, key: PropertyKey, value: unknown) {
  Object.defineProperty(object, key, { value, enumerable: false });
  return object;
}

test("approved limits accepts a valid collection task", () => {
  assert.deepEqual(protocol.validateTask(task()), { ok: true });
});

test("approved limits rejects invalid task ranges and values", () => {
  const invalidTasks = [
    task({ queries: [] }),
    task({ queries: ["a", "b", "c"] }),
    task({ queries: ["   "] }),
    task({ queries: ["x".repeat(41)] }),
    task({ limitPerQuery: 0 }),
    task({ limitPerQuery: 6 }),
    task({ limitPerQuery: 1.5 }),
    task({ requestId: "bad" }),
    task({ mediaType: "直播" }),
    task({ dateRange: "一个月内" }),
    task({ sortBy: "转发量" })
  ];

  for (const invalidTask of invalidTasks) assert.equal(protocol.validateTask(invalidTask).ok, false);
});

test("task validation fails closed for record shape and required fields", () => {
  const validTask = task();
  for (const key of Object.keys(validTask)) {
    const missingField = Object.fromEntries(Object.entries(validTask).filter(([taskKey]) => taskKey !== key));
    const result = protocol.validateTask(missingField);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /缺少/);
  }
  const unknown = protocol.validateTask(task({ extra: true }));
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.error, /不支持/);

  const inherited = Object.create(task());
  assert.equal(protocol.validateTask(inherited).ok, false);
  for (const invalidTask of [null, "task", 1, []]) assert.equal(protocol.validateTask(invalidTask).ok, false);
});

test("task validation rejects hidden, symbol, and accessor fields without invoking getters", () => {
  const hidden = defineHidden(task(), "hidden", true);
  const symbolTask = task();
  Object.defineProperty(symbolTask, Symbol("hidden"), { value: true, enumerable: true });
  let getterCalls = 0;
  const accessor = task();
  Object.defineProperty(accessor, "requestId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("must not run");
    }
  });

  for (const invalidTask of [hidden, symbolTask, accessor]) {
    assert.doesNotThrow(() => protocol.validateTask(invalidTask));
    assert.equal(protocol.validateTask(invalidTask).ok, false);
  }
  assert.equal(getterCalls, 0);
});

test("task validation rejects sparse and shadowed arrays without throwing", () => {
  const sparseQueries = ["穿搭", "美妆"];
  delete sparseQueries[1];
  const sparseUrls = ["https://www.xiaohongshu.com/explore/1", "https://www.xiaohongshu.com/explore/2"];
  delete sparseUrls[1];
  const shadowedQueries = ["穿搭"] as unknown as Record<string, unknown>;
  shadowedQueries.some = null;
  shadowedQueries.every = null;
  shadowedQueries.map = null;
  const shadowedUrls = ["https://www.xiaohongshu.com/explore/1"] as unknown as Record<string, unknown>;
  shadowedUrls.some = null;
  shadowedUrls.every = null;
  shadowedUrls.map = null;

  for (const invalidTask of [
    task({ queries: sparseQueries }),
    task({ existingUrls: sparseUrls }),
    task({ queries: shadowedQueries }),
    task({ existingUrls: shadowedUrls })
  ]) {
    assert.doesNotThrow(() => protocol.validateTask(invalidTask));
    assert.equal(protocol.validateTask(invalidTask).ok, false);
  }
});

test("task validation accepts only bounded Xiaohongshu HTTPS existing URLs", () => {
  assert.deepEqual(protocol.validateTask(task({ existingUrls: [] })), { ok: true });
  assert.deepEqual(protocol.validateTask(task({ existingUrls: ["https://sub.xiaohongshu.com/explore/1"] })), { ok: true });
  const tooManyUrls = Array.from({ length: 2001 }, () => "https://www.xiaohongshu.com/explore/1");
  const invalidTasks = [
    task({ existingUrls: "https://www.xiaohongshu.com/explore/1" }),
    task({ existingUrls: [""] }),
    task({ existingUrls: ["x".repeat(2049)] }),
    task({ existingUrls: ["http://www.xiaohongshu.com/explore/1"] }),
    task({ existingUrls: ["https://xiaohongshu.com.evil.example/1"] }),
    task({ existingUrls: [123] }),
    task({ existingUrls: tooManyUrls })
  ];
  for (const invalidTask of invalidTasks) assert.equal(protocol.validateTask(invalidTask).ok, false);
});

test("page envelopes require exact allowed types and payloads", () => {
  assert.equal(protocol.isEnvelope(envelope("ping", {}), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope("cancel", {}), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope("collect", task()), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope("pong", {}), "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(envelope("collect", task({ requestId: OTHER_REQUEST_ID })), "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(envelope("ping", { unexpected: true }), "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(envelope("", {}), "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(envelope("unknown", {}), "page-to-extension"), false);
});

test("protocol v2 accepts exact media transfer envelopes and rejects malformed chunks", () => {
  assert.equal(protocol.PROTOCOL_VERSION, 2);
  const start = extensionEnvelope("media:start", {
    assetKey: ASSET_KEY,
    topicKey: "xhs:64f0a1b2c3d4e5f60718293a",
    mediaRole: "image",
    sourceUrl: "https://sns-webpic-qc.xhscdn.com/example.jpg"
  });
  const chunk = extensionEnvelope("media:chunk", {
    assetKey: ASSET_KEY,
    chunkIndex: 0,
    data: "AQID",
    byteLength: 3
  });
  const complete = extensionEnvelope("media:complete", {
    assetKey: ASSET_KEY,
    mimeType: "image/jpeg",
    byteLength: 3,
    chunkCount: 1
  });
  const mediaError = extensionEnvelope("media:error", {
    assetKey: ASSET_KEY,
    code: "MEDIA_FETCH_FAILED",
    message: "图片下载失败"
  });

  assert.equal(protocol.isEnvelope(start, "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(chunk, "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(complete, "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(mediaError, "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(envelope("media:ready", { assetKey: ASSET_KEY }), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope("media:skip", { assetKey: ASSET_KEY }), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope("media:ack", { assetKey: ASSET_KEY, chunkIndex: 0 }), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope("media:abort", {
    assetKey: ASSET_KEY,
    code: "QUOTA_EXCEEDED",
    message: "本机存储空间不足"
  }), "page-to-extension"), true);

  assert.equal(protocol.isEnvelope(extensionEnvelope("media:chunk", {
    assetKey: ASSET_KEY,
    chunkIndex: 1,
    data: "***",
    byteLength: 3
  }), "extension-to-page"), false);
  assert.equal(protocol.isEnvelope(extensionEnvelope("media:complete", {
    assetKey: ASSET_KEY,
    mimeType: "text/html",
    byteLength: 3,
    chunkCount: 1
  }), "extension-to-page"), false);
});

test("protocol v2 result carries local media metadata and media counters", () => {
  const localTopic = topic({
    media: [{
      type: "video",
      url: "https://sns-video-qc.xhscdn.com/example.mp4",
      posterUrl: "https://sns-webpic-qc.xhscdn.com/poster.jpg",
      localAssetKey: ASSET_KEY,
      posterLocalAssetKey: "sha256-fedcba9876543210fedcba9876543210",
      mimeType: "video/mp4",
      size: 1024
    }]
  });
  assert.equal(protocol.isEnvelope(extensionEnvelope("result", {
    topics: [localTopic],
    message: "完成",
    mediaCompleted: 2,
    mediaFailed: 0
  }), "extension-to-page"), true);
});

test("extension envelopes require exact allowed types and payloads", () => {
  assert.equal(protocol.isEnvelope(extensionEnvelope("pong", { version: "0.1.0" }), "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(extensionEnvelope("progress", { stage: "searching", completed: 1, total: 2, message: "正在搜索" }), "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(extensionEnvelope("result", { topics: [topic()], message: "完成", mediaCompleted: 0, mediaFailed: 0 }), "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(extensionEnvelope("error", { code: "LOGIN_REQUIRED", message: "请先登录" }), "extension-to-page"), true);
  const invalid = [
    extensionEnvelope("ping", {}),
    extensionEnvelope("pong", { version: "" }),
    extensionEnvelope("progress", { stage: "bad", completed: 1, total: 2, message: "ok" }),
    extensionEnvelope("progress", { stage: "searching", completed: 3, total: 2, message: "ok" }),
    extensionEnvelope("progress", { stage: "searching", completed: Number.MAX_SAFE_INTEGER + 1, total: Number.MAX_SAFE_INTEGER + 1, message: "ok" }),
    extensionEnvelope("progress", { stage: "searching", completed: 1, total: 11, message: "ok" }),
    extensionEnvelope("result", { topics: [topic({ platform: "抖音" })], message: "完成", mediaCompleted: 0, mediaFailed: 0 }),
    extensionEnvelope("result", { topics: [null], message: "完成", mediaCompleted: 0, mediaFailed: 0 }),
    extensionEnvelope("error", { code: "", message: "请先登录" }),
    extensionEnvelope("error", { code: "LOGIN_REQUIRED", message: "" })
  ];
  for (const message of invalid) assert.equal(protocol.isEnvelope(message, "extension-to-page"), false);
});

test("envelope validation rejects malformed records and never throws", () => {
  const valid = envelope("ping", {});
  const inherited = Object.create(valid);
  const { payload: _payload, ...withoutPayload } = valid;
  const sparseTopics = [topic(), topic()];
  delete sparseTopics[1];
  const invalidMessages = [
    null,
    [],
    "message",
    { ...valid, extra: true },
    inherited,
    withoutPayload,
    { ...valid, direction: "extension-to-page" },
    { ...valid, channel: "other" },
    { ...valid, protocolVersion: 999 },
    { ...valid, requestId: "bad" },
    extensionEnvelope("result", { topics: [topic({ sourceAccount: "" })], message: "完成", mediaCompleted: 0, mediaFailed: 0 })
  ];
  for (const message of invalidMessages) {
    assert.doesNotThrow(() => protocol.isEnvelope(message, "page-to-extension"));
    assert.equal(protocol.isEnvelope(message, "page-to-extension"), false);
  }
  assert.doesNotThrow(() => protocol.isEnvelope(extensionEnvelope("result", { topics: sparseTopics, message: "完成", mediaCompleted: 0, mediaFailed: 0 }), "extension-to-page"));
  assert.equal(protocol.isEnvelope(extensionEnvelope("result", { topics: sparseTopics, message: "完成", mediaCompleted: 0, mediaFailed: 0 }), "extension-to-page"), false);
});

test("envelope validation rejects hidden, symbol, and accessor fields without invoking getters", () => {
  const hidden = defineHidden(envelope("ping", {}), "hidden", true);
  const symbolEnvelope = envelope("ping", {});
  Object.defineProperty(symbolEnvelope, Symbol("hidden"), { value: true, enumerable: true });
  let getterCalls = 0;
  const accessor = envelope("ping", {});
  Object.defineProperty(accessor, "type", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "collect";
    }
  });

  for (const invalidMessage of [hidden, symbolEnvelope, accessor]) {
    assert.doesNotThrow(() => protocol.isEnvelope(invalidMessage, "page-to-extension"));
    assert.equal(protocol.isEnvelope(invalidMessage, "page-to-extension"), false);
  }
  assert.equal(getterCalls, 0);
});

test("result topics and media require exact safe object shapes", () => {
  const validMedia = { type: "image", url: "https://ci.xiaohongshu.com/image.jpg", name: "封面", posterUrl: "https://ci.xiaohongshu.com/poster.jpg" };
  assert.equal(protocol.isEnvelope(extensionEnvelope("result", { topics: [topic({ media: [validMedia] })], message: "完成", mediaCompleted: 0, mediaFailed: 0 }), "extension-to-page"), true);

  const hiddenTopic = defineHidden(topic(), "hidden", true);
  const symbolTopic = topic();
  Object.defineProperty(symbolTopic, Symbol("hidden"), { value: true, enumerable: true });
  let getterCalls = 0;
  const accessorTopic = topic();
  Object.defineProperty(accessorTopic, "title", { enumerable: true, get: () => { getterCalls += 1; return "错误"; } });
  const hiddenMedia = defineHidden({ ...validMedia }, "hidden", true);
  const symbolMedia = { ...validMedia };
  Object.defineProperty(symbolMedia, Symbol("hidden"), { value: true, enumerable: true });
  const accessorMedia = { ...validMedia };
  Object.defineProperty(accessorMedia, "url", { enumerable: true, get: () => { getterCalls += 1; return "https://ci.xiaohongshu.com/image.jpg"; } });
  const invalidTopics = [
    topic({ unexpected: true }),
    topic({ risk: "未知" }),
    topic({ priority: "P3" }),
    topic({ status: "公开" }),
    topic({ coverType: "gif" }),
    topic({ mediaType: "直播" }),
    topic({ url: "not a url" }),
    topic({ media: [{ ...validMedia, extra: true }] }),
    topic({ media: [{ ...validMedia, type: "gif" }] }),
    topic({ media: [{ ...validMedia, url: "http://ci.xiaohongshu.com/image.jpg" }] }),
    topic({ media: [hiddenMedia] }),
    topic({ media: [symbolMedia] }),
    topic({ media: [accessorMedia] }),
    hiddenTopic,
    symbolTopic,
    accessorTopic
  ];
  for (const invalidTopic of invalidTopics) {
    assert.doesNotThrow(() => protocol.isEnvelope(extensionEnvelope("result", { topics: [invalidTopic], message: "完成", mediaCompleted: 0, mediaFailed: 0 }), "extension-to-page"));
    assert.equal(protocol.isEnvelope(extensionEnvelope("result", { topics: [invalidTopic], message: "完成", mediaCompleted: 0, mediaFailed: 0 }), "extension-to-page"), false);
  }
  assert.equal(getterCalls, 0);
});

test("result topics use JSON wire omission for optional fields", () => {
  const plannedTopic = topic({
    authorUrl: undefined,
    coverUrl: undefined,
    media: [{ type: "image", url: "https://ci.xiaohongshu.com/image.jpg", posterUrl: undefined }]
  });
  const wireTopic = JSON.parse(JSON.stringify(plannedTopic));

  assert.equal(Object.hasOwn(wireTopic, "authorUrl"), false);
  assert.equal(Object.hasOwn(wireTopic, "coverUrl"), false);
  assert.equal(Object.hasOwn(wireTopic.media[0], "posterUrl"), false);
  assert.equal(protocol.isEnvelope(extensionEnvelope("result", { topics: [wireTopic], message: "完成", mediaCompleted: 0, mediaFailed: 0 }), "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(extensionEnvelope("result", { topics: [topic({ authorUrl: undefined })], message: "完成", mediaCompleted: 0, mediaFailed: 0 }), "extension-to-page"), false);
});

test("manifest is an exact least-privilege template", () => {
  const manifest = JSON.parse(readFileSync(new URL("../browser-extension/manifest.template.json", import.meta.url), "utf8"));

  assert.deepEqual(Object.keys(manifest), ["manifest_version", "name", "version", "description", "permissions", "host_permissions", "background", "content_scripts", "action"]);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "小红书本机抓取助手");
  assert.equal(manifest.version, "0.1.11");
  assert.equal(manifest.description, "在用户自己的浏览器中执行内容生产中台下达的小红书公开页面抓取任务。");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://www.xiaohongshu.com/*",
    "https://*.xiaohongshu.com/*",
    "https://*.xhscdn.com/*",
    "__APP_MATCH_PATTERN__"
  ]);
  assert.deepEqual(manifest.background, { service_worker: "background.js" });
  assert.deepEqual(manifest.content_scripts, [
    { matches: ["__APP_MATCH_PATTERN__"], js: ["shared/protocol.js", "app-bridge.js"], run_at: "document_start" },
    { matches: ["https://www.xiaohongshu.com/*"], js: ["shared/protocol.js", "shared/collector.js", "xhs-content.js"], run_at: "document_idle" }
  ]);
  assert.deepEqual(manifest.action, { default_title: "小红书本机抓取助手" });
  const serialized = JSON.stringify(manifest);
  for (const forbidden of ["<all_urls>", "cookies", "history", "tabs", "localhost", "127.0.0.1"]) assert.equal(serialized.includes(forbidden), false);
});

test("bridge and background use validated messages and visible fixed-tab orchestration", () => {
  const bridge = readFileSync(new URL("../browser-extension/app-bridge.js", import.meta.url), "utf8");
  const background = readFileSync(new URL("../browser-extension/background.js", import.meta.url), "utf8");

  assert.match(bridge, /event\.source\s*!==\s*window/);
  assert.match(bridge, /event\.origin\s*!==\s*location\.origin/);
  assert.match(bridge, /XhsExtensionProtocol\.isEnvelope/);
  assert.match(bridge, /chrome\.runtime\.connect\(\{\s*name:\s*["']xhs-app-bridge["']/);
  assert.match(bridge, /window\.postMessage\([^,]+,\s*location\.origin\)/);
  assert.match(bridge, /pagehide/);

  assert.match(background, /chrome\.tabs\.create\(\{\s*url:[^}]+active:\s*true/);
  assert.match(background, /chrome\.tabs\.update/);
  assert.match(background, /chrome\.tabs\.onRemoved\.addListener/);
  assert.match(background, /chrome\.storage\.session/);
  assert.match(background, /chrome\.storage\.local/);
  assert.match(background, /DETAIL_DELAY_MS\s*=\s*4_000/);
  assert.match(background, /QUERY_DELAY_MS\s*=\s*15_000/);
  assert.match(background, /SEND_RETRY_LIMIT\s*=\s*10/);
  assert.match(background, /SEND_RETRY_DELAY_MS\s*=\s*500/);
  assert.doesNotMatch(background, /navigate\(context,\s*detailUrl\)/);
  assert.match(background, /action:\s*["']xhs:detail["'][\s\S]*targetUrl:\s*row\.url/);
  assert.match(background, /SKIPPABLE_DETAIL_CODES\s*=\s*new Set\(\[["']NOTE_UNAVAILABLE["'],\s*["']DETAIL_INCOMPLETE["']\]\)/);
  assert.match(background, /SEARCH_CANDIDATE_LIMIT\s*=\s*5/);
  assert.match(background, /limit:\s*SEARCH_CANDIDATE_LIMIT/);
  assert.match(background, /capturedForQuery/);
  assert.match(background, /skippedUnavailable/);
  assert.match(background, /importScripts\([\s\S]*shared\/media-transfer\.js/);
  assert.match(background, /async function transferTopicMedia/);
  assert.match(background, /mediaTransfer\.buildMediaJobs\(topic\)/);
  assert.match(background, /await waitForMediaReply\(context, assetKey, new Set\(\["media:ready", "media:skip", "media:abort"\]\)\)/);
  assert.match(background, /post\(context, "media:chunk"/);
  assert.match(background, /post\(context, "media:complete"/);
  assert.match(background, /mediaCompleted/);
  assert.match(background, /mediaFailed/);
  assert.match(background, /await transferTopicMedia\(context, topic/);
  assert.match(background, /\["media:ready", "media:skip", "media:ack", "media:abort"\]\.includes\(message\.type\)/);
  assert.match(background, /routeMediaReply\(active, message\)/);
  assert.match(background, /message\.type === "collect"\) void startCollection\(port, originTabId, message\)/);
  assert.doesNotMatch(background, /^\s*void startCollection\(port, originTabId, message\);/m);

  for (const source of [bridge, background]) {
    for (const forbidden of [/eval\s*\(/, /new\s+Function/, /chrome\.cookies/, /document\.cookie/]) {
      assert.equal(forbidden.test(source), false);
    }
  }
});

test("bridge reconnects on the next valid page message after an idle port disconnect", () => {
  const bridge = readFileSync(new URL("../browser-extension/app-bridge.js", import.meta.url), "utf8");
  const origin = "https://xhstw.qycm.top";
  const windowListeners = new Map<string, Array<(event: any) => void>>();
  const ports: Array<{
    posted: unknown[];
    disconnectListeners: Array<() => void>;
  }> = [];
  const fakeWindow = {
    addEventListener(type: string, listener: (event: any) => void) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);
    },
    removeEventListener() {},
    postMessage() {}
  };
  const chrome = {
    runtime: {
      connect() {
        const state = { posted: [] as unknown[], disconnectListeners: [] as Array<() => void> };
        ports.push(state);
        return {
          postMessage(message: unknown) { state.posted.push(message); },
          disconnect() {},
          onMessage: { addListener() {} },
          onDisconnect: { addListener(listener: () => void) { state.disconnectListeners.push(listener); } }
        };
      }
    }
  };

  runInNewContext(bridge, {
    XhsExtensionProtocol: protocol,
    chrome,
    location: { origin },
    window: fakeWindow
  });
  assert.equal(ports.length, 1);

  ports[0].disconnectListeners[0]?.();
  const ping = envelope("ping", {});
  for (const listener of windowListeners.get("message") ?? []) {
    listener({ source: fakeWindow, origin, data: ping });
  }

  assert.equal(ports.length, 2);
  assert.deepEqual(ports[1].posted, [ping]);
});

test("packages a scoped extension for one exact app origin", { skip: process.platform !== "win32" }, () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const version = `0.1.${process.pid % 60_000}`;
  const script = join(repositoryRoot, "scripts", "package-xhs-browser-extension.ps1");
  const staging = join(repositoryRoot, "exports", `xhs-browser-extension-${version}`);
  const zip = `${staging}.zip`;
  const expanded = mkdtempSync(join(tmpdir(), "xhs-extension-package-"));

  try {
    for (const invalidOrigin of ["http://studio.example.test", "https://studio.example.test/admin", "https://studio.example.test/?token=bad"]) {
      assert.throws(() => execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-AppOrigin", invalidOrigin, "-Version", version], { cwd: repositoryRoot, stdio: "pipe" }));
    }
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-AppOrigin", "https://studio.example.test", "-Version", version], { cwd: repositoryRoot, stdio: "pipe" });
    assert.equal(existsSync(zip), true);
    execFileSync("powershell.exe", ["-NoProfile", "-Command", "Expand-Archive -LiteralPath $env:XHS_TEST_ZIP -DestinationPath $env:XHS_TEST_EXPANDED -Force"], {
      stdio: "pipe",
      env: { ...process.env, XHS_TEST_ZIP: zip, XHS_TEST_EXPANDED: expanded }
    });

    const manifestText = readFileSync(join(expanded, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestText);
    assert.equal(manifestText.includes("__APP_MATCH_PATTERN__"), false);
    assert.equal(manifest.version, version);
    assert.deepEqual(manifest.host_permissions, [
      "https://www.xiaohongshu.com/*",
      "https://*.xiaohongshu.com/*",
      "https://*.xhscdn.com/*",
      "https://studio.example.test/*"
    ]);
    assert.deepEqual(manifest.content_scripts[0].matches, ["https://studio.example.test/*"]);
    for (const relativePath of ["background.js", "app-bridge.js", "xhs-content.js", "shared/protocol.js", "shared/collector.js", "shared/task-state.js", "安装说明.md"]) {
      assert.equal(existsSync(join(expanded, relativePath)), true, `${relativePath} should be packaged`);
    }
    const permissions = JSON.stringify([manifest.permissions, manifest.host_permissions]);
    for (const forbidden of ["cookies", "history", "<all_urls>"]) assert.equal(permissions.includes(forbidden), false);
  } finally {
    rmSync(expanded, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
    rmSync(zip, { force: true });
  }
});
