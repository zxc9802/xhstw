import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createMainAppSessionCookie, getMainAppSessionCookieName } from "../lib/main-app-sso";
import { setContentStorageGatewayForTests } from "../lib/content-storage/cos";
import type { ContentStorageGateway, StoredObject } from "../lib/content-storage/gateway";
import { createLibrary2ExtensionToken } from "../lib/content-library-2/extension-token";
import { POST as CREATE_SESSION } from "../app/api/library2/extension-session/route";
import { POST as CREATE_INTENT } from "../app/api/library2/upload-intents/route";
import { POST as COMMIT } from "../app/api/library2/items/[contentId]/commit/route";
import { GET as LIST } from "../app/api/library2/items/route";
import { DELETE as DELETE_ITEM, GET as GET_ITEM } from "../app/api/library2/items/[contentId]/route";
import { DELETE as DELETE_BODY } from "../app/api/library2/items/[contentId]/body/route";
import { DELETE as DELETE_IMAGE, GET as MEDIA } from "../app/api/library2/items/[contentId]/media/[fileId]/route";
import { PUT as UPLOAD } from "../app/api/library2/items/[contentId]/media/[fileId]/upload/route";

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

async function cookieRequest(ownerId: string, url: string, init?: { method?: string; body?: BodyInit; headers?: HeadersInit }) {
  process.env.APP_SESSION_SECRET = "library2-route-test";
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

function bearerRequest(ownerId: string, url: string, init?: { method?: string; body?: BodyInit; headers?: HeadersInit }) {
  process.env.APP_SESSION_SECRET = "library2-route-test";
  const { token } = createLibrary2ExtensionToken(ownerId);
  return new NextRequest(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers
    }
  });
}

test("library2 routes accept a workbench session or a plugin bearer token and stay member-scoped", async (t) => {
  const gateway = new MemoryGateway();
  setContentStorageGatewayForTests(gateway);
  t.after(() => setContentStorageGatewayForTests(undefined));

  const sessionResponse = await CREATE_SESSION(await cookieRequest("member-a", "https://app.test/api/library2/extension-session", {
    method: "POST"
  }));
  assert.equal(sessionResponse.status, 200);
  const sessionPayload = await sessionResponse.json();
  assert.equal(typeof sessionPayload.data.token, "string");

  const intentResponse = await CREATE_INTENT(bearerRequest("member-a", "https://app.test/api/library2/upload-intents", {
    method: "POST",
    body: JSON.stringify({ images: [{ contentType: "image/png", size: 4 }] })
  }));
  assert.equal(intentResponse.status, 200);
  const intent = (await intentResponse.json()).data as {
    contentId: string;
    uploads: Array<{ fileId: string; key: string; uploadUrl: string; contentType: string; size: number }>;
  };
  assert.match(intent.uploads[0]!.key, /\/library2\//);

  const uploadResponse = await UPLOAD(new NextRequest(`https://app.test${intent.uploads[0]!.uploadUrl}`, {
    method: "PUT",
    headers: { "Content-Type": "image/png", "Content-Length": "4" },
    body: new Uint8Array(4)
  }), { params: Promise.resolve({ contentId: intent.contentId, fileId: intent.uploads[0]!.fileId }) });
  assert.equal(uploadResponse.status, 200);

  const commitResponse = await COMMIT(bearerRequest("member-a", `https://app.test/api/library2/items/${intent.contentId}/commit`, {
    method: "POST",
    body: JSON.stringify({
      content: {
        title: "插件上传",
        body: "手动保存的文案",
        platform: "TikTok",
        sourceUrl: "https://www.tiktok.com/@user/photo/1"
      },
      uploads: intent.uploads
    })
  }), { params: Promise.resolve({ contentId: intent.contentId }) });
  assert.equal(commitResponse.status, 200);

  const otherList = await LIST(await cookieRequest("member-b", "https://app.test/api/library2/items"));
  assert.deepEqual((await otherList.json()).data, []);

  const ownList = await LIST(await cookieRequest("member-a", "https://app.test/api/library2/items"));
  assert.equal((await ownList.json()).data.length, 1);

  const ownItem = await GET_ITEM(await cookieRequest("member-a", `https://app.test/api/library2/items/${intent.contentId}`), {
    params: Promise.resolve({ contentId: intent.contentId })
  });
  assert.equal(ownItem.status, 200);
  assert.equal((await ownItem.json()).data.title, "插件上传");

  const otherItem = await GET_ITEM(await cookieRequest("member-b", `https://app.test/api/library2/items/${intent.contentId}`), {
    params: Promise.resolve({ contentId: intent.contentId })
  });
  assert.equal(otherItem.status, 400);

  const media = await MEDIA(await cookieRequest("member-a", `https://app.test/api/library2/items/${intent.contentId}/media/${intent.uploads[0]!.fileId}`), {
    params: Promise.resolve({ contentId: intent.contentId, fileId: intent.uploads[0]!.fileId })
  });
  assert.equal(media.status, 200);

  const deletedImage = await DELETE_IMAGE(await cookieRequest("member-a", `https://app.test/api/library2/items/${intent.contentId}/media/${intent.uploads[0]!.fileId}`), {
    params: Promise.resolve({ contentId: intent.contentId, fileId: intent.uploads[0]!.fileId })
  });
  assert.equal(deletedImage.status, 200);
  assert.equal((await deletedImage.json()).data.images.length, 0);

  const deletedBody = await DELETE_BODY(await cookieRequest("member-a", `https://app.test/api/library2/items/${intent.contentId}/body`), {
    params: Promise.resolve({ contentId: intent.contentId })
  });
  assert.equal((await deletedBody.json()).data.body, "");

  const deleted = await DELETE_ITEM(await cookieRequest("member-a", `https://app.test/api/library2/items/${intent.contentId}`), {
    params: Promise.resolve({ contentId: intent.contentId })
  });
  assert.equal(deleted.status, 200);
});

test("rejects unauthenticated library2 reads with JSON instead of a session cookie", async () => {
  process.env.APP_SESSION_SECRET = "library2-route-test";
  const response = await LIST(new NextRequest("https://app.test/api/library2/items"));
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.match(payload.message, /登录/);
});
