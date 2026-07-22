import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const protocol = require("../browser-extension/shared/protocol.js") as {
  CHANNEL: string;
  PROTOCOL_VERSION: number;
  validateTask(task: unknown): { ok: true } | { ok: false; error: string };
  isEnvelope(message: unknown, direction: string): boolean;
};

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

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

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    channel: protocol.CHANNEL,
    protocolVersion: protocol.PROTOCOL_VERSION,
    direction: "page-to-extension",
    type: "collect",
    requestId: REQUEST_ID,
    payload: {},
    ...overrides
  };
}

test("approved limits accepts a valid collection task", () => {
  assert.deepEqual(protocol.validateTask(task()), { ok: true });
});

test("approved limits rejects three keywords", () => {
  assert.equal(protocol.validateTask(task({ queries: ["a", "b", "c"] })).ok, false);
});

test("approved limits rejects zero keywords", () => {
  assert.equal(protocol.validateTask(task({ queries: [] })).ok, false);
});

test("approved limits rejects a per-keyword limit above five", () => {
  assert.equal(protocol.validateTask(task({ limitPerQuery: 6 })).ok, false);
});

test("approved limits rejects a per-keyword limit below one or not an integer", () => {
  assert.equal(protocol.validateTask(task({ limitPerQuery: 0 })).ok, false);
  assert.equal(protocol.validateTask(task({ limitPerQuery: 1.5 })).ok, false);
});

test("approved limits rejects malformed task values", () => {
  const invalidTasks = [
    task({ requestId: "not-a-uuid" }),
    task({ mediaType: "直播" }),
    task({ dateRange: "一个月内" }),
    task({ sortBy: "转发量" }),
    task({ queries: ["   "] }),
    task({ queries: ["x".repeat(41)] }),
    task({ existingUrls: [123] }),
    task({ existingUrls: "https://www.xiaohongshu.com/explore/123" })
  ];

  for (const invalidTask of invalidTasks) {
    assert.equal(protocol.validateTask(invalidTask).ok, false);
  }
});

test("approved limits rejects unknown task fields", () => {
  assert.equal(protocol.validateTask(task({ extra: true })).ok, false);
});

test("approved limits rejects missing task fields and non-object tasks", () => {
  const validTask = task();
  for (const key of Object.keys(validTask)) {
    const missingField = Object.fromEntries(Object.entries(validTask).filter(([taskKey]) => taskKey !== key));
    assert.equal(protocol.validateTask(missingField).ok, false);
  }

  for (const invalidTask of [null, "task", 1, []]) {
    assert.equal(protocol.validateTask(invalidTask).ok, false);
  }
});

test("envelope validation accepts only a complete matching envelope", () => {
  const { payload: _payload, ...withoutPayload } = envelope();

  assert.equal(protocol.isEnvelope(envelope(), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope({ direction: "extension-to-page" }), "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(envelope({ channel: "other" }), "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(envelope({ protocolVersion: 2 }), "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(envelope({ requestId: "bad" }), "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(withoutPayload, "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(envelope({ type: 1 }), "page-to-extension"), false);
  assert.equal(protocol.isEnvelope(null, "page-to-extension"), false);
  assert.equal(protocol.isEnvelope([], "page-to-extension"), false);
  assert.equal(protocol.isEnvelope("message", "page-to-extension"), false);
});

test("all-url access is absent from the least-privilege manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../browser-extension/manifest.template.json", import.meta.url), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(Object.keys(manifest), [
    "manifest_version",
    "name",
    "version",
    "description",
    "permissions",
    "host_permissions",
    "background",
    "content_scripts",
    "action"
  ]);
  assert.equal(manifest.name, "小红书本机抓取助手");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.description, "在用户自己的浏览器中执行内容生产中台下达的小红书公开页面抓取任务。");
  assert.deepEqual(manifest.host_permissions, ["https://www.xiaohongshu.com/*", "__APP_MATCH_PATTERN__"]);
  assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.equal(JSON.stringify(manifest).includes("cookies"), false);
  assert.equal(JSON.stringify(manifest).includes("history"), false);
  assert.deepEqual(manifest.background, { service_worker: "background.js" });
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["http://127.0.0.1:3000/*", "__APP_MATCH_PATTERN__"],
      js: ["shared/protocol.js", "app-bridge.js"],
      run_at: "document_start"
    },
    {
      matches: ["https://www.xiaohongshu.com/*"],
      js: ["shared/protocol.js", "shared/collector.js", "xhs-content.js"],
      run_at: "document_idle"
    }
  ]);
  assert.deepEqual(manifest.action, { default_title: "小红书本机抓取助手" });
});
