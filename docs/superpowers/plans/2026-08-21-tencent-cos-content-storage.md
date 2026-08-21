# Tencent COS Content Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist final generated text and images in the private Tencent COS bucket `xshcp-1410143389`, isolate data by the authenticated SSO member, and make COS the finished-content library's only persistent data source.

**Architecture:** The server derives every object prefix from the encrypted SSO session, signs short-lived PUT URLs, and commits one validated `manifest.json` only after every selected image exists in COS. The browser uploads image bytes directly to COS; list, edit, delete, and authenticated media-proxy APIs use a small storage service over an injectable S3-compatible gateway.

**Tech Stack:** Next.js 15 App Router, TypeScript, Node test runner through `tsx`, AWS SDK for JavaScript v3 (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`), Tencent COS S3-compatible endpoint, Cloudflare/OpenNext.

---

**Approved design:** `docs/superpowers/specs/2026-08-21-tencent-cos-content-storage-design.md`

**Execution precondition:** Create and work in `.worktrees/tencent-cos-content-storage` on branch `codex/tencent-cos-content-storage` from the latest `main`. Do not stage the unrelated modified file `public/downloads/xhs-browser-extension-0.1.12.zip`.

### Task 1: Define shared contracts, limits, and safe object keys

**Files:**
- Create: `lib/content-storage/contracts.ts`
- Create: `tests/content-storage-contracts.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Create `tests/content-storage-contracts.test.ts`:

~~~ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_IMAGE_MAX_BYTES,
  CONTENT_IMAGE_MAX_COUNT,
  CONTENT_IMAGE_TOTAL_MAX_BYTES,
  createContentId,
  imageObjectKey,
  manifestObjectKey,
  mediaFileId,
  parseImageDescriptors,
  userContentsPrefix
} from "../lib/content-storage/contracts";

test("builds member-isolated keys without accepting path segments", () => {
  const ownerId = "member/../../other";
  const contentId = createContentId(
    new Date("2026-08-21T06:00:00.000Z").getTime(),
    "11111111-2222-4333-8444-555555555555"
  );

  assert.match(contentId, /^20260821T060000000Z-[0-9a-f]{12}$/);
  assert.equal(userContentsPrefix(ownerId).includes("../"), false);
  assert.equal(manifestObjectKey(ownerId, contentId).endsWith("/manifest.json"), true);
  assert.equal(
    imageObjectKey(ownerId, contentId, "001-abcdef123456.webp"),
    `${userContentsPrefix(ownerId)}${contentId}/images/001-abcdef123456.webp`
  );
});

test("validates image count, per-image bytes, total bytes, and MIME types", () => {
  const valid = parseImageDescriptors([
    { contentType: "image/webp", size: 1024 },
    { contentType: "image/png", size: 2048 }
  ]);
  assert.equal(valid.length, 2);
  assert.throws(
    () => parseImageDescriptors(Array.from({ length: CONTENT_IMAGE_MAX_COUNT + 1 }, () => ({ contentType: "image/png", size: 1 }))),
    /最多 20 张/
  );
  assert.throws(
    () => parseImageDescriptors([{ contentType: "image/png", size: CONTENT_IMAGE_MAX_BYTES + 1 }]),
    /单张图片不能超过 20 MB/
  );
  assert.throws(
    () => parseImageDescriptors([
      { contentType: "image/png", size: CONTENT_IMAGE_TOTAL_MAX_BYTES },
      { contentType: "image/png", size: 1 }
    ]),
    /图片总大小不能超过 100 MB/
  );
  assert.throws(
    () => parseImageDescriptors([{ contentType: "image/svg+xml", size: 100 }]),
    /不支持的图片类型/
  );
});

test("uses a stable extension and server-generated media file id", () => {
  assert.equal(mediaFileId(0, "image/jpeg", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"), "001-aaaaaaaaaaaa.jpg");
  assert.equal(mediaFileId(8, "image/avif", "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee"), "009-ffffffffffff.avif");
});
~~~

- [ ] **Step 2: Run the contract test and verify the missing-module failure**

Run:

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-contracts.test.ts
~~~

Expected: FAIL with `Cannot find module '../lib/content-storage/contracts'`.

- [ ] **Step 3: Create the shared contracts and key helpers**

Create `lib/content-storage/contracts.ts` with these public types and functions:

~~~ts
import { randomUUID } from "node:crypto";

export const CONTENT_IMAGE_MAX_COUNT = 20;
export const CONTENT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const CONTENT_IMAGE_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
export const CONTENT_MANIFEST_MAX_BYTES = 1024 * 1024;
export const CONTENT_UPLOAD_INTENT_TTL_MS = 10 * 60 * 1000;

export const CONTENT_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"]
] as const);

export type LibraryStatus = "可发布" | "需复查" | "已归档" | "已淘汰";
export type RiskLevel = "低" | "中" | "高";
export type ImageDescriptor = { contentType: string; size: number };
export type UploadIntentObject = ImageDescriptor & { fileId: string; key: string };

export type ReferenceSourceSnapshot = {
  title: string;
  url: string;
  platform: string;
  media: Array<{
    type: "image" | "video";
    url: string;
    name?: string;
    posterUrl?: string;
  }>;
};

export type StoredMedia =
  | {
      storage: "cos";
      fileId: string;
      key: string;
      contentType: string;
      size: number;
    }
  | {
      storage: "external";
      fileId: string;
      mediaType: "video";
      url: string;
    };

export type StoredContentPage = {
  page: number;
  title: string;
  copy: string;
  prompt: string;
  provider: string;
  sourceImages: string[];
};

export type StoredContentManifest = {
  schemaVersion: 1;
  id: string;
  ownerId: string;
  title: string;
  summary: string;
  body: string;
  platform: string;
  account: string;
  type: string;
  mediaKind: "image" | "video";
  media: StoredMedia[];
  pages: StoredContentPage[];
  referenceSources: ReferenceSourceSnapshot[];
  tags: string[];
  folder: string | null;
  prompts: string[];
  negativePrompts: string[];
  status: LibraryStatus;
  systemState: "active" | "deleting";
  duplicateRate: number;
  duplicateLabel: string;
  lowFlowRisk: RiskLevel;
  checkAdvice: string[];
  reviewNotes: string[];
  createdAt: string;
  updatedAt: string;
};

export type ContentDraft = Omit<
  StoredContentManifest,
  "schemaVersion" | "id" | "ownerId" | "media" | "systemState" | "createdAt" | "updatedAt"
> & {
  externalVideoUrls: string[];
};

export type UploadIntent = {
  contentId: string;
  token: string;
  uploads: Array<UploadIntentObject & { uploadUrl: string }>;
  expiresAt: number;
};

function safeSegment(value: string) {
  if (!value.trim()) throw new Error("成员标识不能为空");
  return encodeURIComponent(value.trim()).replace(/\./g, "%2E");
}

function assertContentId(contentId: string) {
  if (!/^\d{8}T\d{9}Z-[0-9a-f]{12}$/.test(contentId)) {
    throw new Error("成品编号无效");
  }
  return contentId;
}

export function createContentId(now = Date.now(), id = randomUUID()) {
  const stamp = new Date(now).toISOString().replace(/[-:.]/g, "");
  return `${stamp}-${id.replace(/-/g, "").slice(0, 12).toLowerCase()}`;
}

export function userContentsPrefix(ownerId: string) {
  return `users/${safeSegment(ownerId)}/contents/`;
}

export function manifestObjectKey(ownerId: string, contentId: string) {
  return `${userContentsPrefix(ownerId)}${assertContentId(contentId)}/manifest.json`;
}

export function mediaFileId(index: number, contentType: string, id = randomUUID()) {
  const extension = CONTENT_IMAGE_TYPES.get(contentType);
  if (!extension) throw new Error("不支持的图片类型");
  return `${String(index + 1).padStart(3, "0")}-${id.replace(/-/g, "").slice(0, 12).toLowerCase()}.${extension}`;
}

export function imageObjectKey(ownerId: string, contentId: string, fileId: string) {
  assertContentId(contentId);
  if (!/^\d{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif|avif)$/.test(fileId)) {
    throw new Error("媒体编号无效");
  }
  return `${userContentsPrefix(ownerId)}${contentId}/images/${fileId}`;
}

export function parseImageDescriptors(value: unknown): ImageDescriptor[] {
  if (!Array.isArray(value)) throw new Error("图片列表无效");
  if (value.length > CONTENT_IMAGE_MAX_COUNT) throw new Error("每条成品最多 20 张图片");
  const images = value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("图片信息无效");
    const { contentType, size } = item as Record<string, unknown>;
    if (typeof contentType !== "string" || !CONTENT_IMAGE_TYPES.has(contentType)) {
      throw new Error("不支持的图片类型");
    }
    if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
      throw new Error("图片大小无效");
    }
    if (size > CONTENT_IMAGE_MAX_BYTES) throw new Error("单张图片不能超过 20 MB");
    return { contentType, size };
  });
  if (images.reduce((sum, image) => sum + image.size, 0) > CONTENT_IMAGE_TOTAL_MAX_BYTES) {
    throw new Error("图片总大小不能超过 100 MB");
  }
  return images;
}
~~~

- [ ] **Step 4: Run the contract test and type-check the new module**

Run:

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-contracts.test.ts
npm.cmd exec -- tsc --noEmit
~~~

Expected: the contract test passes and TypeScript reports no errors.

- [ ] **Step 5: Commit the shared contracts**

~~~powershell
git add lib/content-storage/contracts.ts tests/content-storage-contracts.test.ts
git commit -m "feat: define COS content storage contracts"
~~~

### Task 2: Sign upload intents and derive the authenticated member

**Files:**
- Create: `lib/content-storage/upload-intent.ts`
- Create: `lib/content-storage/auth.ts`
- Create: `tests/content-storage-upload-intent.test.ts`

- [ ] **Step 1: Write failing tests for tamper, expiry, and cross-member rejection**

Create `tests/content-storage-upload-intent.test.ts`:

~~~ts
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createMainAppSessionCookie } from "../lib/main-app-sso";
import { requireContentStorageOwner } from "../lib/content-storage/auth";
import {
  createUploadIntentToken,
  verifyUploadIntentToken
} from "../lib/content-storage/upload-intent";

const payload = {
  version: 1 as const,
  mode: "create" as const,
  ownerId: "member-a",
  contentId: "20260821T060000000Z-111111111111",
  objects: [{
    fileId: "001-aaaaaaaaaaaa.webp",
    key: "users/member-a/contents/20260821T060000000Z-111111111111/images/001-aaaaaaaaaaaa.webp",
    contentType: "image/webp",
    size: 1024
  }],
  expiresAt: 1_800_000
};

test("verifies only the original member, content, signature, and lifetime", async () => {
  process.env.APP_SESSION_SECRET = "upload-intent-test-secret";
  const token = await createUploadIntentToken(payload);
  assert.deepEqual(
    await verifyUploadIntentToken(token, "member-a", payload.contentId, 1_700_000),
    payload
  );
  await assert.rejects(
    () => verifyUploadIntentToken(token, "member-b", payload.contentId, 1_700_000),
    /上传意图无效/
  );
  await assert.rejects(
    () => verifyUploadIntentToken(`${token}x`, "member-a", payload.contentId, 1_700_000),
    /上传意图无效/
  );
  await assert.rejects(
    () => verifyUploadIntentToken(token, "member-a", payload.contentId, 1_900_000),
    /上传意图已过期/
  );
});

test("reads owner only from the encrypted SSO cookie", async () => {
  process.env.APP_SESSION_SECRET = "upload-intent-test-secret";
  const cookie = await createMainAppSessionCookie({
    token: "main-token",
    user: { id: "member-a", account: "member@example.com", nickname: "成员", role: "member" },
    expiresAt: Date.now() + 60_000
  });
  const request = new NextRequest("https://xhstw.qycm.top/api/content-storage/items?ownerId=member-b", {
    headers: { Cookie: `qycm_xhstw_sso=${cookie}` }
  });

  assert.equal(await requireContentStorageOwner(request), "member-a");
  await assert.rejects(
    () => requireContentStorageOwner(new NextRequest("https://xhstw.qycm.top/api/content-storage/items")),
    /登录状态无效/
  );
});
~~~

- [ ] **Step 2: Run the test and verify it fails on missing modules**

Run:

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-upload-intent.test.ts
~~~

Expected: FAIL because `upload-intent.ts` and `auth.ts` do not exist.

- [ ] **Step 3: Implement the domain-separated HMAC token**

Create `lib/content-storage/upload-intent.ts`. Use Web Crypto so the code runs in Node tests and Cloudflare:

~~~ts
import type { UploadIntentObject } from "./contracts";

export type UploadIntentPayload = {
  version: 1;
  mode: "create" | "edit";
  ownerId: string;
  contentId: string;
  objects: UploadIntentObject[];
  expiresAt: number;
};

function configuredSessionSecret() {
  const value = process.env.APP_SESSION_SECRET?.trim();
  if (!value) throw new Error("APP_SESSION_SECRET is not configured.");
  return value;
}

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function buffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}

