import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createMainAppSessionCookie, getMainAppSessionCookieName } from "../lib/main-app-sso";
import { setContentStorageGatewayForTests } from "../lib/content-storage/cos";
import type { ContentStorageGateway, StoredObject } from "../lib/content-storage/gateway";
import { POST as CREATE_INTENT } from "../app/api/content-storage/upload-intents/route";
import { POST as COMMIT } from "../app/api/content-storage/items/[contentId]/commit/route";
import { GET as LIST } from "../app/api/content-storage/items/route";
import { GET as MEDIA } from "../app/api/content-storage/items/[contentId]/media/[fileId]/route";

class MemoryGateway implements ContentStorageGateway {
  objects = new Map<string, StoredObject>();
  async createPutUrl(key: string) { return `https://upload.test/${encodeURIComponent(key)}`; }
  async headObject(key: string) {
    const value = this.objects.get(key);
    return value ? { contentType: value.contentType, size: value.bytes.byteLength } : undefined;
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

async function request(ownerId: string, url: string, init?: RequestInit) {
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
});

test("list route rejects requests without the SSO cookie", async () => {
  const response = await LIST(new NextRequest("https://app.test/api/content-storage/items"));
  assert.equal(response.status, 401);
});
