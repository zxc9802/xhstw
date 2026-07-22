import assert from "node:assert/strict";
import test from "node:test";
import {
  createXhsExtensionClient,
  XHS_EXTENSION_CHANNEL,
  XHS_EXTENSION_PROTOCOL_VERSION,
  type XhsCollectTask
} from "../lib/xhs-extension-client";

type MessageListener = (event: MessageEvent) => void;

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

function collectTask(requestId = "collect-1"): XhsCollectTask {
  return {
    requestId,
    queries: ["夏日穿搭"],
    limitPerQuery: 10,
    mediaType: "全部",
    dateRange: "全部",
    sortBy: "浏览量",
    existingUrls: []
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

  assert.deepEqual(await detection, { version: "0.1.0", protocolVersion: 1 });
  client.dispose();
});

test("streams progress before the final collection result", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const progress: string[] = [];
  const collected = client.collect(collectTask(), (update) => progress.push(update.stage));

  target.receive(extensionMessage("progress", "collect-1", {
    stage: "searching", completed: 1, total: 2, message: "正在搜索"
  }));
  target.receive(extensionMessage("result", "collect-1", { topics: [], message: "完成" }));

  assert.deepEqual(progress, ["searching"]);
  assert.deepEqual(await collected, { topics: [], message: "完成" });
  client.dispose();
});

test("does not resolve detection from a collection result", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const detection = client.detect();
  const request = target.messages[0]?.message as { requestId: string };
  let settled = false;
  void detection.then(() => { settled = true; }, () => { settled = true; });

  target.receive(extensionMessage("result", request.requestId, { topics: [], message: "完成" }));
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

  target.receive(extensionMessage("pong", "collect-1", { version: "0.1.0" }));
  await Promise.resolve();

  assert.equal(settled, false);
  target.receive(extensionMessage("result", "collect-1", { topics: [], message: "完成" }));
  await collected;
  client.dispose();
});

test("rejects collection when the extension reports an error", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target, 100);
  const collected = client.collect(collectTask());

  target.receive(extensionMessage("error", "collect-1", { code: "LOGIN_REQUIRED", message: "请先登录小红书" }));

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
