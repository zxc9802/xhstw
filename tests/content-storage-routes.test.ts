import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { createMainAppSessionCookie, getMainAppSessionCookieName } from "../lib/main-app-sso";
import { setContentStorageGatewayForTests } from "../lib/content-storage/cos";
import { CONTENT_IMAGE_MAX_BYTES } from "../lib/content-storage/contracts";
import type { ContentStorageGateway, StoredObject } from "../lib/content-storage/gateway";
import { POST as CREATE_INTENT } from "../app/api/content-storage/upload-intents/route";
import { POST as COMMIT } from "../app/api/content-storage/items/[contentId]/commit/route";
import { POST as CREATE_REPLACEMENT_INTENT } from "../app/api/content-storage/items/[contentId]/upload-intents/route";
import { PUT as REPLACE } from "../app/api/content-storage/items/[contentId]/route";
import { GET as LIST } from "../app/api/content-storage/items/route";
import { GET as MEDIA } from "../app/api/content-storage/items/[contentId]/media/[fileId]/route";

class MemoryGateway implements ContentStorageGateway {
  objects = new Map<string, StoredObject>();
  async headObject(key: string) {
    const value = this.objects.get(key);
    return value ? { contentType: value.contentType, size: value.bytes.byteLength } : undefined;
  }
  async putJson(key: string, value: unknown) {
    this.objects.set(key, { bytes: new TextEncoder().encode(JSON.stringify(value)), contentType: "application/json" });
  }
  async putObject(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes, contentType });
  }
  async getJson(key: string) {
    const value = this.objects.get(key);
    return value ? JSON.parse(new TextDecoder().decode(value.bytes)) : undefined;
  }
  async listKeys(prefix: string) { return [...this.objects.keys()].filter((key) => key.startsWith(prefix)); }
  async getObject(key: string) { return this.objects.get(key); }
  async deleteKeys(keys: string[]) { keys.forEach((key) => this.objects.delete(key)); }
}

async function request(ownerId: string, url: string, init?: { method?: string; body?: BodyInit; headers?: HeadersInit }) {
  process.env.APP_SESSION_SECRET = "content-storage-route-test";
  const cookie = await createMainAppSessionCookie({
    token: "token",
    user: { id: ownerId, account: `${ownerId}@example.com`, nickname: ownerId, role: "member" },
    expiresAt: Date.now() + 60_000
  });
  return new NextRequest(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: `${getMainAppSessionCookieName()}=${cookie}`,
      ...init?.headers
    }
  });
}

const content = {
  title: "云端成品", summary: "摘要", body: "正文", platform: "小红书", account: "账号",
  type: "小红书长图文", mediaKind: "image", pages: [], referenceSources: [], tags: [], folder: null,
  prompts: [], negativePrompts: [], status: "需复查", duplicateRate: 0, duplicateLabel: "待检测",
  lowFlowRisk: "低", checkAdvice: [], reviewNotes: [], externalVideoUrls: []
};

test("route lifecycle is authenticated and member isolated", async (t) => {
  const gateway = new MemoryGateway();
  setContentStorageGatewayForTests(gateway);
  t.after(() => setContentStorageGatewayForTests(undefined));

  const intentResponse = await CREATE_INTENT(await request("member-a", "https://app.test/api/content-storage/upload-intents", {
    method: "POST",
    body: JSON.stringify({ images: [{ contentType: "image/png", size: 4 }] })
  }));
  assert.equal(intentResponse.status, 200);
  const intentPayload = await intentResponse.json();
  const upload = intentPayload.data.uploads[0];
  gateway.objects.set(upload.key, { bytes: new Uint8Array(4), contentType: "image/png" });

  const commitResponse = await COMMIT(await request("member-a", `https://app.test/api/content-storage/items/${intentPayload.data.contentId}/commit`, {
    method: "POST",
    body: JSON.stringify({ content, uploads: intentPayload.data.uploads })
  }), { params: Promise.resolve({ contentId: intentPayload.data.contentId }) });
  assert.equal(commitResponse.status, 200);

  const own = await (await LIST(await request("member-a", "https://app.test/api/content-storage/items"))).json();
  const other = await (await LIST(await request("member-b", "https://app.test/api/content-storage/items"))).json();
  assert.equal(own.data.length, 1);
  assert.deepEqual(other.data, []);

  const media = await MEDIA(await request("member-a", "https://app.test/media"), {
    params: Promise.resolve({ contentId: intentPayload.data.contentId, fileId: upload.fileId })
  });
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("Content-Type"), "image/png");
  const denied = await MEDIA(await request("member-b", "https://app.test/media"), {
    params: Promise.resolve({ contentId: intentPayload.data.contentId, fileId: upload.fileId })
  });
  assert.equal(denied.status, 404);

  const replacementIntentResponse = await CREATE_REPLACEMENT_INTENT(await request("member-a", `https://app.test/api/content-storage/items/${intentPayload.data.contentId}/upload-intents`, {
    method: "POST",
    body: JSON.stringify({ images: [
      { contentType: "image/webp", size: 2 },
      { contentType: "image/png", size: 3 }
    ] })
  }), { params: Promise.resolve({ contentId: intentPayload.data.contentId }) });
  assert.equal(replacementIntentResponse.status, 200);
  const replacementIntent = await replacementIntentResponse.json();
  replacementIntent.data.uploads.forEach((item: { key: string; size: number; contentType: string }) => {
    gateway.objects.set(item.key, { bytes: new Uint8Array(item.size), contentType: item.contentType });
  });
  const replaceResponse = await REPLACE(await request("member-a", `https://app.test/api/content-storage/items/${intentPayload.data.contentId}`, {
    method: "PUT",
    body: JSON.stringify({ content: { ...content, title: "调整后" }, uploads: replacementIntent.data.uploads })
  }), { params: Promise.resolve({ contentId: intentPayload.data.contentId }) });
  assert.equal(replaceResponse.status, 200);
  const replaced = await replaceResponse.json();
  assert.equal(replaced.data.title, "调整后");
  assert.deepEqual(replaced.data.media.map((item: { contentType: string }) => item.contentType), ["image/webp", "image/png"]);
});