function base64UrlEncode(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${base64}${"=".repeat((4 - base64.length % 4) % 4)}`;
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function signingKey() {
  const material = await crypto.subtle.digest(
    "SHA-256",
    bytes(`content-storage-upload-intent:v1:${configuredSessionSecret()}`)
  );
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createUploadIntentToken(payload: UploadIntentPayload) {
  const encoded = base64UrlEncode(bytes(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), buffer(bytes(encoded)));
  return `v1.${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyUploadIntentToken(
  token: string,
  ownerId: string,
  contentId: string,
  now = Date.now()
) {
  const [version, encoded, signatureValue, extra] = token.split(".");
  const signature = base64UrlDecode(signatureValue || "");
  if (version !== "v1" || !encoded || !signature || extra) throw new Error("上传意图无效");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(),
    buffer(signature),
    buffer(bytes(encoded))
  );
  if (!valid) throw new Error("上传意图无效");
  const decoded = base64UrlDecode(encoded);
  if (!decoded) throw new Error("上传意图无效");
  const payload = JSON.parse(new TextDecoder().decode(decoded)) as UploadIntentPayload;
  if (payload.version !== 1 || payload.ownerId !== ownerId || payload.contentId !== contentId) {
    throw new Error("上传意图无效");
  }
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) {
    throw new Error("上传意图已过期");
  }
  return payload;
}
~~~

- [ ] **Step 4: Implement the route-level SSO owner helper**

Create `lib/content-storage/auth.ts`:

~~~ts
import type { NextRequest } from "next/server";
import {
  getMainAppSessionCookieName,
  readMainAppSessionCookie
} from "../main-app-sso";

export async function requireContentStorageOwner(request: NextRequest) {
  const cookie = request.cookies.get(getMainAppSessionCookieName())?.value;
  const session = await readMainAppSessionCookie(cookie);
  if (!session) throw new Error("登录状态无效，请重新登录。");
  return session.user.id;
}
~~~

Do not accept `ownerId` from query parameters, JSON bodies, or dynamic route segments.

- [ ] **Step 5: Run the upload-intent tests and type-check**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-upload-intent.test.ts
npm.cmd exec -- tsc --noEmit
~~~

Expected: both tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit token and auth support**

~~~powershell
git add lib/content-storage/upload-intent.ts lib/content-storage/auth.ts tests/content-storage-upload-intent.test.ts
git commit -m "feat: secure COS upload intents"
~~~

### Task 3: Add the Tencent COS S3 gateway

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/content-storage/gateway.ts`
- Create: `lib/content-storage/cos-gateway.ts`
- Create: `tests/content-storage-cos-gateway.test.ts`

- [ ] **Step 1: Write failing COS configuration tests**

Create `tests/content-storage-cos-gateway.test.ts`:

~~~ts
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readCosConfig } from "../lib/content-storage/cos-gateway";

function restoreEnv(t: TestContext) {
  const keys = [
    "TENCENT_COS_BUCKET",
    "TENCENT_COS_REGION",
    "TENCENT_COS_SECRET_ID",
    "TENCENT_COS_SECRET_KEY"
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("builds the virtual-hosted COS S3 configuration", (t) => {
  restoreEnv(t);
  process.env.TENCENT_COS_BUCKET = "xshcp-1410143389";
  process.env.TENCENT_COS_REGION = "ap-singapore";
  process.env.TENCENT_COS_SECRET_ID = "test-secret-id";
  process.env.TENCENT_COS_SECRET_KEY = "test-secret-key";

  assert.deepEqual(readCosConfig(), {
    bucket: "xshcp-1410143389",
    region: "ap-singapore",
    endpoint: "https://cos.ap-singapore.myqcloud.com",
    accessKeyId: "test-secret-id",
    secretAccessKey: "test-secret-key"
  });
});

test("reports the missing variable without exposing configured secrets", (t) => {
  restoreEnv(t);
  process.env.TENCENT_COS_BUCKET = "xshcp-1410143389";
  process.env.TENCENT_COS_REGION = "ap-singapore";
  process.env.TENCENT_COS_SECRET_ID = "secret-value-that-must-not-leak";
  delete process.env.TENCENT_COS_SECRET_KEY;

  assert.throws(
    () => readCosConfig(),
    (error: unknown) => error instanceof Error
      && /TENCENT_COS_SECRET_KEY/.test(error.message)
      && !/secret-value-that-must-not-leak/.test(error.message)
  );
});
~~~

- [ ] **Step 2: Run the test and verify the missing-module failure**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-cos-gateway.test.ts
~~~

Expected: FAIL because `cos-gateway.ts` does not exist.

- [ ] **Step 3: Install only the two AWS SDK v3 packages required by the design**

~~~powershell
npm.cmd install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
~~~

Expected: `package.json` and `package-lock.json` contain both packages; no full `aws-sdk` v2 package is added.

- [ ] **Step 4: Define the injectable gateway interface**

Create `lib/content-storage/gateway.ts`:

~~~ts
export type ContentObjectHead = {
  contentType: string;
  size: number;
};

export type ContentObjectBody = {
  body: ReadableStream<Uint8Array> | Uint8Array;
  contentType: string;
  size?: number;
};

export type ManifestPage = {
  contentIds: string[];
  cursor?: string;
};

export interface ContentStorageGateway {
  createPutUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  headObject(key: string): Promise<ContentObjectHead | undefined>;
  putJson(key: string, value: unknown): Promise<void>;
  getJson(key: string): Promise<unknown | undefined>;
  listContentIds(prefix: string, cursor: string | undefined, limit: number): Promise<ManifestPage>;
  getObject(key: string): Promise<ContentObjectBody | undefined>;
  deleteObjects(keys: string[]): Promise<void>;
}
~~~

- [ ] **Step 5: Implement the AWS SDK v3 COS gateway**

Create `lib/content-storage/cos-gateway.ts`. The concrete class must use these commands and options:

~~~ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ContentObjectBody,
  ContentStorageGateway,
  ManifestPage
} from "./gateway";

function configured(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function readCosConfig() {
  const region = configured("TENCENT_COS_REGION");
  return {
    bucket: configured("TENCENT_COS_BUCKET"),
    region,
    endpoint: `https://cos.${region}.myqcloud.com`,
    accessKeyId: configured("TENCENT_COS_SECRET_ID"),
    secretAccessKey: configured("TENCENT_COS_SECRET_KEY")
  };
}

function streamBody(body: unknown): ReadableStream<Uint8Array> | Uint8Array {
  if (body instanceof ReadableStream) return body as ReadableStream<Uint8Array>;
  if (body && typeof body === "object" && "transformToWebStream" in body) {
    return (body as { transformToWebStream(): ReadableStream<Uint8Array> }).transformToWebStream();
  }
  throw new Error("COS returned an unreadable object body.");
}

export class CosContentStorageGateway implements ContentStorageGateway {
  private readonly config = readCosConfig();
  private readonly client = new S3Client({
    region: this.config.region,
    endpoint: this.config.endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey
    }
  });

  async createPutUrl(key: string, contentType: string, expiresInSeconds: number) {
    return getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: contentType
    }), { expiresIn: expiresInSeconds });
  }

  async headObject(key: string) {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return {
        contentType: result.ContentType || "application/octet-stream",
        size: Number(result.ContentLength || 0)
      };
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) return undefined;
      throw error;
    }
  }

  async putJson(key: string, value: unknown) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json; charset=utf-8"
    }));
  }

  async getJson(key: string) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return JSON.parse(await result.Body!.transformToString());
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) return undefined;
      throw error;
    }
  }

  async listContentIds(prefix: string, cursor: string | undefined, limit: number): Promise<ManifestPage> {
    const ids: string[] = [];
    let continuationToken: string | undefined;
    do {
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: continuationToken
      }));
      ids.push(...(result.CommonPrefixes || []).flatMap((item) => {
        const value = item.Prefix?.slice(prefix.length).replace(/\/$/, "");
        return value ? [value] : [];
      }));
      continuationToken = result.NextContinuationToken;
    } while (continuationToken);
    ids.sort().reverse();
    const start = cursor ? Math.max(0, ids.indexOf(cursor) + 1) : 0;
    const contentIds = ids.slice(start, start + limit);
    return {
      contentIds,
      cursor: start + limit < ids.length ? contentIds.at(-1) : undefined
    };
  }

  async getObject(key: string): Promise<ContentObjectBody | undefined> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return {
        body: streamBody(result.Body),
        contentType: result.ContentType || "application/octet-stream",
        size: result.ContentLength
      };
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) return undefined;
      throw error;
    }
  }

  async deleteObjects(keys: string[]) {
    for (const key of [...new Set(keys)]) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    }
  }
}

let singleton: ContentStorageGateway | undefined;
let testGateway: ContentStorageGateway | undefined;

export function getContentStorageGateway() {
  return testGateway || (singleton ??= new CosContentStorageGateway());
}

export function setContentStorageGatewayForTests(gateway?: ContentStorageGateway) {
  if (!process.env.NODE_TEST_CONTEXT) throw new Error("Test gateway override is disabled.");
  testGateway = gateway;
}
~~~

If `ReadableStream` detection differs in the bundled Worker runtime, keep the gateway interface unchanged and adjust only `streamBody` after the real probe.

- [ ] **Step 6: Run gateway tests, TypeScript, and the production build size check**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-cos-gateway.test.ts
npm.cmd exec -- tsc --noEmit
npm.cmd run build
~~~

Expected: tests and type-check pass; the Next.js production build accepts the SDK/runtime imports. The existing deployment pipeline remains responsible for the final OpenNext Worker bundle-size check.

- [ ] **Step 7: Commit the gateway**

~~~powershell
git add package.json package-lock.json lib/content-storage/gateway.ts lib/content-storage/cos-gateway.ts tests/content-storage-cos-gateway.test.ts
git commit -m "feat: add Tencent COS storage gateway"
~~~

### Task 4: Implement create, commit, list, and read services

**Files:**
- Create: `lib/content-storage/validation.ts`
- Create: `lib/content-storage/service.ts`
- Create: `tests/helpers/memory-content-storage-gateway.ts`
- Create: `tests/helpers/content-storage-fixtures.ts`
- Create: `tests/content-storage-service.test.ts`

- [ ] **Step 1: Create the in-memory gateway used by service and route tests**

Create `tests/helpers/memory-content-storage-gateway.ts`:

~~~ts
import type {
  ContentObjectBody,
  ContentObjectHead,
  ContentStorageGateway,
  ManifestPage
} from "../../lib/content-storage/gateway";

type Entry = {
  bytes: Uint8Array;
  contentType: string;
  json?: unknown;
};

export class MemoryContentStorageGateway implements ContentStorageGateway {
  readonly objects = new Map<string, Entry>();
  readonly deleted: string[] = [];
  failNextPut = false;
  failNextDelete = false;

  async createPutUrl(key: string, contentType: string) {
    return `https://upload.test/${encodeURIComponent(key)}?content-type=${encodeURIComponent(contentType)}`;
  }

  putBlob(key: string, contentType: string, size: number) {
    this.objects.set(key, { bytes: new Uint8Array(size), contentType });
  }

  async headObject(key: string): Promise<ContentObjectHead | undefined> {
    const value = this.objects.get(key);
    return value ? { contentType: value.contentType, size: value.bytes.byteLength } : undefined;
  }

  async putJson(key: string, value: unknown) {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("forced put failure");
    }
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    this.objects.set(key, { bytes, contentType: "application/json; charset=utf-8", json: structuredClone(value) });
  }

  async getJson(key: string) {
    return structuredClone(this.objects.get(key)?.json);
  }

  async listContentIds(prefix: string, cursor: string | undefined, limit: number): Promise<ManifestPage> {
    const ids = [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix) && key.endsWith("/manifest.json"))
      .map((key) => key.slice(prefix.length, -"/manifest.json".length))
      .sort()
      .reverse();
    const start = cursor ? Math.max(0, ids.indexOf(cursor) + 1) : 0;
    const contentIds = ids.slice(start, start + limit);
    return {
      contentIds,
      cursor: start + limit < ids.length ? contentIds.at(-1) : undefined
    };
  }

  async getObject(key: string): Promise<ContentObjectBody | undefined> {
    const value = this.objects.get(key);
    return value ? { body: value.bytes.slice(), contentType: value.contentType, size: value.bytes.byteLength } : undefined;
  }

  async deleteObjects(keys: string[]) {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("forced delete failure");
    }
    for (const key of [...new Set(keys)]) {
      this.deleted.push(key);
      this.objects.delete(key);
    }
  }
}
~~~

- [ ] **Step 2: Write failing service tests for item-level commit visibility and isolation**

Create `tests/helpers/content-storage-fixtures.ts` so service, route, and browser-client tests share data without importing another test module:

~~~ts
import type { ContentDraft } from "../../lib/content-storage/contracts";

export const contentDraftFixture: ContentDraft = {
  title: "COS 成品",
  summary: "摘要",
  body: "最终正文",
  platform: "小红书",
  account: "测试账号",
  type: "小红书长图文",
  mediaKind: "image",
  pages: [],
  referenceSources: [],
  tags: ["COS"],
  folder: null,
  prompts: ["提示词"],
  negativePrompts: [],
  status: "需复查",
  duplicateRate: 0,
  duplicateLabel: "待检测",
  lowFlowRisk: "低",
  checkAdvice: [],
  reviewNotes: [],
  externalVideoUrls: []
};
~~~

