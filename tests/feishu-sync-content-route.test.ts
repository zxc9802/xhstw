import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/feishu/sync-content/route";
import { setContentStorageGatewayForTests } from "../lib/content-storage/cos";
import type { ContentStorageGateway, StoredObject } from "../lib/content-storage/gateway";
import { createMainAppSessionCookie, getMainAppSessionCookieName } from "../lib/main-app-sso";

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

class MemoryContentGateway implements ContentStorageGateway {
  objects = new Map<string, StoredObject>();
  async headObject(key: string) {
    const value = this.objects.get(key);
    return value ? { contentType: value.contentType, size: value.bytes.byteLength } : undefined;
  }
  async putObject(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes, contentType });
  }
  async putJson(key: string, value: unknown) {
    this.objects.set(key, { bytes: new TextEncoder().encode(JSON.stringify(value)), contentType: "application/json" });
  }
  async getJson(key: string) {
    const value = this.objects.get(key);
    return value ? JSON.parse(new TextDecoder().decode(value.bytes)) : undefined;
  }
  async listKeys(prefix: string) { return [...this.objects.keys()].filter((key) => key.startsWith(prefix)); }
  async getObject(key: string) { return this.objects.get(key); }
  async deleteKeys(keys: string[]) { keys.forEach((key) => this.objects.delete(key)); }
}

test("maps an upload into the current Feishu content fields", async (t) => {
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
        { field_name: "上传日期", type: 5 },
        { field_name: "创作内容", type: 17 },
        { field_name: "标题", type: 1 },
        { field_name: "正文标签", type: 1 },
        { field_name: "发布账号信息", type: 18 },
        { field_name: "平台", type: 20 }
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
  assert.equal(recordFields?.正文标签, "浏览器素材正文\n\n#测试标签");
  assert.deepEqual(recordFields?.创作内容, [{ file_token: "file-token-1" }]);
  assert.equal(typeof recordFields?.上传日期, "number");
  assert.equal(recordFields?.平台, undefined);
  assert.equal(recordFields?.发布账号信息, undefined);
});

test("syncs tags into a multi-select keyword alias when that is the live field", async (t) => {
  installFeishuEnv(t);
  const originalFetch = globalThis.fetch;
  let recordFields: Record<string, unknown> | undefined;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ tenant_access_token: "tenant-token" });
    }
    if (url.endsWith("/fields")) {
      return jsonResponse({ data: { items: [
        { field_name: "标题", type: 1 },
        { field_name: "内容正文", type: 1 },
        { field_name: "关键词", type: 4 }
      ] } });
    }
    if (url.endsWith("/records")) {
      recordFields = (JSON.parse(String(init?.body)) as { fields: Record<string, unknown> }).fields;
      return jsonResponse({ data: { record: { record_id: "record-keywords" } } });
    }
    throw new Error(`Unexpected Feishu request: ${url}`);
  }) as typeof fetch;

  const response = await POST(new Request("http://localhost/api/feishu/sync-content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "关键词同步",
      body: "其他字段保持不变",
      tags: ["#防晒", "通勤"]
    })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(recordFields?.关键词, ["防晒", "通勤"]);
  assert.equal(recordFields?.标题, "关键词同步");
  assert.equal(recordFields?.内容正文, "其他字段保持不变");
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

test("names selected images with JPG filenames", async (t) => {
  installFeishuEnv(t);
  const originalFetch = globalThis.fetch;
  const uploadedFileNames: string[] = [];
  const uploadParentTypes: string[] = [];
  let recordFields: Record<string, unknown> | undefined;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ tenant_access_token: "tenant-token" });
    }
    if (url.endsWith("/fields")) {
      return jsonResponse({ data: { items: [
        { field_name: "标题", type: 1 },
        { field_name: "图片或视频", type: 17 }
      ] } });
    }
    if (url.endsWith("/drive/v1/medias/upload_all")) {
      const form = init?.body as FormData;
      const fileName = String(form.get("file_name"));
      uploadedFileNames.push(fileName);
      uploadParentTypes.push(String(form.get("parent_type")));
      return jsonResponse({ data: { file_token: `file-token-${fileName}` } });
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
      title: "按选择顺序上传",
      images: Array.from({ length: 10 }, () => "data:image/png;base64,AA==")
    })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(uploadedFileNames, Array.from({ length: 10 }, (_, index) => `${index + 1}.jpg`));
  assert.deepEqual(uploadParentTypes, Array.from({ length: 10 }, () => "bitable_image"));
  assert.deepEqual(recordFields?.图片或视频, Array.from({ length: 10 }, (_, index) => ({ file_token: `file-token-${index + 1}.jpg` })));
});

