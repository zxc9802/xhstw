import assert from "node:assert/strict";
import test from "node:test";
import {
  createDirectCdpBrowserCommandRunner,
  createOpenCliCommandRouter
} from "../lib/adapters/opencli-direct-cdp";

test("runs browser open, eval, and close through an isolated CDP target", async () => {
  const calls: Array<{ type: string; value?: unknown }> = [];
  const page = {
    async goto(url: string) {
      calls.push({ type: "goto", value: url });
    },
    async evaluate<T>(script: string) {
      calls.push({ type: "evaluate", value: script });
      return { title: "小红书" } as T;
    }
  };
  const bridge = {
    async connect(options: { cdpEndpoint?: string }) {
      calls.push({ type: "connect", value: options.cdpEndpoint });
      return page;
    },
    async close() {
      calls.push({ type: "disconnect" });
    }
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ type: init?.method === "PUT" ? "create-target" : "close-target", value: url });
    if (init?.method === "PUT") {
      return new Response(JSON.stringify({
        id: "target-1",
        webSocketDebuggerUrl: "ws://10.42.0.1:9223/devtools/page/target-1"
      }), { status: 200 });
    }
    return new Response("Target is closing", { status: 200 });
  };
  const run = createDirectCdpBrowserCommandRunner("http://10.42.0.1:9223", {
    createBridge: () => bridge,
    fetch
  });

  await run(["browser", "collect-1", "open", "https://www.xiaohongshu.com/explore", "--window", "background"]);
  const output = await run(["browser", "collect-1", "eval", "document.title", "--window", "background"]);
  await run(["browser", "collect-1", "close"]);

  assert.equal(output, JSON.stringify({ title: "小红书" }));
  assert.deepEqual(calls, [
    { type: "create-target", value: "http://10.42.0.1:9223/json/new?about%3Ablank" },
    { type: "connect", value: "ws://10.42.0.1:9223/devtools/page/target-1" },
    { type: "goto", value: "https://www.xiaohongshu.com/explore" },
    { type: "disconnect" },
    { type: "connect", value: "ws://10.42.0.1:9223/devtools/page/target-1" },
    { type: "evaluate", value: "document.title" },
    { type: "disconnect" },
    { type: "close-target", value: "http://10.42.0.1:9223/json/close/target-1" }
  ]);
});

test("routes browser commands through direct CDP when an endpoint is configured", async () => {
  const calls: string[] = [];
  const run = createOpenCliCommandRouter(
    "http://10.42.0.1:9223",
    async () => {
      calls.push("direct");
      return "direct-output";
    },
    async () => {
      calls.push("fallback");
      return "fallback-output";
    }
  );

  const output = await run(["browser", "collect-1", "state"], 90_000);

  assert.equal(output, "direct-output");
  assert.deepEqual(calls, ["direct"]);
});

test("keeps the OpenCLI fallback when no CDP endpoint is configured", async () => {
  const calls: string[] = [];
  const run = createOpenCliCommandRouter(
    "",
    async () => {
      calls.push("direct");
      return "direct-output";
    },
    async () => {
      calls.push("fallback");
      return "fallback-output";
    }
  );

  const output = await run(["browser", "collect-1", "state"], 90_000);

  assert.equal(output, "fallback-output");
  assert.deepEqual(calls, ["fallback"]);
});