Create `tests/content-storage-service.test.ts` with the first three tests:

~~~ts
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  abortUploadIntent,
  commitContent,
  createContentUploadIntent,
  getContent,
  listContents
} from "../lib/content-storage/service";
import { manifestObjectKey } from "../lib/content-storage/contracts";
import { contentDraftFixture } from "./helpers/content-storage-fixtures";
import { MemoryContentStorageGateway } from "./helpers/memory-content-storage-gateway";

function useSecret(t: TestContext) {
  const previous = process.env.APP_SESSION_SECRET;
  process.env.APP_SESSION_SECRET = "content-storage-service-test";
  t.after(() => {
    if (previous === undefined) delete process.env.APP_SESSION_SECRET;
    else process.env.APP_SESSION_SECRET = previous;
  });
}

test("does not list a content item until every image exists and the manifest commits", async (t) => {
  useSecret(t);
  const gateway = new MemoryContentStorageGateway();
  const intent = await createContentUploadIntent("member-a", [{ contentType: "image/webp", size: 4 }], gateway, {
    now: 1_800_000_000_000,
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });

  assert.deepEqual((await listContents("member-a", gateway)).items, []);
  await assert.rejects(
    () => commitContent("member-a", intent.contentId, intent.token, contentDraftFixture, gateway, 1_800_000_000_100),
    /第 1 张图片尚未上传/
  );
  assert.equal(gateway.objects.has(manifestObjectKey("member-a", intent.contentId)), false);

  gateway.putBlob(intent.uploads[0].key, "image/webp", 4);
  const committed = await commitContent("member-a", intent.contentId, intent.token, contentDraftFixture, gateway, 1_800_000_000_200);

  assert.equal(committed.ownerId, "member-a");
  assert.equal(committed.media[0].storage, "cos");
  assert.deepEqual((await listContents("member-a", gateway)).items.map((item) => item.id), [intent.contentId]);
  assert.deepEqual((await listContents("member-b", gateway)).items, []);
  assert.equal(await getContent("member-b", intent.contentId, gateway), undefined);
});