test("uploads selected images one at a time in attachment order", async (t) => {
  installFeishuEnv(t);
  const originalFetch = globalThis.fetch;
  let activeUploads = 0;
  let maxActiveUploads = 0;
  let recordFields: Record<string, unknown> | undefined;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ tenant_access_token: "tenant-token" });
    }
    if (url.endsWith("/fields")) {
      return jsonResponse({ data: { items: [
        { field_name: "标题", type: 1 },
        { field_name: "图片或视频", type: 17 }
      ] } });
    }
    if (url.endsWith("/drive/v1/medias/upload_all")) {
      const fileName = String((init?.body as FormData).get("file_name"));
      activeUploads += 1;
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse({ data: { file_token: `file-token-${fileName}` } });
      } finally {
        activeUploads -= 1;
      }
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
      title: "串行上传",
      images: Array.from({ length: 4 }, () => "data:image/png;base64,AA==")
    })
  }));

  assert.equal(response.status, 200);
  assert.equal(maxActiveUploads, 1);
  assert.deepEqual(recordFields?.图片或视频, [
    { file_token: "file-token-1.jpg" },
    { file_token: "file-token-2.jpg" },
    { file_token: "file-token-3.jpg" },
    { file_token: "file-token-4.jpg" }
  ]);
});

test("loads COS images in saved order while keeping the selected publish target", async (t) => {
  installFeishuEnv(t);
  const originalFetch = globalThis.fetch;
  const gateway = new MemoryContentGateway();
  setContentStorageGatewayForTests(gateway);
  t.after(() => {
    globalThis.fetch = originalFetch;
    setContentStorageGatewayForTests(undefined);
  });

  process.env.APP_SESSION_SECRET = "feishu-cos-order-test";
  const ownerId = "member-a";
  const contentId = "20260821T060000000Z-111111111111";
  const prefix = `users/${ownerId}/contents/${contentId}`;
  const firstKey = `${prefix}/images/001-first.png`;
  const secondKey = `${prefix}/images/002-second.png`;
  await gateway.putJson(`${prefix}/manifest.json`, {
    schemaVersion: 1,
    id: contentId,
    ownerId,
    title: "COS 顺序",
    summary: "",
    body: "正文",
    platform: "小红书",
    account: "账号",
    type: "图文",
    mediaKind: "image",
    media: [
      { storage: "cos", fileId: "001-first.png", key: firstKey, contentType: "image/png", size: 1 },
      { storage: "cos", fileId: "002-second.png", key: secondKey, contentType: "image/png", size: 1 }
    ],
    pages: [], referenceSources: [], tags: [], folder: null, prompts: [], negativePrompts: [],
    status: "需复查", systemState: "active", duplicateRate: 0, duplicateLabel: "待检测",
    lowFlowRisk: "低", checkAdvice: [], reviewNotes: [],
    createdAt: "2026-08-21T06:00:00.000Z", updatedAt: "2026-08-21T06:00:00.000Z"
  });
  gateway.objects.set(firstKey, { bytes: new Uint8Array([11]), contentType: "image/png" });
  gateway.objects.set(secondKey, { bytes: new Uint8Array([22]), contentType: "image/png" });

  const uploadedBytes: number[] = [];
  let recordFields: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) return jsonResponse({ tenant_access_token: "tenant-token" });
    if (url.endsWith("/fields")) return jsonResponse({ data: { items: [
      { field_name: "标题", type: 1 },
      { field_name: "平台", type: 1 },
      { field_name: "账号", type: 1 },
      { field_name: "图片或视频", type: 17 }
    ] } });
    if (url.endsWith("/drive/v1/medias/upload_all")) {
      const file = (init?.body as FormData).get("file") as Blob;
      uploadedBytes.push(new Uint8Array(await file.arrayBuffer())[0]);
      return jsonResponse({ data: { file_token: `token-${uploadedBytes.at(-1)}` } });
    }
    if (url.endsWith("/records")) {
      recordFields = (JSON.parse(String(init?.body)) as { fields: Record<string, unknown> }).fields;
      return jsonResponse({ data: { record: { record_id: "record-cos-order" } } });
    }
    throw new Error(`Unexpected Feishu request: ${url}`);
  }) as typeof fetch;

  const cookie = await createMainAppSessionCookie({
    token: "token",
    user: { id: ownerId, account: "member-a@example.com", nickname: "member-a", role: "member" },
    expiresAt: Date.now() + 60_000
  });
  const response = await POST(new NextRequest("http://localhost/api/feishu/sync-content", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${getMainAppSessionCookieName()}=${cookie}`
    },
    body: JSON.stringify({ contentId, platform: "TikTok", accountName: "过期账号" })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(uploadedBytes, [11, 22]);
  assert.deepEqual(recordFields?.图片或视频, [{ file_token: "token-11" }, { file_token: "token-22" }]);
  assert.equal(recordFields?.标题, "COS 顺序");
  assert.equal(recordFields?.平台, "小红书");
  assert.equal(recordFields?.账号, "账号");
});
