import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  createXhsExtensionClient,
  XHS_EXTENSION_CHANNEL,
  XHS_EXTENSION_PROTOCOL_VERSION,
  type XhsCollectTask
} from "../lib/xhs-extension-client";

const require = createRequire(import.meta.url);
const protocol = require("../browser-extension/shared/protocol.js") as {
  isEnvelope(message: unknown, direction: string): boolean;
};

type MessageListener = (event: MessageEvent) => void;
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_KEY = "sha256-0123456789abcdef0123456789abcdef";

class FakeMessageTarget {
  readonly origin = "https://studio.example.test";
  readonly messages: Array<{ message: unknown; targetOrigin: string }> = [];
  private readonly listeners = new Set<MessageListener>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "message") this.listeners.add(listener as MessageListener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "message") this.listeners.delete(listener as MessageListener);
  }

  postMessage(message: unknown, targetOrigin: string) {
    this.messages.push({ message, targetOrigin });
  }

  receive(data: unknown, options: { origin?: string; source?: MessageEventSource | null } = {}) {
    const event = {
      data,
      origin: options.origin ?? this.origin,
      source: options.source === undefined ? this : options.source
    } as MessageEvent;
    for (const listener of this.listeners) listener(event);
  }
}

function collectTask(requestId = REQUEST_ID): XhsCollectTask {
  return {
    requestId,
    queries: ["夏日穿搭"],
    limitPerQuery: 5,
    mediaType: "全部",
    dateRange: "全部",
    sortBy: "浏览量",
    existingUrls: []
  };
}

function fakeMediaStore() {
  const calls: string[] = [];
  return {
    calls,
    async prepare() { calls.push("prepare"); return "ready" as const; },
    async writeChunk() { calls.push("chunk"); },
    async complete() { calls.push("complete"); return {} as never; },
    async abort() { calls.push("abort"); },
    async getBlob() { return null; },
    async deleteAssets() {},
    async cleanupIncomplete() { calls.push("cleanup"); return 0; }
  };
}

function extensionMessage(type: string, requestId: string, payload: unknown, protocolVersion = XHS_EXTENSION_PROTOCOL_VERSION) {
  return {
    channel: XHS_EXTENSION_CHANNEL,
    protocolVersion,
    direction: "extension-to-page",
    type,
    requestId,
    payload
  };
}

test("detects a compatible local extension", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const detection = client.detect();
  const request = target.messages[0]?.message as { requestId: string; type: string };

  assert.equal(request.type, "ping");
  target.receive(extensionMessage("pong", request.requestId, { version: "0.1.0" }));

  assert.deepEqual(await detection, { version: "0.1.0", protocolVersion: 2 });
  client.dispose();
});

test("streams progress before the final collection result", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const progress: string[] = [];
  const collected = client.collect(collectTask(), (update) => progress.push(update.stage));

  target.receive(extensionMessage("progress", REQUEST_ID, {
    stage: "searching", completed: 1, total: 2, message: "正在搜索"
  }));
  target.receive(extensionMessage("result", REQUEST_ID, { topics: [], message: "完成", mediaCompleted: 0, mediaFailed: 0 }));

  assert.deepEqual(progress, ["searching"]);
  assert.deepEqual(await collected, { topics: [], message: "完成", mediaCompleted: 0, mediaFailed: 0 });
  client.dispose();
});

test("does not resolve detection from a collection result", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const detection = client.detect();
  const request = target.messages[0]?.message as { requestId: string };
  let settled = false;
  void detection.then(() => { settled = true; }, () => { settled = true; });

  target.receive(extensionMessage("result", request.requestId, { topics: [], message: "完成", mediaCompleted: 0, mediaFailed: 0 }));
  await Promise.resolve();

  assert.equal(settled, false);
  target.receive(extensionMessage("pong", request.requestId, { version: "0.1.0" }));
  await detection;
  client.dispose();
});

test("does not resolve collection from a pong", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const collected = client.collect(collectTask());
  let settled = false;
  void collected.then(() => { settled = true; }, () => { settled = true; });

  target.receive(extensionMessage("pong", REQUEST_ID, { version: "0.1.0" }));
  await Promise.resolve();

  assert.equal(settled, false);
  target.receive(extensionMessage("result", REQUEST_ID, { topics: [], message: "完成", mediaCompleted: 0, mediaFailed: 0 }));
  await collected;
  client.dispose();
});