test("cleans uploaded objects when a commit fails before writing the manifest", async (t) => {
  useSecret(t);
  const gateway = new MemoryContentStorageGateway();
  const intent = await createContentUploadIntent("member-a", [{ contentType: "image/png", size: 3 }], gateway, {
    now: 1_800_000_000_000,
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  gateway.putBlob(intent.uploads[0].key, "image/png", 3);
  gateway.failNextPut = true;

  await assert.rejects(
    () => commitContent("member-a", intent.contentId, intent.token, contentDraftFixture, gateway, 1_800_000_000_100),
    /云端成品清单保存失败/
  );
  assert.equal(gateway.objects.has(intent.uploads[0].key), false);
});

test("aborts a failed browser upload using only the signed intent keys", async (t) => {
  useSecret(t);
  const gateway = new MemoryContentStorageGateway();
  const intent = await createContentUploadIntent("member-a", [{ contentType: "image/jpeg", size: 2 }], gateway, {
    now: 1_800_000_000_000,
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  gateway.putBlob(intent.uploads[0].key, "image/jpeg", 2);

  await abortUploadIntent("member-a", intent.contentId, intent.token, gateway, 1_800_000_000_100);
  assert.equal(gateway.objects.has(intent.uploads[0].key), false);
  await assert.rejects(
    () => abortUploadIntent("member-b", intent.contentId, intent.token, gateway, 1_800_000_000_100),
    /上传意图无效/
  );
});

test("does not delete objects already referenced by a committed manifest", async (t) => {
  useSecret(t);
  const gateway = new MemoryContentStorageGateway();
  const intent = await createContentUploadIntent("member-a", [{ contentType: "image/png", size: 2 }], gateway, {
    now: 1_800_000_000_000,
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  gateway.putBlob(intent.uploads[0].key, "image/png", 2);
  await commitContent("member-a", intent.contentId, intent.token, contentDraftFixture, gateway, 1_800_000_000_100);

  await abortUploadIntent("member-a", intent.contentId, intent.token, gateway, 1_800_000_000_200);
  assert.equal(gateway.objects.has(intent.uploads[0].key), true);
});
~~~

- [ ] **Step 3: Run the service test and verify missing exports**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-service.test.ts
~~~

Expected: FAIL because `lib/content-storage/service.ts` does not exist.

- [ ] **Step 4: Implement untrusted draft and manifest validation**

Create `lib/content-storage/validation.ts`. Export `parseContentDraft(value)` and `parseStoredManifest(value, ownerId)`. Use small typed helpers rather than a new schema dependency:

~~~ts
import {
  CONTENT_IMAGE_TYPES,
  CONTENT_MANIFEST_MAX_BYTES,
  imageObjectKey,
  type ContentDraft,
  type LibraryStatus,
  type ReferenceSourceSnapshot,
  type RiskLevel,
  type StoredContentManifest,
  type StoredContentPage,
  type StoredMedia
} from "./contracts";

const STATUSES = new Set<LibraryStatus>(["可发布", "需复查", "已归档", "已淘汰"]);
const RISKS = new Set<RiskLevel>(["低", "中", "高"]);

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max = 20_000) {
  if (typeof value !== "string" || value.length > max) throw new Error(`${field}无效`);
  return value;
}

function texts(value: unknown, field: string, maxItems = 100) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field}无效`);
  return value.map((item) => text(item, field, 5_000));
}

function stableUrl(value: unknown, field: string) {
  const url = new URL(text(value, field, 4_096));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${field}无效`);
  return url.toString();
}

function contentPage(value: unknown): StoredContentPage {
  const item = record(value, "页面信息无效");
  if (typeof item.page !== "number" || !Number.isInteger(item.page) || item.page < 1) {
    throw new Error("页码无效");
  }
  return {
    page: item.page,
    title: text(item.title, "页面标题", 500),
    copy: text(item.copy, "页面文案", 10_000),
    prompt: text(item.prompt, "页面提示词", 10_000),
    provider: text(item.provider, "图片提供方", 200),
    sourceImages: texts(item.sourceImages, "参考图片", 20).map((url) => stableUrl(url, "参考图片"))
  };
}

function referenceSource(value: unknown): ReferenceSourceSnapshot {
  const item = record(value, "参考来源无效");
  if (!Array.isArray(item.media) || item.media.length > 100) throw new Error("参考媒体无效");
  return {
    title: text(item.title, "参考标题", 500),
    url: stableUrl(item.url, "参考地址"),
    platform: text(item.platform, "参考平台", 100),
    media: item.media.map((value) => {
      const media = record(value, "参考媒体无效");
      if (media.type !== "image" && media.type !== "video") throw new Error("参考媒体类型无效");
      return {
        type: media.type,
        url: stableUrl(media.url, "参考媒体地址"),
        ...(media.name === undefined ? {} : { name: text(media.name, "参考媒体名称", 500) }),
        ...(media.posterUrl === undefined ? {} : { posterUrl: stableUrl(media.posterUrl, "参考封面地址") })
      };
    })
  };
}

function timestamp(value: unknown, field: string) {
  const result = text(value, field, 100);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${field}无效`);
  return result;
}

export function parseContentDraft(value: unknown): ContentDraft {
  const item = record(value, "成品内容无效");
  const status = text(item.status, "状态") as LibraryStatus;
  const lowFlowRisk = text(item.lowFlowRisk, "低流量风险") as RiskLevel;
  if (!STATUSES.has(status) || !RISKS.has(lowFlowRisk)) throw new Error("成品状态无效");
  const mediaKind = item.mediaKind;
  if (mediaKind !== "image" && mediaKind !== "video") throw new Error("媒体类型无效");
  const externalVideoUrls = Array.isArray(item.externalVideoUrls)
    ? item.externalVideoUrls.map((url) => stableUrl(url, "视频地址"))
    : [];

  const draft = {
    title: text(item.title, "标题", 500),
    summary: text(item.summary, "摘要", 1_000),
    body: text(item.body, "正文", 50_000),
    platform: text(item.platform, "平台", 100),
    account: text(item.account, "账号", 200),
    type: text(item.type, "内容类型", 200),
    mediaKind,
    pages: Array.isArray(item.pages) ? item.pages.map(contentPage) : [],
    referenceSources: Array.isArray(item.referenceSources) ? item.referenceSources.map(referenceSource) : [],
    tags: texts(item.tags, "标签", 50),
    folder: item.folder === null ? null : text(item.folder, "文件夹", 200),
    prompts: texts(item.prompts, "提示词", 100),
    negativePrompts: texts(item.negativePrompts, "反向提示词", 100),
    status,
    duplicateRate: typeof item.duplicateRate === "number" && Number.isFinite(item.duplicateRate)
      && item.duplicateRate >= 0 && item.duplicateRate <= 100 ? item.duplicateRate : 0,
    duplicateLabel: text(item.duplicateLabel, "查重标签", 200),
    lowFlowRisk,
    checkAdvice: texts(item.checkAdvice, "检测建议", 100),
    reviewNotes: texts(item.reviewNotes, "审核记录", 100),
    externalVideoUrls
  } satisfies ContentDraft;
  if (new TextEncoder().encode(JSON.stringify(draft)).byteLength > CONTENT_MANIFEST_MAX_BYTES) {
    throw new Error("成品清单不能超过 1 MB");
  }
  return draft;
}

export function parseStoredManifest(value: unknown, ownerId: string): StoredContentManifest {
  const item = record(value, "云端成品清单损坏");
  if (new TextEncoder().encode(JSON.stringify(item)).byteLength > CONTENT_MANIFEST_MAX_BYTES) {
    throw new Error("云端成品清单损坏");
  }
  if (item.schemaVersion !== 1 || item.ownerId !== ownerId) {
    throw new Error("云端成品清单损坏");
  }
  const contentId = text(item.id, "成品编号", 100);
  if (!Array.isArray(item.media) || item.media.length > 40) throw new Error("云端媒体清单损坏");
  const media: StoredMedia[] = item.media.map((value) => {
    const row = record(value, "云端媒体清单损坏");
    const fileId = text(row.fileId, "媒体编号", 100);
    if (row.storage === "cos") {
      const contentType = text(row.contentType, "媒体类型", 100);
      const size = row.size;
      const key = text(row.key, "媒体对象键", 1_000);
      if (!CONTENT_IMAGE_TYPES.has(contentType) || typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
        throw new Error("云端媒体清单损坏");
      }
      if (key !== imageObjectKey(ownerId, contentId, fileId)) throw new Error("云端媒体清单损坏");
      return { storage: "cos", fileId, key, contentType, size };
    }
    if (row.storage === "external" && row.mediaType === "video") {
      return { storage: "external", fileId, mediaType: "video", url: stableUrl(row.url, "视频地址") };
    }
    throw new Error("云端媒体清单损坏");
  });
  const draft = parseContentDraft({
    ...item,
    externalVideoUrls: media.flatMap((row) => row.storage === "external" ? [row.url] : [])
  });
  const content = (({ externalVideoUrls: _externalVideoUrls, ...rest }) => rest)(draft);
  const systemState = item.systemState;
  if (systemState !== "active" && systemState !== "deleting") throw new Error("云端成品状态损坏");
  return {
    schemaVersion: 1,
    id: contentId,
    ownerId,
    ...content,
    media,
    systemState,
    createdAt: timestamp(item.createdAt, "创建时间"),
    updatedAt: timestamp(item.updatedAt, "更新时间")
  };
}
~~~

- [ ] **Step 5: Implement create, abort, commit, list, and get services**

Create `lib/content-storage/service.ts` with the following public boundary:

~~~ts
import { randomUUID } from "node:crypto";
import {
  CONTENT_UPLOAD_INTENT_TTL_MS,
  createContentId,
  imageObjectKey,
  manifestObjectKey,
  mediaFileId,
  parseImageDescriptors,
  userContentsPrefix,
  type ContentDraft,
  type ImageDescriptor,
  type StoredContentManifest,
  type StoredMedia
} from "./contracts";
import type { ContentStorageGateway } from "./gateway";
import { createUploadIntentToken, verifyUploadIntentToken } from "./upload-intent";
import { parseContentDraft, parseStoredManifest } from "./validation";

type IntentOptions = { now?: number; ids?: string[] };

export class ContentStorageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function validatedImages(rawImages: unknown): ImageDescriptor[] {
  try {
    return parseImageDescriptors(rawImages);
  } catch (error) {
    throw new ContentStorageError(error instanceof Error ? error.message : "图片列表无效。", 400);
  }
}

export async function createContentUploadIntent(
  ownerId: string,
  rawImages: unknown,
  gateway: ContentStorageGateway,
  options: IntentOptions = {}
) {
  const now = options.now ?? Date.now();
  const ids = [...(options.ids || [])];
  const images = validatedImages(rawImages);
  const contentId = createContentId(now, ids.shift() || randomUUID());
  const objects = images.map((image, index) => {
    const fileId = mediaFileId(index, image.contentType, ids.shift() || randomUUID());
    return { ...image, fileId, key: imageObjectKey(ownerId, contentId, fileId) };
  });
  const expiresAt = now + CONTENT_UPLOAD_INTENT_TTL_MS;
  const token = await createUploadIntentToken({
    version: 1,
    mode: "create",
    ownerId,
    contentId,
    objects,
    expiresAt
  });
  const uploads = await Promise.all(objects.map(async (object) => ({
    ...object,
    uploadUrl: await gateway.createPutUrl(object.key, object.contentType, CONTENT_UPLOAD_INTENT_TTL_MS / 1000)
  })));
  return { contentId, token, uploads, expiresAt };
}

export async function abortUploadIntent(
  ownerId: string,
  contentId: string,
  token: string,
  gateway: ContentStorageGateway,
  now = Date.now()
) {
  const intent = await verifyUploadIntentToken(token, ownerId, contentId, now);
  const current = await getContent(ownerId, contentId, gateway);
  const referencedKeys = new Set(current?.media.flatMap((media) => media.storage === "cos" ? [media.key] : []) ?? []);
  await gateway.deleteObjects(intent.objects.flatMap((object) => referencedKeys.has(object.key) ? [] : [object.key]));
}

async function verifyUploadedObjects(
  objects: Awaited<ReturnType<typeof verifyUploadIntentToken>>["objects"],
  gateway: ContentStorageGateway
) {
  const media: StoredMedia[] = [];
  for (const [index, object] of objects.entries()) {
    const head = await gateway.headObject(object.key);
    if (!head) throw new ContentStorageError(`第 ${index + 1} 张图片尚未上传。`, 409);
    if (head.contentType !== object.contentType || head.size !== object.size) {
      throw new ContentStorageError(`第 ${index + 1} 张图片信息与上传意图不一致。`, 409);
    }
    media.push({ storage: "cos", ...object });
  }
  return media;
}

export async function commitContent(
  ownerId: string,
  contentId: string,
  token: string,
  rawDraft: unknown,
  gateway: ContentStorageGateway,
  now = Date.now()
) {
  const intent = await verifyUploadIntentToken(token, ownerId, contentId, now);
  if (intent.mode !== "create") throw new ContentStorageError("上传意图无效。", 400);
  let draft: ContentDraft;
  try {
    draft = parseContentDraft(rawDraft);
  } catch (error) {
    await gateway.deleteObjects(intent.objects.map((object) => object.key)).catch(() => undefined);
    throw new ContentStorageError(error instanceof Error ? error.message : "成品内容无效。", 400);
  }
  try {
    const cosMedia = await verifyUploadedObjects(intent.objects, gateway);
    const externalMedia: StoredMedia[] = draft.externalVideoUrls.map((url, index) => ({
      storage: "external",
      fileId: `video-${String(index + 1).padStart(3, "0")}`,
      mediaType: "video",
      url
    }));
    const content = (({ externalVideoUrls: _externalVideoUrls, ...rest }) => rest)(draft);
    const timestamp = new Date(now).toISOString();
    const manifest: StoredContentManifest = {
      schemaVersion: 1,
      id: contentId,
      ownerId,
      ...content,
      media: [...cosMedia, ...externalMedia],
      systemState: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await gateway.putJson(manifestObjectKey(ownerId, contentId), manifest);
    return manifest;
  } catch (error) {
    await gateway.deleteObjects(intent.objects.map((object) => object.key)).catch(() => undefined);
    if (error instanceof ContentStorageError) throw error;
    throw new ContentStorageError("云端成品清单保存失败，请重试。", 502);
  }
}

export async function getContent(ownerId: string, contentId: string, gateway: ContentStorageGateway) {
  const value = await gateway.getJson(manifestObjectKey(ownerId, contentId));
  return value === undefined ? undefined : parseStoredManifest(value, ownerId);
}

export async function listContents(
  ownerId: string,
  gateway: ContentStorageGateway,
  cursor?: string,
  limit = 50
) {
  const page = await gateway.listContentIds(userContentsPrefix(ownerId), cursor, Math.min(Math.max(limit, 1), 100));
  const rows = await Promise.all(page.contentIds.map((contentId) => getContent(ownerId, contentId, gateway)));
  return {
    items: rows.filter((item): item is StoredContentManifest => Boolean(item && item.systemState === "active")),
    cursor: page.cursor
  };
}
~~~

- [ ] **Step 6: Run service tests and all content-storage tests**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-contracts.test.ts tests/content-storage-upload-intent.test.ts tests/content-storage-cos-gateway.test.ts tests/content-storage-service.test.ts
npm.cmd exec -- tsc --noEmit
~~~

Expected: all content-storage tests pass; TypeScript reports no errors.

- [ ] **Step 7: Commit create/read services**

~~~powershell
git add lib/content-storage/validation.ts lib/content-storage/service.ts tests/helpers/content-storage-fixtures.ts tests/helpers/memory-content-storage-gateway.ts tests/content-storage-service.test.ts
git commit -m "feat: commit member-scoped COS content"
~~~

### Task 5: Implement edit, media read, and idempotent delete

**Files:**
- Modify: `lib/content-storage/service.ts`
- Modify: `tests/content-storage-service.test.ts`

- [ ] **Step 1: Append failing edit, media, and delete tests**

Append tests that use the existing `contentDraftFixture` import and `MemoryContentStorageGateway`:

~~~ts
import {
  createEditUploadIntent,
  deleteContent,
  getContentMedia,
  updateContent
} from "../lib/content-storage/service";

test("updates metadata and image order before deleting removed image objects", async (t) => {
  useSecret(t);
  const gateway = new MemoryContentStorageGateway();
  const createIntent = await createContentUploadIntent("member-a", [
    { contentType: "image/webp", size: 2 },
    { contentType: "image/webp", size: 3 }
  ], gateway, {
    now: 1_800_000_000_000,
    ids: [
      "11111111-2222-4333-8444-555555555555",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    ]
  });
  for (const upload of createIntent.uploads) gateway.putBlob(upload.key, upload.contentType, upload.size);
  const original = await commitContent("member-a", createIntent.contentId, createIntent.token, contentDraftFixture, gateway, 1_800_000_000_100);

  const editIntent = await createEditUploadIntent("member-a", original.id, [{ contentType: "image/png", size: 4 }], gateway, {
    now: 1_800_000_001_000,
    ids: ["99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  gateway.putBlob(editIntent.uploads[0].key, "image/png", 4);
  const updated = await updateContent("member-a", original.id, {
    content: { ...contentDraftFixture, title: "更新后的标题" },
    existingFileIds: [original.media[1].fileId],
    newUploadToken: editIntent.token,
    mediaOrder: [editIntent.uploads[0].fileId, original.media[1].fileId]
  }, gateway, 1_800_000_001_100);

  assert.equal(updated.title, "更新后的标题");
  assert.deepEqual(updated.media.map((media) => media.fileId), [
    editIntent.uploads[0].fileId,
    original.media[1].fileId
  ]);
  assert.equal(gateway.objects.has(original.media[0].storage === "cos" ? original.media[0].key : ""), false);
});

test("returns only a manifest-referenced COS image", async (t) => {
  useSecret(t);
  const gateway = new MemoryContentStorageGateway();
  const intent = await createContentUploadIntent("member-a", [{ contentType: "image/avif", size: 2 }], gateway, {
    now: 1_800_000_000_000,
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  gateway.putBlob(intent.uploads[0].key, "image/avif", 2);
  await commitContent("member-a", intent.contentId, intent.token, contentDraftFixture, gateway, 1_800_000_000_100);

  assert.equal((await getContentMedia("member-a", intent.contentId, intent.uploads[0].fileId, gateway))?.contentType, "image/avif");
  assert.equal(await getContentMedia("member-b", intent.contentId, intent.uploads[0].fileId, gateway), undefined);
  assert.equal(await getContentMedia("member-a", intent.contentId, "../manifest.json", gateway), undefined);
});

test("hides a deleting manifest and retries deletion idempotently", async (t) => {
  useSecret(t);
  const gateway = new MemoryContentStorageGateway();
  const intent = await createContentUploadIntent("member-a", [{ contentType: "image/png", size: 2 }], gateway, {
    now: 1_800_000_000_000,
    ids: ["11111111-2222-4333-8444-555555555555", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]
  });
  gateway.putBlob(intent.uploads[0].key, "image/png", 2);
  await commitContent("member-a", intent.contentId, intent.token, contentDraftFixture, gateway, 1_800_000_000_100);
  gateway.failNextDelete = true;

  await assert.rejects(() => deleteContent("member-a", intent.contentId, gateway), /删除未完成/);
  assert.deepEqual((await listContents("member-a", gateway)).items, []);
  await deleteContent("member-a", intent.contentId, gateway);
  await deleteContent("member-a", intent.contentId, gateway);
  assert.equal(await getContent("member-a", intent.contentId, gateway), undefined);
});

test("rejects an edit that would exceed final image limits and cleans the new object", async (t) => {
  useSecret(t);
  const gateway = new MemoryContentStorageGateway();
  const intent = await createContentUploadIntent(
    "member-a",
    Array.from({ length: 20 }, () => ({ contentType: "image/png", size: 1 })),
    gateway,
    { now: 1_800_000_000_000 }
  );
  intent.uploads.forEach((upload) => gateway.putBlob(upload.key, upload.contentType, upload.size));
  const original = await commitContent("member-a", intent.contentId, intent.token, contentDraftFixture, gateway, 1_800_000_000_100);
  const editIntent = await createEditUploadIntent("member-a", original.id, [{ contentType: "image/png", size: 1 }], gateway, {
    now: 1_800_000_001_000
  });
  gateway.putBlob(editIntent.uploads[0].key, "image/png", 1);

  await assert.rejects(() => updateContent("member-a", original.id, {
    content: contentDraftFixture,
    existingFileIds: original.media.map((media) => media.fileId),
    newUploadToken: editIntent.token,
    mediaOrder: [...original.media.map((media) => media.fileId), editIntent.uploads[0].fileId]
  }, gateway), /最多 20 张/);
  assert.equal(gateway.objects.has(editIntent.uploads[0].key), false);
});

test("keeps the committed edit visible when stale-image cleanup fails", async (t) => {
  useSecret(t);
  const gateway = new MemoryContentStorageGateway();
  const createIntent = await createContentUploadIntent("member-a", [{ contentType: "image/webp", size: 2 }], gateway, {
    now: 1_800_000_000_000
  });
  gateway.putBlob(createIntent.uploads[0].key, "image/webp", 2);
  const original = await commitContent("member-a", createIntent.contentId, createIntent.token, contentDraftFixture, gateway, 1_800_000_000_100);
  const editIntent = await createEditUploadIntent("member-a", original.id, [{ contentType: "image/png", size: 3 }], gateway, {
    now: 1_800_000_001_000
  });
  gateway.putBlob(editIntent.uploads[0].key, "image/png", 3);
  gateway.failNextDelete = true;

  const updated = await updateContent("member-a", original.id, {
    content: { ...contentDraftFixture, title: "已提交的新版本" },
    existingFileIds: [],
    newUploadToken: editIntent.token,
    mediaOrder: [editIntent.uploads[0].fileId]
  }, gateway, 1_800_000_001_100);
  assert.equal(updated.title, "已提交的新版本");
  assert.equal((await getContent("member-a", original.id, gateway))?.title, "已提交的新版本");
  assert.equal(gateway.objects.has(createIntent.uploads[0].key), true);
});
~~~

- [ ] **Step 2: Run the service test and verify the new exports are missing**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-service.test.ts
~~~

Expected: FAIL because edit, media, and delete functions are not exported.

- [ ] **Step 3: Implement edit upload intents**

Add `createEditUploadIntent` to `service.ts`. It must first load the current member's active manifest, generate new image keys under the existing `contentId`, sign a payload with `mode: "edit"`, and return the same `uploads/token/expiresAt` shape as create:

~~~ts
export async function createEditUploadIntent(
  ownerId: string,
  contentId: string,
  rawImages: unknown,
  gateway: ContentStorageGateway,
  options: IntentOptions = {}
) {
  const current = await getContent(ownerId, contentId, gateway);
  if (!current || current.systemState !== "active") throw new ContentStorageError("成品不存在。", 404);
  const now = options.now ?? Date.now();
  const ids = [...(options.ids || [])];
  const images = validatedImages(rawImages);
  const existingCount = current.media.filter((media) => media.storage === "cos").length;
  const objects = images.map((image, index) => {
    const fileId = mediaFileId(existingCount + index, image.contentType, ids.shift() || randomUUID());
    return { ...image, fileId, key: imageObjectKey(ownerId, contentId, fileId) };
  });
  const expiresAt = now + CONTENT_UPLOAD_INTENT_TTL_MS;
  const token = await createUploadIntentToken({
    version: 1,
    mode: "edit",
    ownerId,
    contentId,
    objects,
    expiresAt
  });
  return {
    contentId,
    token,
    uploads: await Promise.all(objects.map(async (object) => ({
      ...object,
      uploadUrl: await gateway.createPutUrl(object.key, object.contentType, CONTENT_UPLOAD_INTENT_TTL_MS / 1000)
    }))),
    expiresAt
  };
}
~~~

- [ ] **Step 4: Implement update ordering and cleanup**

Add a `ContentUpdateInput` type and `updateContent`. The function must:

1. Load the current active manifest.
2. Parse the new `content` with `parseContentDraft`.
3. Verify every `existingFileId` is unique and belongs to the current manifest's COS media (external video IDs are not accepted in image ordering).
4. If `newUploadToken` exists, verify `mode === "edit"` and HEAD every new object.
5. Enforce the 20-image/100-MB limits against retained plus new COS media, not merely the new intent.
6. Require `mediaOrder` to contain each retained/new file ID exactly once.
7. Write the new active manifest before deleting removed old keys. Treat stale-key deletion as best-effort after commit: a cleanup failure may leave a private orphan but must not turn a successful edit into an error.
8. After an edit token is verified, any validation, HEAD, ordering, or manifest-write failure deletes only newly uploaded keys and retains the old manifest.

Use this reconstruction for the final media order:

~~~ts
const available = new Map<string, StoredMedia>([
  ...current.media
    .filter((media): media is Extract<StoredMedia, { storage: "cos" }> => media.storage === "cos")
    .filter((media) => input.existingFileIds.includes(media.fileId))
    .map((media) => [media.fileId, media] as const),
  ...newMedia.map((media) => [media.fileId, media] as const)
]);
const orderedCosMedia = input.mediaOrder.map((fileId) => {
  const media = available.get(fileId);
  if (!media) throw new ContentStorageError("图片顺序包含无效对象。", 400);
  return media;
});
if (new Set(input.mediaOrder).size !== available.size || input.mediaOrder.length !== available.size) {
  throw new ContentStorageError("图片顺序不完整。", 400);
}
~~~

Append validated external video references after `orderedCosMedia`. Update `updatedAt`, preserve `createdAt`, `id`, and `ownerId`.

- [ ] **Step 5: Implement media reads and deleting-state retries**

Add:

~~~ts
export async function getContentMedia(
  ownerId: string,
  contentId: string,
  fileId: string,
  gateway: ContentStorageGateway
) {
  if (!/^\d{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif|avif)$/.test(fileId)) return undefined;
  const manifest = await getContent(ownerId, contentId, gateway);
  if (!manifest || manifest.systemState !== "active") return undefined;
  const media = manifest.media.find((item) => item.storage === "cos" && item.fileId === fileId);
  return media?.storage === "cos" ? gateway.getObject(media.key) : undefined;
}

export async function deleteContent(
  ownerId: string,
  contentId: string,
  gateway: ContentStorageGateway
) {
  const current = await getContent(ownerId, contentId, gateway);
  if (!current) return;
  const deleting = { ...current, systemState: "deleting" as const, updatedAt: new Date().toISOString() };
  await gateway.putJson(manifestObjectKey(ownerId, contentId), deleting);
  try {
    await gateway.deleteObjects(current.media.flatMap((media) => media.storage === "cos" ? [media.key] : []));
    await gateway.deleteObjects([manifestObjectKey(ownerId, contentId)]);
  } catch {
    throw new ContentStorageError("云端成品删除未完成，请重试。", 502);
  }
}
~~~

- [ ] **Step 6: Run service tests and type-check**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-service.test.ts
npm.cmd exec -- tsc --noEmit
~~~

Expected: edit, media isolation, and idempotent delete tests pass.

- [ ] **Step 7: Commit edit and delete behavior**

~~~powershell
git add lib/content-storage/service.ts tests/content-storage-service.test.ts
git commit -m "feat: edit and delete COS content"
~~~

### Task 6: Expose authenticated App Router APIs

**Files:**
- Create: `lib/content-storage/route-helpers.ts`
- Create: `app/api/content-storage/upload-intents/route.ts`
- Create: `app/api/content-storage/items/route.ts`
- Create: `app/api/content-storage/items/[contentId]/route.ts`
- Create: `app/api/content-storage/items/[contentId]/commit/route.ts`
- Create: `app/api/content-storage/items/[contentId]/upload-intents/route.ts`
- Create: `app/api/content-storage/items/[contentId]/media/[fileId]/route.ts`
- Create: `tests/content-storage-routes.test.ts`

- [ ] **Step 1: Write the end-to-end route test with a real encrypted session cookie**

Create `tests/content-storage-routes.test.ts`. Import route handlers with aliases, install `MemoryContentStorageGateway` through `setContentStorageGatewayForTests`, and cover create, commit, list, media, cross-member denial, and abort:

~~~ts
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { createMainAppSessionCookie } from "../lib/main-app-sso";
import { setContentStorageGatewayForTests } from "../lib/content-storage/cos-gateway";
import { POST as CREATE_INTENT, DELETE as ABORT_INTENT } from "../app/api/content-storage/upload-intents/route";
import { POST as COMMIT } from "../app/api/content-storage/items/[contentId]/commit/route";
import { GET as LIST } from "../app/api/content-storage/items/route";
import { GET as GET_MEDIA } from "../app/api/content-storage/items/[contentId]/media/[fileId]/route";
import { MemoryContentStorageGateway } from "./helpers/memory-content-storage-gateway";
import { contentDraftFixture } from "./helpers/content-storage-fixtures";

async function requestFor(ownerId: string, url: string, init?: RequestInit) {
  process.env.APP_SESSION_SECRET = "route-test-session";
  const cookie = await createMainAppSessionCookie({
    token: `token-${ownerId}`,
    user: { id: ownerId, account: `${ownerId}@example.com`, nickname: ownerId, role: "member" },
    expiresAt: Date.now() + 60_000
  });
  return new NextRequest(url, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: `qycm_xhstw_sso=${cookie}`, ...init?.headers }
  });
}

test("creates, commits, lists, and proxies only the signed-in member content", async (t: TestContext) => {
  const gateway = new MemoryContentStorageGateway();
  setContentStorageGatewayForTests(gateway);
  t.after(() => setContentStorageGatewayForTests(undefined));

  const intentResponse = await CREATE_INTENT(await requestFor("member-a", "https://app.test/api/content-storage/upload-intents", {
    method: "POST",
    body: JSON.stringify({ images: [{ contentType: "image/png", size: 4 }] })
  }));
  const intentPayload = await intentResponse.json();
  const upload = intentPayload.data.uploads[0];
  gateway.putBlob(upload.key, upload.contentType, upload.size);

  const commitResponse = await COMMIT(await requestFor("member-a", `https://app.test/api/content-storage/items/${intentPayload.data.contentId}/commit`, {
    method: "POST",
    body: JSON.stringify({ token: intentPayload.data.token, content: contentDraftFixture })
  }), { params: Promise.resolve({ contentId: intentPayload.data.contentId }) });
  assert.equal(commitResponse.status, 200);

  const listPayload = await (await LIST(await requestFor("member-a", "https://app.test/api/content-storage/items"))).json();
  assert.deepEqual(listPayload.data.items.map((item: { id: string }) => item.id), [intentPayload.data.contentId]);
  const otherList = await (await LIST(await requestFor("member-b", "https://app.test/api/content-storage/items"))).json();
  assert.deepEqual(otherList.data.items, []);

  const mediaResponse = await GET_MEDIA(await requestFor("member-a", "https://app.test/media"), {
    params: Promise.resolve({ contentId: intentPayload.data.contentId, fileId: upload.fileId })
  });
  assert.equal(mediaResponse.status, 200);
  assert.equal(mediaResponse.headers.get("Content-Type"), "image/png");
  assert.equal(mediaResponse.headers.get("Cache-Control"), "private, no-store");

  const deniedMedia = await GET_MEDIA(await requestFor("member-b", "https://app.test/media"), {
    params: Promise.resolve({ contentId: intentPayload.data.contentId, fileId: upload.fileId })
  });
  assert.equal(deniedMedia.status, 404);
});

