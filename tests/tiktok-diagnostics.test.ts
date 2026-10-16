import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { POST } from "../app/api/tiktok/collect/route";
import { createMainAppSessionCookie } from "../lib/main-app-sso";
import { createCollectionApi } from "../lib/tiktok/collection-api";
import { collectionTraceHeader } from "../lib/tiktok/diagnostics";

function capture(t: TestContext) {
  const logs: Array<Record<string, unknown>> = [];
  t.mock.method(console, "info", (line: string) => logs.push(JSON.parse(line)));
  return logs;
}

function environment(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test("missing login remains a redirect and records only collection request metadata", async t => {
  environment(t, { DISABLE_SSO: "false", MAIN_APP_URL: "https://main.example" });
  const logs = capture(t);
  const response = await middleware(new NextRequest("https://studio.example/api/tiktok/collect", { method: "POST", headers: { cookie: "secret-cookie", authorization: "secret-authorization", [collectionTraceHeader]: "untrusted-input" } }));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://main.example/home2?externalSso=xhstw");
  assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
  assert.deepEqual(logs.map(log => log.stage), ["auth.enter", "auth.redirect"]);
  assert.ok(logs.every(log => log.requestId === response.headers.get(collectionTraceHeader)));
  assert.doesNotMatch(JSON.stringify(logs), /secret-cookie|secret-authorization|untrusted-input/);
  await middleware(new NextRequest("https://studio.example/topics"));
  assert.equal(logs.length, 2, "unrelated routes should not produce collection logs");
});

test("valid session forwards one generated ID and exposes SSO status without its token", async t => {
  environment(t, { DISABLE_SSO: "false", APP_SESSION_SECRET: "secret-session-key", MAIN_APP_URL: "https://main.example" });
  const logs = capture(t);
  const cookie = await createMainAppSessionCookie({ token: "secret-main-token", user: { id: "1", account: "private@example.com", nickname: "private-name", role: "member" }, expiresAt: Date.now() + 60_000 });
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
  const response = await middleware(new NextRequest("https://studio.example/api/tiktok/collect", { headers: { cookie: `qycm_xhstw_sso=${cookie}` } }));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get(`x-middleware-request-${collectionTraceHeader}`), response.headers.get(collectionTraceHeader));
  assert.deepEqual(logs.map(log => log.stage), ["auth.enter", "auth.checked", "auth.pass"]);
  assert.equal(logs[1].status, 200);
  assert.doesNotMatch(JSON.stringify(logs), /secret-|private@|private-name/);
});

test("failed upstream calls retain fallback and record HTTP status without inputs or bodies", async t => {
  const logs = capture(t), requestId = crypto.randomUUID();
  const api = createCollectionApi({ requestId, scrapeCreatorsApiKey: "secret-sc-key", apiKey: "secret-tikhub-key", fetcher: (async input => {
    return String(input).includes("scrapecreators") ? new Response("secret-upstream-body", { status: 502, headers: { "Content-Type": "text/html" } }) : Response.json({ code: 200, data: { data: [], has_more: false } });
  }) as typeof fetch });
  const result = await api.request("fetch_general_search_result", { keyword: "private-search", region: "MY", offset: 0 });
  assert.equal(result.provider, "tikhub");
  assert.ok(logs.every(log => log.requestId === requestId));
  assert.deepEqual(logs.filter(log => log.stage === "upstream.response").map(log => [log.provider, log.status]), [["scrapecreators", 502], ["tikhub", 200]]);
  assert.deepEqual(logs.filter(log => log.stage === "upstream.start").map(log => log.attempt), [1, 2]);
  assert.ok(logs.some(log => log.stage === "upstream.error" && typeof log.elapsedMs === "number"));
  assert.doesNotMatch(JSON.stringify(logs), /secret-|private-search/);
});

test("route traces preserve success and error JSON and correlate with upstream calls", async t => {
  environment(t, { SCRAPECREATORS_API_KEY: "secret-key", TIKHUB_API_KEY: "" });
  const logs = capture(t), requestId = crypto.randomUUID();
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, search_item_list: [], has_more: 0 }));
  const response = await POST(new Request("https://studio.example/api/tiktok/collect", { method: "POST", headers: { [collectionTraceHeader]: requestId, "Content-Type": "application/json" }, body: JSON.stringify({ keyword: "private-search", limit: 1 }) }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.scanned, 0);
  assert.equal(response.headers.get(collectionTraceHeader), requestId);
  assert.ok(logs.every(log => log.requestId === requestId));
  assert.equal(logs[0].stage, "route.enter");
  assert.equal(logs.at(-1)?.stage, "route.complete");
  assert.equal(logs.at(-1)?.status, 200);
  assert.doesNotMatch(JSON.stringify(logs), /secret-key|private-search/);
  const bad = await POST(new Request("https://studio.example/api/tiktok/collect", { method: "POST", body: "invalid-json" }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).ok, false);
  assert.equal(logs.at(-1)?.stage, "route.error");
  assert.equal(logs.at(-1)?.status, 400);
});