test("rejects collection when the extension reports an error", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const collected = client.collect(collectTask());

  target.receive(extensionMessage("error", REQUEST_ID, { code: "LOGIN_REQUIRED", message: "请先登录小红书" }));

  await assert.rejects(collected, (error: Error & { code?: string }) => error.message === "请先登录小红书" && error.code === "LOGIN_REQUIRED");
  client.dispose();
});

test("rejects a matching response from an incompatible extension protocol", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const detection = client.detect();
  const request = target.messages[0]?.message as { requestId: string };

  target.receive(extensionMessage("pong", request.requestId, { version: "0.9.0", protocolVersion: 0 }, 0));

  await assert.rejects(detection, /incompatible|upgrade/i);
  client.dispose();
});

test("dispose rejects a pending request", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const detection = client.detect();

  client.dispose();

  await assert.rejects(detection, /disposed/i);
});

test("ignores messages from the wrong origin or source", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 25);
  const detection = client.detect();
  const request = target.messages[0]?.message as { requestId: string };

  target.receive(extensionMessage("pong", request.requestId, { version: "1.2.3", protocolVersion: 1 }), { origin: "https://other.example.test" });
  target.receive(extensionMessage("pong", request.requestId, { version: "1.2.3", protocolVersion: 1 }), { source: {} as MessageEventSource });

  await assert.rejects(detection, /timed out/i);
  client.dispose();
});

test("uses the fixed collection timeout when a custom ping timeout is supplied", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const delays: number[] = [];
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    delays.push(timeout ?? 0);
    return originalSetTimeout(handler, 1_000, ...args);
  }) as typeof setTimeout;

  try {
    const target = new FakeMessageTarget();
    const client = createXhsExtensionClient(target, 25);
    const collected = client.collect(collectTask());
    client.dispose();

    await assert.rejects(collected, /disposed/i);
    assert.deepEqual(delays, [600_000]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("cancels the local collection and ignores late extension messages", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const progress: string[] = [];
  const collected = client.collect(collectTask(), (update) => progress.push(update.stage));
  let cancellation: Error | undefined;
  void collected.catch((error) => { cancellation = error; });

  await client.cancel(REQUEST_ID);
  await Promise.resolve();

  try {
    assert.equal((target.messages[1]?.message as { type: string }).type, "cancel");
    assert.match(cancellation?.message ?? "", /取消|canceled/i);
    assert.doesNotThrow(() => target.receive(extensionMessage("progress", REQUEST_ID, {
      stage: "searching", completed: 1, total: 1, message: "late"
    })));
    assert.doesNotThrow(() => target.receive(extensionMessage("result", REQUEST_ID, { topics: [], message: "late", mediaCompleted: 0, mediaFailed: 0 })));
    assert.doesNotThrow(() => target.receive(extensionMessage("error", REQUEST_ID, { message: "late" })));
    assert.deepEqual(progress, []);
  } finally {
    client.dispose();
    await assert.rejects(collected);
  }
});

test("uses the canonical empty cancel envelope accepted by the extension protocol", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const collected = client.collect(collectTask());
  const rejected = assert.rejects(collected, /canceled/i);

  await client.cancel(REQUEST_ID);

  const cancelEnvelope = target.messages[1]?.message;
  assert.equal(protocol.isEnvelope(cancelEnvelope, "page-to-extension"), true);
  assert.deepEqual((cancelEnvelope as { payload: unknown }).payload, {});
  await rejected;
  client.dispose();
});

test("rejects malformed pong and error payloads without throwing from the listener", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const detection = client.detect();
  const ping = target.messages[0]?.message as { requestId: string };

  assert.doesNotThrow(() => target.receive(extensionMessage("pong", ping.requestId, null)));
  await assert.rejects(detection, /扩展响应格式异常/);

  const collected = client.collect(collectTask());
  assert.doesNotThrow(() => target.receive(extensionMessage("error", REQUEST_ID, null)));
  await assert.rejects(collected, /扩展响应格式异常/);
  client.dispose();
});