test("returns 401 without SSO and accepts repeated intent cleanup", async (t) => {
  const gateway = new MemoryContentStorageGateway();
  setContentStorageGatewayForTests(gateway);
  t.after(() => setContentStorageGatewayForTests(undefined));
  const unauthorized = await LIST(new NextRequest("https://app.test/api/content-storage/items"));
  assert.equal(unauthorized.status, 401);
});
~~~

Add a third test that creates an intent, preloads one object, calls `ABORT_INTENT` twice with the signed token, and verifies both responses are 200 and the object is absent.

- [ ] **Step 2: Run the route test and verify the route modules are missing**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-routes.test.ts
~~~

Expected: FAIL with missing `app/api/content-storage` route modules.

- [ ] **Step 3: Create common authenticated response handling**

Create `lib/content-storage/route-helpers.ts`:

~~~ts
import type { NextRequest } from "next/server";
import { requireContentStorageOwner } from "./auth";
import { getContentStorageGateway } from "./cos-gateway";
import { ContentStorageError } from "./service";

export async function readRouteJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ContentStorageError("请求 JSON 无效。", 400);
  }
}

export async function contentStorageRoute(
  request: NextRequest,
  operation: (ownerId: string, gateway: ReturnType<typeof getContentStorageGateway>) => Promise<unknown>
) {
  try {
    const ownerId = await requireContentStorageOwner(request);
    const result = await operation(ownerId, getContentStorageGateway());
    return result instanceof Response ? result : Response.json({ ok: true, data: result });
  } catch (error) {
    if (error instanceof ContentStorageError) {
      return Response.json({ ok: false, message: error.message }, { status: error.status });
    }
    if (error instanceof Error && /登录状态无效/.test(error.message)) {
      return Response.json({ ok: false, message: error.message }, { status: 401 });
    }
    return Response.json({ ok: false, message: "COS 操作失败，请稍后重试。" }, { status: 502 });
  }
}
~~~

- [ ] **Step 4: Create the upload-intent route**

`app/api/content-storage/upload-intents/route.ts` must export both methods:

~~~ts
import type { NextRequest } from "next/server";
import { contentStorageRoute, readRouteJson } from "@/lib/content-storage/route-helpers";
import { abortUploadIntent, ContentStorageError, createContentUploadIntent } from "@/lib/content-storage/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const body = await readRouteJson(request) as { images?: unknown };
    return createContentUploadIntent(ownerId, body.images ?? [], gateway);
  });
}

export async function DELETE(request: NextRequest) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const body = await readRouteJson(request) as { contentId?: unknown; token?: unknown };
    if (typeof body.contentId !== "string" || typeof body.token !== "string") {
      throw new ContentStorageError("清理参数无效。", 400);
    }
    await abortUploadIntent(ownerId, body.contentId, body.token, gateway);
    return { cleaned: true };
  });
}
~~~

- [ ] **Step 5: Create list, item, commit, edit-intent, and media routes**

Use these exact service mappings:

~~~ts
// app/api/content-storage/items/route.ts
export async function GET(request: NextRequest) {
  return contentStorageRoute(request, (ownerId, gateway) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || 50);
    return listContents(ownerId, gateway, url.searchParams.get("cursor") || undefined, limit);
  });
}

// app/api/content-storage/items/[contentId]/commit/route.ts
export async function POST(request: NextRequest, context: { params: Promise<{ contentId: string }> }) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    const body = await readRouteJson(request) as { token?: unknown; content?: unknown };
    if (typeof body.token !== "string") throw new ContentStorageError("上传意图无效。", 400);
    return commitContent(ownerId, contentId, body.token, body.content, gateway);
  });
}

// app/api/content-storage/items/[contentId]/upload-intents/route.ts
export async function POST(request: NextRequest, context: { params: Promise<{ contentId: string }> }) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId } = await context.params;
    const body = await readRouteJson(request) as { images?: unknown };
    return createEditUploadIntent(ownerId, contentId, body.images ?? [], gateway);
  });
}
~~~

In `items/[contentId]/route.ts` map GET to `getContent` with 404, PATCH to `updateContent`, and DELETE to `deleteContent`. In the PATCH body accept only `content`, `existingFileIds`, `newUploadToken`, and `mediaOrder`.

In `media/[fileId]/route.ts` call `getContentMedia` and return:

~~~ts
return new Response(object.body, {
  headers: {
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "Content-Type": object.contentType,
    "X-Content-Type-Options": "nosniff",
    ...(object.size !== undefined ? { "Content-Length": String(object.size) } : {})
  }
});
~~~

Every route must export `runtime = "nodejs"` and use `contentStorageRoute`.

- [ ] **Step 6: Run route tests, all storage tests, and type-check**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-*.test.ts
npm.cmd exec -- tsc --noEmit
~~~

Expected: route lifecycle, member isolation, media headers, abort idempotency, and all service tests pass.

- [ ] **Step 7: Commit the APIs**

~~~powershell
git add lib/content-storage/route-helpers.ts app/api/content-storage tests/content-storage-routes.test.ts
git commit -m "feat: expose authenticated COS content APIs"
~~~

### Task 7: Add the browser direct-upload client

**Files:**
- Create: `lib/content-storage/client.ts`
- Create: `tests/content-storage-client.test.ts`

- [ ] **Step 1: Write failing client tests for create, progress, edit ordering, and cleanup**