test("list route rejects requests without the SSO cookie", async () => {
  const response = await LIST(new NextRequest("https://app.test/api/content-storage/items"));
  assert.equal(response.status, 401);
});

test("uploads image bytes through the authenticated same-origin route", async (t) => {
  const uploadRouteUrl = new URL("../app/api/content-storage/items/[contentId]/media/[fileId]/upload/route.ts", import.meta.url);
  assert.equal(existsSync(fileURLToPath(uploadRouteUrl)), true, "same-origin upload route must exist");
  const { PUT: uploadImage } = await import(uploadRouteUrl.href) as {
    PUT: (
      request: NextRequest,
      context: { params: Promise<{ contentId: string; fileId: string }> }
    ) => Promise<Response>;
  };
  const gateway = new MemoryGateway();
  setContentStorageGatewayForTests(gateway);
  t.after(() => setContentStorageGatewayForTests(undefined));

  const intentResponse = await CREATE_INTENT(await request("member-a", "https://app.test/api/content-storage/upload-intents", {
    method: "POST",
    body: JSON.stringify({ images: [{ contentType: "image/png", size: 4 }] })
  }));
  const intent = (await intentResponse.json()).data;
  const upload = intent.uploads[0];
  const uploadUrl = new URL(upload.uploadUrl, "https://app.test");
  assert.equal(uploadUrl.pathname, `/api/content-storage/items/${intent.contentId}/media/${upload.fileId}/upload`);
  assert.ok(uploadUrl.searchParams.get("token"));

  const response = await uploadImage(await request("member-a", `https://app.test${upload.uploadUrl}`, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array([1, 2, 3, 4])
  }), { params: Promise.resolve({ contentId: intent.contentId, fileId: upload.fileId }) });

  assert.equal(response.status, 200);
  assert.deepEqual(gateway.objects.get(upload.key), {
    bytes: new Uint8Array([1, 2, 3, 4]),
    contentType: "image/png"
  });

  uploadUrl.searchParams.set("token", "forged");
  const forged = await uploadImage(await request("member-a", uploadUrl.toString(), {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array([9, 9, 9, 9])
  }), { params: Promise.resolve({ contentId: intent.contentId, fileId: upload.fileId }) });
  assert.equal(forged.status, 400);
  assert.deepEqual(gateway.objects.get(upload.key)?.bytes, new Uint8Array([1, 2, 3, 4]));

  const wrongMember = await uploadImage(await request("member-b", `https://app.test${upload.uploadUrl}`, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array([9, 9, 9, 9])
  }), { params: Promise.resolve({ contentId: intent.contentId, fileId: upload.fileId }) });
  assert.equal(wrongMember.status, 400);
  assert.equal(gateway.objects.size, 1);
});

test("stops reading an upload as soon as it exceeds the image size limit", async (t) => {
  const { PUT: uploadImage } = await import("../app/api/content-storage/items/[contentId]/media/[fileId]/upload/route");
  const gateway = new MemoryGateway();
  setContentStorageGatewayForTests(gateway);
  t.after(() => setContentStorageGatewayForTests(undefined));

  const intentResponse = await CREATE_INTENT(await request("member-a", "https://app.test/api/content-storage/upload-intents", {
    method: "POST",
    body: JSON.stringify({ images: [{ contentType: "image/png", size: 4 }] })
  }));
  const intent = (await intentResponse.json()).data;
  const upload = intent.uploads[0];
  let pulls = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls <= 25) controller.enqueue(chunk);
      if (pulls === 25) controller.close();
    }
  });

  const response = await uploadImage(await request("member-a", `https://app.test${upload.uploadUrl}`, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body
  }), { params: Promise.resolve({ contentId: intent.contentId, fileId: upload.fileId }) });

  assert.equal(response.status, 400);
  assert.ok(pulls <= Math.ceil(CONTENT_IMAGE_MAX_BYTES / chunk.byteLength) + 2, `read ${pulls} chunks`);
  assert.equal(gateway.objects.has(upload.key), false);
});