test("rejects malformed progress and result payloads and clears the collection", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const malformedProgress = client.collect(collectTask());
  let progressError: Error | undefined;
  void malformedProgress.catch((error) => { progressError = error; });

  assert.doesNotThrow(() => target.receive(extensionMessage("progress", REQUEST_ID, {
    stage: "bad", completed: Number.NaN, total: 1, message: 3
  })));
  await Promise.resolve();
  try {
    assert.match(progressError?.message ?? "", /扩展响应格式异常/);
    assert.doesNotThrow(() => target.receive(extensionMessage("result", REQUEST_ID, { topics: [], message: "late", mediaCompleted: 0, mediaFailed: 0 })));

    const malformedResult = client.collect(collectTask());
    assert.doesNotThrow(() => target.receive(extensionMessage("result", REQUEST_ID, { topics: null, message: "bad", mediaCompleted: 0, mediaFailed: 0 })));
    await assert.rejects(malformedResult, /扩展响应格式异常/);
  } finally {
    client.dispose();
    await assert.rejects(malformedProgress);
  }
});

test("rejects every public operation after disposal without posting messages", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  client.dispose();

  await assert.rejects(client.detect(), /disposed/i);
  await assert.rejects(client.collect(collectTask()), /disposed/i);
  await assert.rejects(client.cancel(REQUEST_ID), /disposed/i);
  assert.deepEqual(target.messages, []);
});

test("persists media messages in order and acknowledges only durable writes", async () => {
  const target = new FakeMessageTarget();
  const store = fakeMediaStore();
  const client = createXhsExtensionClient(target, 100, store);
  const collected = client.collect(collectTask());

  target.receive(extensionMessage("media:start", REQUEST_ID, {
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "image",
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg"
  }));
  await Promise.resolve();
  await Promise.resolve();
  target.receive(extensionMessage("media:chunk", REQUEST_ID, {
    assetKey: ASSET_KEY,
    chunkIndex: 0,
    data: "AQ==",
    byteLength: 1
  }));
  await Promise.resolve();
  await Promise.resolve();
  target.receive(extensionMessage("media:complete", REQUEST_ID, {
    assetKey: ASSET_KEY,
    mimeType: "image/jpeg",
    byteLength: 1,
    chunkCount: 1
  }));
  await Promise.resolve();
  await Promise.resolve();
  target.receive(extensionMessage("result", REQUEST_ID, {
    topics: [], message: "完成", mediaCompleted: 1, mediaFailed: 0
  }));

  const result = await collected;
  assert.deepEqual(store.calls, ["prepare", "chunk", "complete"]);
  assert.deepEqual(target.messages.slice(1).map((item) => (item.message as any).type), ["media:ready", "media:ack", "media:ack"]);
  assert.deepEqual(result, { topics: [], message: "完成", mediaCompleted: 1, mediaFailed: 0 });
  client.dispose();
});

test("store failures abort one media without rejecting the collection", async () => {
  const target = new FakeMessageTarget();
  const store = fakeMediaStore();
  store.writeChunk = async () => { throw new DOMException("Quota", "QuotaExceededError"); };
  const client = createXhsExtensionClient(target, 100, store);
  const collected = client.collect(collectTask());
  target.receive(extensionMessage("media:chunk", REQUEST_ID, {
    assetKey: ASSET_KEY, chunkIndex: 0, data: "AQ==", byteLength: 1
  }));
  target.receive(extensionMessage("result", REQUEST_ID, {
    topics: [], message: "部分媒体失败", mediaCompleted: 0, mediaFailed: 1
  }));
  assert.equal((await collected).mediaFailed, 1);
  const abort = target.messages.at(-1)?.message as any;
  assert.equal(abort.type, "media:abort");
  assert.equal(abort.payload.code, "QUOTA_EXCEEDED");
  client.dispose();
});

test("detection sends a delayed protocol-1 ping so an installed old extension is reported as outdated", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 500);
  const detection = client.detect();
  await new Promise((resolve) => setTimeout(resolve, 175));
  const pings = target.messages.map((item) => item.message as { protocolVersion: number; requestId: string });
  assert.deepEqual(pings.map((item) => item.protocolVersion), [2, 1]);
  target.receive(extensionMessage("pong", pings[1].requestId, { version: "0.1.10" }, 1));
  await assert.rejects(detection, /incompatible|upgrade/i);
  client.dispose();
});