Create `tests/content-storage-client.test.ts`. Use a queued fetch stub that records every URL, method, headers, and body. Cover these exact sequences:

1. Successful create: `POST /api/content-storage/upload-intents`, one COS `PUT` per Blob, then `POST /api/content-storage/items/{contentId}/commit`. Assert the commit does not run until every PUT succeeds and progress reports `1/2` then `2/2`.
2. Failed COS PUT: after the first non-2xx PUT, assert `DELETE /api/content-storage/upload-intents` runs with the original `contentId/token` and commit never runs.
3. Successful edit: `POST /items/{contentId}/upload-intents`, upload only new Blobs, then `PATCH /items/{contentId}`. Assert the client converts:

~~~ts
[
  { kind: "new", fileIndex: 0 },
  { kind: "existing", fileId: "001-aaaaaaaaaaaa.webp" }
]
~~~

to the server order:

~~~ts
[
  "003-cccccccccccc.png",
  "001-aaaaaaaaaaaa.webp"
]
~~~

4. Failed PATCH after successful uploads: assert the edit intent is cleaned with the same DELETE endpoint.

Import `contentDraftFixture` from `tests/helpers/content-storage-fixtures.ts`. Return API envelopes in the stub as `{ ok: true, data: ... }` and failures as `{ ok: false, message: "..." }`.

- [ ] **Step 2: Run the client test and verify the missing module**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-client.test.ts
~~~

Expected: FAIL because `lib/content-storage/client.ts` does not exist.

- [ ] **Step 3: Implement typed API and direct PUT helpers**

Create `lib/content-storage/client.ts`:

~~~ts
import type {
  ContentDraft,
  StoredContentManifest,
  UploadIntent
} from "./contracts";

type Fetcher = typeof fetch;
type ProgressHandler = (completed: number, total: number) => void;

export type ClientOptions = {
  fetcher?: Fetcher;
  onProgress?: ProgressHandler;
};

export type MediaOrderItem =
  | { kind: "existing"; fileId: string }
  | { kind: "new"; fileIndex: number };

async function apiData<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => undefined) as
    | { ok?: boolean; data?: T; message?: string }
    | undefined;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.message || `请求失败（HTTP ${response.status}）`);
  }
  return payload.data as T;
}

function imageDescriptors(images: Blob[]) {
  return images.map((image) => ({ contentType: image.type, size: image.size }));
}

async function uploadImages(
  intent: UploadIntent,
  images: Blob[],
  fetcher: Fetcher,
  onProgress?: ProgressHandler
) {
  if (intent.uploads.length !== images.length) throw new Error("上传意图与图片数量不一致。");
  for (const [index, upload] of intent.uploads.entries()) {
    const response = await fetcher(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": upload.contentType },
      body: images[index]
    });
    if (!response.ok) throw new Error(`第 ${index + 1} 张图片上传失败。`);
    onProgress?.(index + 1, images.length);
  }
}

async function cleanupIntent(intent: UploadIntent, fetcher: Fetcher) {
  await fetcher("/api/content-storage/upload-intents", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentId: intent.contentId, token: intent.token })
  }).catch(() => undefined);
}

async function createIntent(url: string, images: Blob[], fetcher: Fetcher) {
  return apiData<UploadIntent>(await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: imageDescriptors(images) })
  }));
}

export function contentMediaUrl(contentId: string, fileId: string) {
  return `/api/content-storage/items/${encodeURIComponent(contentId)}/media/${encodeURIComponent(fileId)}`;
}

export async function listContentItems(options: { cursor?: string; fetcher?: Fetcher } = {}) {
  const query = options.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : "";
  return apiData<{ items: StoredContentManifest[]; cursor?: string }>(
    await (options.fetcher ?? fetch)(`/api/content-storage/items${query}`)
  );
}

export async function deleteContentItem(contentId: string, fetcher: Fetcher = fetch) {
  await apiData(await fetcher(`/api/content-storage/items/${encodeURIComponent(contentId)}`, {
    method: "DELETE"
  }));
}
~~~

- [ ] **Step 4: Implement create and edit orchestration**

Append these public functions:

~~~ts
export async function saveContentDraft(
  content: ContentDraft,
  images: Blob[],
  options: ClientOptions = {}
) {
  const fetcher = options.fetcher ?? fetch;
  let intent: UploadIntent | undefined;
  try {
    intent = await createIntent("/api/content-storage/upload-intents", images, fetcher);
    await uploadImages(intent, images, fetcher, options.onProgress);
    return await apiData<StoredContentManifest>(await fetcher(
      `/api/content-storage/items/${encodeURIComponent(intent.contentId)}/commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: intent.token, content })
      }
    ));
  } catch (error) {
    if (intent) await cleanupIntent(intent, fetcher);
    throw error;
  }
}

export async function updateContentItem(
  contentId: string,
  content: ContentDraft,
  existingFileIds: string[],
  newImages: Blob[],
  mediaOrder: MediaOrderItem[],
  options: ClientOptions = {}
) {
  const fetcher = options.fetcher ?? fetch;
  let intent: UploadIntent | undefined;
  try {
    if (newImages.length > 0) {
      intent = await createIntent(
        `/api/content-storage/items/${encodeURIComponent(contentId)}/upload-intents`,
        newImages,
        fetcher
      );
      await uploadImages(intent, newImages, fetcher, options.onProgress);
    }
    const resolvedOrder = mediaOrder.map((item) => {
      if (item.kind === "existing") return item.fileId;
      const upload = intent?.uploads[item.fileIndex];
      if (!upload) throw new Error("新增图片顺序无效。");
      return upload.fileId;
    });
    return await apiData<StoredContentManifest>(await fetcher(
      `/api/content-storage/items/${encodeURIComponent(contentId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          existingFileIds,
          newUploadToken: intent?.token,
          mediaOrder: resolvedOrder
        })
      }
    ));
  } catch (error) {
    if (intent) await cleanupIntent(intent, fetcher);
    throw error;
  }
}
~~~

The cleanup call is best-effort and must never mask the original PUT, commit, or PATCH failure.

- [ ] **Step 5: Run client and storage tests**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-*.test.ts
npm.cmd exec -- tsc --noEmit
~~~

Expected: all tests pass and the client remains usable only from browser code paths.

- [ ] **Step 6: Commit the browser client**

~~~powershell
git add lib/content-storage/client.ts tests/content-storage-client.test.ts
git commit -m "feat: upload content directly to Tencent COS"
~~~

### Task 8: Make the production page memory-only until cloud save

**Files:**
- Modify: `app/content/page.tsx:13-17,35-39,88-176,560-727,1540-1610,1818-1995`
- Delete: `lib/utils/image-generation-history.ts`
- Modify: `tests/content-production-contract.test.ts`

- [ ] **Step 1: Flip the production-page contract tests**

Update `tests/content-production-contract.test.ts` so it proves the new boundary without breaking the still-local keyword/reference-asset libraries:

~~~ts
test("keeps generated copy and candidate images in memory until COS save", () => {
  assert.equal(source.includes("IMAGE_DRAFT_STORAGE_KEY"), false);
  assert.equal(source.includes("GENERATED_IMAGES_STORAGE_KEY"), false);
  assert.equal(source.includes("loadGeneratedImages"), false);
  assert.equal(source.includes("saveGeneratedImages"), false);
  assert.equal(source.includes("persistImageFile(blob, `generated_"), false);
  assert.equal(source.includes("persistImageFile(file, `finished_upload_"), false);
  assert.equal(source.includes("blob: Blob"), true);
  assert.equal(source.includes("URL.createObjectURL(blob)"), true);
  assert.equal(source.includes("normalizeCosImageBlob"), true);
});

test("saves final content through COS and has no local fallback", () => {
  assert.equal(source.includes("saveContentDraft"), true);
  assert.equal(source.includes("FINISHED_CONTENT_STORAGE_KEY"), false);
  assert.equal(source.includes("compactFinishedItems"), false);
  assert.equal(source.includes("QuotaExceededError"), false);
  assert.equal(source.includes("window.localStorage.setItem(FINISHED_CONTENT_STORAGE_KEY"), false);
});

test("retains only unrelated local libraries and explicit manual export", () => {
  assert.equal(source.includes("KEYWORD_LIBRARY_STORAGE_KEY"), true);
  assert.equal(source.includes("persistCollectedImageSource"), true);
  assert.equal(source.includes("saveImageProjectLocally"), true);
  assert.equal(source.includes("showDirectoryPicker"), true);
});
~~~

Keep the existing generation-provider and reference-asset assertions. Remove only assertions that require generated candidates or finished content to enter localStorage/IndexedDB.

- [ ] **Step 2: Run the production contract test**

~~~powershell
npm.cmd exec -- tsx --test tests/content-production-contract.test.ts
~~~

Expected: FAIL on the old local persistence markers.

- [ ] **Step 3: Remove generated-draft hydration and hold candidate Blobs in memory**

Change `GeneratedImagePreview` and its key helper:

~~~ts
type GeneratedImagePreview = {
  id: string;
  planPage: number;
  url: string;
  provider: string;
  blob: Blob;
};

function generatedImageKey(image: GeneratedImagePreview) {
  return image.url;
}
~~~

Delete:

- `FINISHED_CONTENT_STORAGE_KEY`, `GENERATED_IMAGES_STORAGE_KEY`, and `IMAGE_DRAFT_STORAGE_KEY`.
- `ImageProductionDraft` and `generatedImageForStorage`.
- the generated-image hydration/save effects and `generatedImagesHydrated` state.
- the image-production draft load/save effects and `imageDraftHydrated` state.
- the import of `lib/utils/image-generation-history.ts`, then delete that now-unused module.

Keep the keyword-library load/save effect, but give it its own hydration boolean (`keywordLibraryHydrated`). Keep all local reference/material/product asset persistence because those modules are not generated finished content.

Use a ref-owned object URL registry:

~~~ts
const generatedObjectUrlsRef = useRef(new Set<string>());

const previewUrlForBlob = (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  generatedObjectUrlsRef.current.add(url);
  return url;
};

const releaseGeneratedPreview = (image: GeneratedImagePreview) => {
  if (!generatedObjectUrlsRef.current.delete(image.url)) return;
  URL.revokeObjectURL(image.url);
};

useEffect(() => () => {
  generatedObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  generatedObjectUrlsRef.current.clear();
}, []);
~~~

Keep SVG and other unsupported browser image types out of the authenticated inline proxy. Rasterize generated mock SVGs or locally selected unsupported images before they enter candidate state:

~~~ts
const COS_UPLOAD_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

async function normalizeCosImageBlob(blob: Blob) {
  if (COS_UPLOAD_IMAGE_TYPES.has(blob.type)) return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片格式转换失败。");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("图片格式转换失败。");
    return png;
  } finally {
    bitmap.close();
  }
}
~~~

When generation returns a URL/base64 payload, immediately convert it with `imageUrlToBlob` and create the preview as:

~~~ts
const blob = await normalizeCosImageBlob(await imageUrlToBlob(url));
return {
  id: `generated_${page}_${generatedAt}_${index}`,
  planPage: page,
  url: previewUrlForBlob(blob),
  provider,
  blob
};
~~~

When replacing a page's generated candidates or explicitly deleting a locally added final image, first remove its assignments and then call `releaseGeneratedPreview`. Do not revoke an object URL merely because the final-save dialog closes; the in-memory candidate still belongs to the current production session.

Change `uploadFinishedImages` to create in-memory previews directly:

~~~ts
const uploaded = await Promise.all(imageFiles.map(async (file, index) => {
  const blob = await normalizeCosImageBlob(file);
  return {
    id: `finished_upload_${Date.now()}_${workIndex}_${index}`,
    planPage: 0,
    url: previewUrlForBlob(blob),
    provider: "本地上传",
    blob
  } satisfies GeneratedImagePreview;
}));
~~~

No catch path may call `persistImageFile` or `persistImageRefs` for generated/final images.

- [ ] **Step 4: Add stable-reference sanitizers and a ContentDraft builder**

Import:

~~~ts
import type { ContentDraft, LibraryStatus, ReferenceSourceSnapshot } from "@/lib/content-storage/contracts";
import { saveContentDraft as saveContentDraftToCos } from "@/lib/content-storage/client";
~~~

Add pure helpers beside the existing content formatting helpers:

~~~ts
function stableHttpUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function stableReferenceSnapshot(reference: ParsedReference | null): ReferenceSourceSnapshot[] {
  const url = stableHttpUrl(reference?.url);
  if (!reference || !url) return [];
  return [{
    title: reference.title,
    url,
    platform: reference.platform,
    media: reference.media.flatMap((item) => {
      const mediaUrl = stableHttpUrl(item.url);
      if (!mediaUrl) return [];
      const posterUrl = stableHttpUrl(item.posterUrl);
      return [{
        type: item.type === "video" ? "video" as const : "image" as const,
        url: mediaUrl,
        ...(item.name ? { name: item.name } : {}),
        ...(posterUrl ? { posterUrl } : {})
      }];
    })
  }];
}
~~~

