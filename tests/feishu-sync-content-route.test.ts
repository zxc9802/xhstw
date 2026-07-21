import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../app/api/feishu/sync-content/route";

const FEISHU_ENV_KEYS = [
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_APP_TOKEN",
  "FEISHU_BASE_URL",
  "FEISHU_TABLE_ID"
] as const;

function installFeishuEnv(t: TestContext) {
  const previous = Object.fromEntries(FEISHU_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.FEISHU_APP_ID = "app-id";
  process.env.FEISHU_APP_SECRET = "app-secret";
  process.env.FEISHU_APP_TOKEN = "app-token";
  process.env.FEISHU_BASE_URL = "";
  process.env.FEISHU_TABLE_ID = "table-id";
  t.after(() => {
    for (const key of FEISHU_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("uploads a browser image and title into the live Feishu fields", async (t) => {
  installFeishuEnv(t);
  const originalFetch = globalThis.fetch;
  let mediaUploadCalls = 0;
  let recordFields: Record<string, unknown> | undefined;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ tenant_access_token: "tenant-token" });
    }
    if (url.endsWith("/fields")) {
      return jsonResponse({ data: { items: [
        { field_name: "平台", type: 3 },
        { field_name: "账号名称", type: 3 },
        { field_name: "标题", type: 1 },
        { field_name: "内容正文", type: 1 },
        { field_name: "图片或视频", type: 17 },
        { field_name: "小红书tag", type: 1 }
      ] } });
    }
    if (url.endsWith("/drive/v1/medias/upload_all")) {
      mediaUploadCalls += 1;
      return jsonResponse({ data: { file_token: "file-token-1" } });
    }
    if (url.endsWith("/records")) {
      recordFields = (JSON.parse(String(init?.body)) as { fields: Record<string, unknown> }).fields;
      return jsonResponse({ data: { record: { record_id: "record-1" } } });
    }
    throw new Error(`Unexpected Feishu request: ${url}`);
  }) as typeof fetch;

  const response = await POST(new Request("http://localhost/api/feishu/sync-content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: "小红书",
      accountName: "测试账号",
      title: "浏览器素材标题",
      body: "浏览器素材正文",
      images: ["data:image/png;base64,AA=="],
      tags: ["测试标签"]
    })
  }));

  assert.equal(response.status, 200);
  assert.equal(mediaUploadCalls, 1);
  assert.equal(recordFields?.标题, "浏览器素材标题");
  assert.deepEqual(recordFields?.图片或视频, [{ file_token: "file-token-1" }]);
});

test("does not create a text-only record when every requested image upload fails", async (t) => {
  installFeishuEnv(t);
  const originalFetch = globalThis.fetch;
  let recordCreateCalls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ tenant_access_token: "tenant-token" });
    }
    if (url.endsWith("/fields")) {
      return jsonResponse({ data: { items: [
        { field_name: "标题", type: 1 },
        { field_name: "内容正文", type: 1 },
        { field_name: "图片或视频", type: 17 }
      ] } });
    }
    if (url.endsWith("/drive/v1/medias/upload_all")) {
      return jsonResponse({ code: 234001, msg: "media rejected" }, 400);
    }
    if (url.endsWith("/records")) {
      recordCreateCalls += 1;
      return jsonResponse({ data: { record: { record_id: "unexpected-record" } } });
    }
    throw new Error(`Unexpected Feishu request: ${url}`);
  }) as typeof fetch;

  const response = await POST(new Request("http://localhost/api/feishu/sync-content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "应当整体失败",
      body: "不能只留下文字",
      images: ["data:image/png;base64,AA=="]
    })
  }));
  const payload = await response.json() as { message?: string };

  assert.equal(response.status, 500);
  assert.match(payload.message ?? "", /media rejected/);
  assert.equal(recordCreateCalls, 0);
});