This intentionally drops `blob:`, `data:`, `cps-image://`, extension-local, and relative URLs from the durable manifest.

Build image drafts from the selected batch row and existing plan state. `pages[].sourceImages` must also run through `stableHttpUrl`:

~~~ts
function buildImageContentDraft(
  batch: BatchDraft,
  status: LibraryStatus,
  accountName: string
): ContentDraft {
  return {
    title: batch.title,
    summary: batch.copy.slice(0, 80),
    body: batch.copy,
    platform: parsedReference?.platform ?? "小红书",
    account: accountName,
    type: contentType,
    mediaKind: "image",
    pages: [...imagePlanItems].sort((a, b) => a.page - b.page).map((plan) => ({
      page: plan.page,
      title: plan.title,
      copy: batch.copy.slice(0, 80),
      prompt: planPromptMap[plan.page] ?? "",
      provider: planProviderMap[plan.page] ?? imageProvider,
      sourceImages: (planSourceMap[plan.page] ?? [])
        .flatMap((source) => stableHttpUrl(source.url) ?? [])
    })),
    referenceSources: stableReferenceSnapshot(parsedReference),
    tags: batch.tags,
    folder: null,
    prompts: imagePlanItems.map((item) => planPromptMap[item.page] ?? ""),
    negativePrompts: imagePlanItems.map((item) => item.negativePrompt),
    status,
    duplicateRate: 0,
    duplicateLabel: "待检测",
    lowFlowRisk: "低",
    checkAdvice: ["已从批量图文生产流程保存"],
    reviewNotes: [`${new Date().toISOString()} 批量保存到云端成品内容库`],
    externalVideoUrls: []
  };
}
~~~

Implement the video draft with the same metadata fields, `pages: []`, `mediaKind: "video"`, `stableReferenceSnapshot(parsedVideoReference)`, and:

~~~ts
externalVideoUrls: generatedVideos.flatMap((video) => stableHttpUrl(video.url) ?? [])
~~~

Do not upload video bytes in this change; generated video URLs remain validated external references as approved in the design.

- [ ] **Step 5: Replace final-save localStorage writes with item-level COS saves**

Delete `compactFinishedItems` and the existing `saveFinishedContent` localStorage implementation.

For image batches, save sequentially so the progress message identifies the current item:

~~~ts
const saveFinishedImageBatch = async (status: LibraryStatus) => {
  const accountName = accounts.find((account) => account.id === targetAccount)?.name ?? "未命名账号";
  const failures: string[] = [];
  let saved = 0;

  for (const [workIndex, batch] of selectedBatchDrafts.entries()) {
    const assigned = finishedImageAssignments[workIndex] ?? [];
    const images = assigned.flatMap((url) => {
      const image = generatedImages.find((candidate) => candidate.url === url);
      return image ? [image.blob] : [];
    });
    if (images.length !== assigned.length) {
      failures.push(`作品 ${workIndex + 1}：有图片已失效`);
      continue;
    }
    try {
      await saveContentDraftToCos(buildImageContentDraft(batch, status, accountName), images, {
        onProgress: (completed, total) => {
          setFeedback(`正在保存作品 ${workIndex + 1}/${selectedBatchDrafts.length}：图片 ${completed}/${total}`);
        }
      });
      saved += 1;
    } catch (error) {
      failures.push(`作品 ${workIndex + 1}：${error instanceof Error ? error.message : "保存失败"}`);
    }
  }

  if (failures.length) {
    throw new Error(`已保存 ${saved} 条；${failures.join("；")}`);
  }
  return saved;
};
~~~

`confirmSaveFinishedImage` must close the dialog and navigate to `/content-library` only after every selected item succeeds. Its catch message must report the real cloud error; remove the `QuotaExceededError` branch and do not add a local fallback.

`saveVideoToContentLibrary` must call:

~~~ts
await saveContentDraftToCos(buildVideoContentDraft("需复查", accountName), []);
~~~

Close and navigate only after that commit succeeds.

- [ ] **Step 6: Verify generated/local boundaries and page behavior**

~~~powershell
npm.cmd exec -- tsx --test tests/content-production-contract.test.ts tests/content-storage-client.test.ts
npm.cmd exec -- tsc --noEmit
rg -n "FINISHED_CONTENT_STORAGE_KEY|GENERATED_IMAGES_STORAGE_KEY|IMAGE_DRAFT_STORAGE_KEY|persistImageFile\\(blob, `generated_|persistImageFile\\(file, `finished_upload_|QuotaExceededError" app/content/page.tsx
~~~

Expected: tests and type-check pass; the final `rg` prints no matches. Manually verify:

1. Generated copy and image candidates disappear after a page refresh.
2. Keyword and reference/material libraries still reload.
3. Clicking the separate local-export control still writes/downloads the selected image.
4. Clicking “保存到内容库” shows direct-upload progress and reaches the content library only after cloud commit.

- [ ] **Step 7: Commit the production-page migration**

~~~powershell
git add app/content/page.tsx lib/utils/image-generation-history.ts tests/content-production-contract.test.ts
git commit -m "feat: save produced content only to COS"
~~~

### Task 9: Replace the local/mock content library with the member's cloud library

**Files:**
- Modify: `app/content-library/page.tsx:1-930`
- Modify: `app/api/feishu/sync-content/route.ts`
- Modify: `tests/content-library-contract.test.ts`
- Modify: `tests/feishu-sync-content-route.test.ts`

- [ ] **Step 1: Rewrite the library contract tests around cloud-only state**

Replace the old local-persistence assertions in `tests/content-library-contract.test.ts` with:

~~~ts
test("loads only authenticated COS manifests", () => {
  assert.equal(source.includes("listContentItems"), true);
  assert.equal(source.includes("StoredContentManifest"), true);
  assert.equal(source.includes("finishedContentsSeed"), false);
  assert.equal(source.includes("FINISHED_CONTENT_STORAGE_KEY"), false);
  assert.equal(source.includes("DELETED_CONTENT_STORAGE_KEY"), false);
  assert.equal(source.includes("CUSTOM_FOLDERS_STORAGE_KEY"), false);
});

test("reads media through the authenticated proxy and persists mutations", () => {
  assert.equal(source.includes("contentMediaUrl"), true);
  assert.equal(source.includes("updateContentItem"), true);
  assert.equal(source.includes("deleteContentItem"), true);
  assert.equal(source.includes("persistImageFile"), false);
  assert.equal(source.includes("window.localStorage.setItem"), false);
  assert.equal(source.includes("contentMedia"), true);
});

test("keeps explicit export but removes fake local state", () => {
  assert.equal(source.includes("chooseLocalExportFolder"), true);
  assert.equal(source.includes("showDirectoryPicker"), true);
  assert.equal(source.includes("已保存本地"), false);
  assert.equal(source.includes("localPath"), false);
  assert.equal(source.includes("打开本地文件夹"), false);
});
~~~

Keep existing Feishu-sync and image reorder assertions, updating type/function names where needed.

- [ ] **Step 2: Run the library contract test**

~~~powershell
npm.cmd exec -- tsx --test tests/content-library-contract.test.ts
~~~

Expected: FAIL because the page still loads seeds/localStorage.

- [ ] **Step 3: Replace the page model, hydration, media URL mapping, and empty state**

Remove the page-local `FinishedContent`, `LibraryStatus`, `RiskLevel` types, all five seed rows, all three localStorage keys, `resolvedMediaMap`, and the image-store import.

Import:

~~~ts
import type {
  ContentDraft,
  LibraryStatus,
  StoredContentManifest
} from "@/lib/content-storage/contracts";
import {
  contentMediaUrl,
  deleteContentItem,
  listContentItems,
  type MediaOrderItem,
  updateContentItem
} from "@/lib/content-storage/client";
~~~

Initialize and load cloud state:

~~~ts
const [items, setItems] = useState<StoredContentManifest[]>([]);
const [loading, setLoading] = useState(true);
const [loadError, setLoadError] = useState("");

const reloadItems = async () => {
  setLoading(true);
  setLoadError("");
  try {
    const loaded: StoredContentManifest[] = [];
    let cursor: string | undefined;
    do {
      const page = await listContentItems({ cursor });
      loaded.push(...page.items);
      cursor = page.cursor;
    } while (cursor);
    setItems(loaded);
  } catch (error) {
    setItems([]);
    setLoadError(error instanceof Error ? error.message : "云端成品加载失败。");
  } finally {
    setLoading(false);
  }
};

useEffect(() => {
  void reloadItems();
}, []);
~~~

Do not catch a load failure by displaying seeds or stale browser data. Render three explicit table/card states: loading, cloud error with “重试”, and empty member library with a link to `/content`.

Derive member-visible folders only from non-empty manifest values:

~~~ts
const folders = [
  "全部成品",
  ...Array.from(new Set(items.flatMap((item) => item.folder ? [item.folder] : [])))
];
const folderItems = filteredItems.filter(
  (item) => activeFolder === "全部成品" || item.folder === activeFolder
);
~~~

Remove “new folder/delete folder” controls because this design has no standalone empty-folder object. Folder membership remains editable through `manifest.folder`.

Derive account/type filter options from the loaded manifests instead of the old seed constants. Compute “今日新增” with today's local `YYYY-MM-DD` value against `createdAt`; remove the hard-coded `2026-07-09` comparison. If the active folder disappears after a reload, reset it to “全部成品”.

Map media without resolving private COS URLs in the browser:

~~~ts
function mediaUrlsFor(item: StoredContentManifest) {
  return item.media.flatMap((media) => media.storage === "cos"
    ? [contentMediaUrl(item.id, media.fileId)]
    : []
  );
}
~~~

Render `external` video rows as links or `<video>` sources in the detail view; do not feed them into image grids, image export, or Feishu image attachments.

The authenticated proxy is the only private-COS read path. Do not add signed GET URLs or the COS default domain to the manifest/UI.

- [ ] **Step 4: Convert status changes and deletion to awaited cloud mutations**

Add a helper that reconstructs editable content without system fields:

~~~ts
function draftFromManifest(item: StoredContentManifest): ContentDraft {
  return {
    title: item.title,
    summary: item.summary,
    body: item.body,
    platform: item.platform,
    account: item.account,
    type: item.type,
    mediaKind: item.mediaKind,
    pages: item.pages,
    referenceSources: item.referenceSources,
    tags: item.tags,
    folder: item.folder,
    prompts: item.prompts,
    negativePrompts: item.negativePrompts,
    status: item.status,
    duplicateRate: item.duplicateRate,
    duplicateLabel: item.duplicateLabel,
    lowFlowRisk: item.lowFlowRisk,
    checkAdvice: item.checkAdvice,
    reviewNotes: item.reviewNotes,
    externalVideoUrls: item.media.flatMap((media) => media.storage === "external" ? [media.url] : [])
  };
}

function existingCosFileIds(item: StoredContentManifest) {
  return item.media.flatMap((media) => media.storage === "cos" ? [media.fileId] : []);
}
~~~

Make `updateStatus` async and update each selected item through:

~~~ts
await updateContentItem(
  item.id,
  { ...draftFromManifest(item), status },
  existingCosFileIds(item),
  [],
  existingCosFileIds(item).map((fileId) => ({ kind: "existing", fileId }))
);
~~~

Update React state only with returned manifests. On a partial bulk failure, call `reloadItems` and report the failed titles.

Make delete async, ask for the existing confirmation, call `deleteContentItem` for every selected ID, then reload. The API's deleting state makes retries safe; browser tombstone/localStorage keys must not exist.

- [ ] **Step 5: Keep editor additions in memory and commit one atomic edit**

Represent editor media as:

~~~ts
type EditorMedia =
  | { id: string; kind: "existing"; fileId: string; previewUrl: string }
  | { id: string; kind: "new"; blob: File; previewUrl: string };

type EditingContent = {
  item: StoredContentManifest;
  draft: ContentDraft;
  media: EditorMedia[];
};
~~~

`openEditor` maps current COS images to `existing` rows and maps their `previewUrl` through `contentMediaUrl`. Adding files creates `URL.createObjectURL(file)` rows; it does not upload yet. Delete/reorder only changes this modal state. Revoke every new object URL when the row is removed or the modal closes.

The file picker may accept only `image/jpeg,image/png,image/webp,image/gif,image/avif`; reject any other MIME type before creating an editor row. Add a folder text/select field bound to `editing.draft.folder` so folder membership remains durable without a separate folder record.

On Save, derive:

~~~ts
const newRows = editing.media.filter(
  (row): row is Extract<EditorMedia, { kind: "new" }> => row.kind === "new"
);
const existingFileIds = editing.media.flatMap(
  (row) => row.kind === "existing" ? [row.fileId] : []
);
const mediaOrder: MediaOrderItem[] = editing.media.map((row) => row.kind === "existing"
  ? { kind: "existing", fileId: row.fileId }
  : { kind: "new", fileIndex: newRows.indexOf(row) }
);
const saved = await updateContentItem(
  editing.item.id,
  editing.draft,
  existingFileIds,
  newRows.map((row) => row.blob),
  mediaOrder,
  { onProgress: (completed, total) => setFeedback(`正在上传编辑图片 ${completed}/${total}`) }
);
~~~

Replace the row in `items` and `detailItem` only with `saved`. If upload/PATCH fails, leave the modal open with all Blobs still in memory so the member can retry. Revoke new object URLs only after successful save or explicit cancel.

- [ ] **Step 6: Keep explicit export and make Feishu read member media server-side**

Change `finishedImageBlob` to fetch the authenticated proxy URL directly:

~~~ts
async function finishedImageBlob(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
  return response.blob();
}
~~~

The separate “导出到本地” flow remains explicit and may use `showDirectoryPicker` or browser downloads.

Do not send private proxy URLs to `/api/feishu/sync-content`: a server-side fetch of those URLs would not automatically carry the member's browser cookie. Send opaque manifest references instead:

~~~ts
const contentMedia = item.media.flatMap((media) => media.storage === "cos"
  ? [{ contentId: item.id, fileId: media.fileId }]
  : []
);
~~~

Extend `SyncPayload` in `app/api/feishu/sync-content/route.ts` with:

~~~ts
contentMedia?: Array<{ contentId: string; fileId: string }>;
~~~

Keep legacy `images` handling for existing data/public URL callers. For `contentMedia`, derive the owner from the same request and read each object through the storage service:

~~~ts
import type { NextRequest } from "next/server";
import { requireContentStorageOwner } from "@/lib/content-storage/auth";
import { getContentStorageGateway } from "@/lib/content-storage/cos-gateway";
import { getContentMedia } from "@/lib/content-storage/service";

async function contentMediaBlob(
  ownerId: string,
  reference: { contentId: string; fileId: string }
) {
  const object = await getContentMedia(
    ownerId,
    reference.contentId,
    reference.fileId,
    getContentStorageGateway()
  );
  if (!object) throw new Error("成品图片不存在或无权访问");
  const bytes = object.body instanceof Uint8Array
    ? object.body
    : new Uint8Array(await new Response(object.body).arrayBuffer());
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: object.contentType });
}
~~~

Refactor the current Feishu attachment upload so one helper accepts a `Blob`. Existing URL/data-URL handling calls it after `imageToBlob`; new references call it after `contentMediaBlob`. Only call `requireContentStorageOwner(request)` when `contentMedia` is non-empty, preserving existing public/data URL test fixtures while making every COS reference session-bound.

Append a route test that:

1. creates and commits one image for `member-a` in `MemoryContentStorageGateway`;
2. installs the gateway with `setContentStorageGatewayForTests`;
3. calls Feishu sync using a real encrypted `member-a` session and `contentMedia: [{ contentId, fileId }]`;
4. verifies one Feishu media upload receives the COS bytes;
5. repeats with `member-b` and expects failure without uploading bytes.

Remove the fake `localPath` export column/data, “本地文件” card, “打开本地文件夹” control, `已保存本地` status/stat/filter, and mock export message. The table column should display `updatedAt` as “云端保存时间”; the detail card should say “云端内容” and offer only explicit export.

- [ ] **Step 7: Verify the cloud library**

~~~powershell
npm.cmd exec -- tsx --test tests/content-library-contract.test.ts tests/content-storage-client.test.ts tests/feishu-sync-content-route.test.ts
npm.cmd exec -- tsc --noEmit
rg -n "finishedContentsSeed|FINISHED_CONTENT_STORAGE_KEY|DELETED_CONTENT_STORAGE_KEY|CUSTOM_FOLDERS_STORAGE_KEY|persistImageFile|window\\.localStorage|已保存本地|localPath|打开本地文件夹" app/content-library/page.tsx
~~~

Expected: tests and type-check pass; the final `rg` prints no matches. Manually verify:

1. A member sees only API-returned content, including an honest empty state.
2. Refresh preserves cloud content and no local browser database/localStorage record is created for it.
3. Reorder/add/delete image edits persist after refresh.
4. Archive/status and delete persist after refresh.
5. Preview and explicit local export read through the authenticated proxy; Feishu sync reads the same member-scoped object through the server storage service.

- [ ] **Step 8: Commit the cloud library migration**

~~~powershell
git add app/content-library/page.tsx app/api/feishu/sync-content/route.ts tests/content-library-contract.test.ts tests/feishu-sync-content-route.test.ts
git commit -m "feat: load member content library from COS"
~~~

### Task 10: Configure COS safely, probe the real bucket, and run end-to-end acceptance

**Files:**
- Modify: `.env.example`
- Modify: `wrangler.jsonc`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/probe-content-storage.ts`
- Create: `docs/tencent-cos-content-storage-setup.md`
- Create: `tests/content-storage-config-contract.test.ts`
- Modify: `docs/superpowers/specs/2026-08-21-tencent-cos-content-storage-design.md`

- [ ] **Step 1: Write a failing non-secret configuration contract test**

Create `tests/content-storage-config-contract.test.ts`:

~~~ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const env = readFileSync(".env.example", "utf8");
const wrangler = readFileSync("wrangler.jsonc", "utf8");
const setup = readFileSync("docs/tencent-cos-content-storage-setup.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};

test("documents the selected bucket and keeps COS credentials out of wrangler", () => {
  assert.match(env, /^TENCENT_COS_BUCKET=xshcp-1410143389$/m);
  assert.match(env, /^TENCENT_COS_REGION=ap-singapore$/m);
  assert.match(env, /^TENCENT_COS_SECRET_ID=$/m);
  assert.match(env, /^TENCENT_COS_SECRET_KEY=$/m);
  assert.match(wrangler, /"TENCENT_COS_BUCKET": "xshcp-1410143389"/);
  assert.match(wrangler, /"TENCENT_COS_REGION": "ap-singapore"/);
  assert.equal(wrangler.includes("TENCENT_COS_SECRET_ID"), false);
  assert.equal(wrangler.includes("TENCENT_COS_SECRET_KEY"), false);
});

test("ships a probe command and private-bucket setup checklist", () => {
  assert.equal(packageJson.scripts?.["probe:cos"], "tsx scripts/probe-content-storage.ts");
  assert.match(setup, /私有读写/);
  assert.match(setup, /users\\/\\*/);
  assert.match(setup, /ETag/);
  assert.match(setup, /wrangler secret put TENCENT_COS_SECRET_ID/);
  assert.match(setup, /wrangler secret put TENCENT_COS_SECRET_KEY/);
});
~~~

- [ ] **Step 2: Run the config test**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-config-contract.test.ts
~~~

Expected: FAIL because the COS configuration and setup guide are not present.

- [ ] **Step 3: Add public variables, secret placeholders, and the probe command**

Append to `.env.example`:

~~~dotenv
# Tencent COS finished-content storage
TENCENT_COS_BUCKET=xshcp-1410143389
TENCENT_COS_REGION=ap-singapore
TENCENT_COS_SECRET_ID=
TENCENT_COS_SECRET_KEY=
~~~

Add only non-secret values to the top level of `wrangler.jsonc`:

~~~jsonc
"vars": {
  "TENCENT_COS_BUCKET": "xshcp-1410143389",
  "TENCENT_COS_REGION": "ap-singapore"
},
~~~

Install the direct environment-loader dependency used by the probe and add the script:

~~~powershell
npm.cmd install --save-dev @next/env@^15.1.0
~~~

~~~json
"probe:cos": "tsx scripts/probe-content-storage.ts"
~~~

Never put the SecretId, SecretKey, an upload signature, or a signed URL in Git, client code, console output, API error messages, or the manifest.

- [ ] **Step 4: Create a reversible real COS probe**

Create `scripts/probe-content-storage.ts`:

~~~ts
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import {
  CosContentStorageGateway,
  readCosConfig
} from "../lib/content-storage/cos-gateway";

loadEnvConfig(process.cwd());

const config = readCosConfig();
const gateway = new CosContentStorageGateway();
const key = `users/cos-probe/diagnostics/${randomUUID()}.json`;
let wroteObject = false;

try {
  await gateway.putJson(key, { probe: true });
  wroteObject = true;
  const head = await gateway.headObject(key);
  if (!head || !head.contentType.startsWith("application/json") || head.size <= 0) {
    throw new Error("COS probe HEAD verification failed.");
  }
  const value = await gateway.getJson(key) as { probe?: unknown } | undefined;
  if (value?.probe !== true) throw new Error("COS probe GET verification failed.");
  process.stdout.write(`COS probe passed: ${config.bucket} (${config.region})\\n`);
} finally {
  if (wroteObject) await gateway.deleteObjects([key]);
}
~~~

Run it only after a restricted CAM credential is available in the shell or local `.env.local`:

~~~powershell
npm.cmd run probe:cos
~~~

Expected: one pass line containing only bucket/region; the temporary `users/cos-probe/diagnostics/...json` object is gone even after a later verification failure.

- [ ] **Step 5: Write the Tencent COS/CAM/CORS deployment guide**

Create `docs/tencent-cos-content-storage-setup.md` with this exact checklist:

1. Bucket `xshcp-1410143389` in `ap-singapore` remains **私有读写**; do not enable public read.
2. Create a dedicated CAM sub-user/API key for this app. Do not use the Tencent root-account key.
3. Attach a least-privilege policy scoped to this bucket and `users/*`:

~~~json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": ["name/cos:GetBucket"],
      "resource": ["qcs::cos:ap-singapore:uid/1410143389:xshcp-1410143389/*"],
      "condition": {
        "string_like": {
          "cos:prefix": ["users/*"]
        }
      }
    },
    {
      "effect": "allow",
      "action": [
        "name/cos:GetObject",
        "name/cos:HeadObject",
        "name/cos:PutObject",
        "name/cos:DeleteObject"
      ],
      "resource": [
        "qcs::cos:ap-singapore:uid/1410143389:xshcp-1410143389/users/*"
      ]
    }
  ]
}
~~~

4. Configure COS CORS for each exact production origin plus `http://127.0.0.1:3000` during local development:
   - Allowed method: `PUT`
   - Allowed headers: `*`
   - Expose headers: `ETag`
   - Max-Age: `600`
   - Never use `*` for Allowed Origin when the production origin is known.
5. Set local values only in ignored `.env.local`. Set Cloudflare secrets interactively:

~~~powershell
npm.cmd exec -- wrangler secret put TENCENT_COS_SECRET_ID
npm.cmd exec -- wrangler secret put TENCENT_COS_SECRET_KEY
~~~

6. Run `npm.cmd run probe:cos`, then the focused tests/build below before deployment.
7. If the direct PUT fails in the browser, inspect the preflight response and COS CORS origin/header settings; do not proxy image uploads through the app as a workaround.

- [ ] **Step 6: Run focused and full automated verification**

~~~powershell
npm.cmd exec -- tsx --test tests/content-storage-*.test.ts tests/content-production-contract.test.ts tests/content-library-contract.test.ts
npm.cmd test
npm.cmd exec -- tsc --noEmit
npm.cmd run build
git diff --check
~~~

Expected: focused tests, the entire suite, type-check, and production build all pass; Git reports no whitespace errors.

- [ ] **Step 7: Commit configuration, probe, and operations documentation**

~~~powershell
git add .env.example wrangler.jsonc package.json package-lock.json scripts/probe-content-storage.ts docs/tencent-cos-content-storage-setup.md tests/content-storage-config-contract.test.ts docs/superpowers/specs/2026-08-21-tencent-cos-content-storage-design.md
git commit -m "docs: configure private Tencent COS storage"
~~~

- [ ] **Step 8: Deploy through the existing pipeline and run real two-member acceptance**

After the user authorizes deployment and the secrets are configured, deploy the branch through the project's existing Cloudflare/OpenNext pipeline. Do not invent a new deployment command if the repository-connected pipeline owns publication.

Use two real SSO member accounts, A and B:

1. A generates multiple text/image candidates. Refresh before saving and confirm they disappear.
2. A regenerates, chooses the final text/images, clicks “保存到内容库”, and sees direct-upload progress followed by the committed item.
3. In COS, confirm objects exist only below `users/{encoded-A-id}/contents/{contentId}/` and the manifest has no SecretId, SecretKey, signed URL, `blob:`, `data:`, or local file path.
4. B's library does not list A's item. From B's session, requesting A's guessed item/media API path returns 404 and never returns bytes.
5. A previews, edits image order, adds/removes one image, changes status, refreshes, and sees every change.
6. A uses explicit local export and verifies text/images download successfully through the authenticated proxy.
7. A deletes the test item, refreshes, and confirms both manifest and referenced COS images are gone. Retrying delete remains successful.
8. Browser storage inspection shows no generated-copy draft, generated-image history, finished-content library, or content-library tombstone/folder keys. Unrelated keyword/reference/material stores may remain.

Record the deployed URL, test time, two anonymized member IDs, content ID, browser/network result, COS prefix result, and cleanup result in the implementation handoff. If credentials, CORS access, deployment authorization, or a second member account is unavailable, report that exact external acceptance step as pending rather than claiming completion.

- [ ] **Step 9: Review the final branch scope**

~~~powershell
git status --short
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
git diff --check main...HEAD
~~~

Expected: every changed line traces to this COS migration; no credentials or unrelated binary changes are present; `public/downloads/xhs-browser-extension-0.1.12.zip` is not staged or committed.
