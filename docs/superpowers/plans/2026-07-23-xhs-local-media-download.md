# Xiaohongshu Local Media Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download every image, video, and video poster from each newly captured Xiaohongshu topic into the current browser and render those local files in the existing topic-card media area.

**Architecture:** Upgrade the extension protocol to version 2 and let the MV3 background service worker stream allowlisted media in bounded Base64 chunks over the existing long-lived Port. The website client persists chunks and complete manifests in a dedicated IndexedDB database, acknowledges each durable write for backpressure, resolves complete files to Blob URLs, and keeps the left-side material library and application server out of the media path.

**Tech Stack:** Next.js 15, React 19, TypeScript, Chrome MV3 extension APIs, IndexedDB, Blob URLs, Node test runner via `tsx`, `fake-indexeddb`, PowerShell extension packager.

---

## Execution context and file map

Run every command from:

```powershell
Set-Location -LiteralPath 'D:\小红书自动生产\.worktrees\xhs-extension-detail-click-fix'
```

The worktree already contains unrelated, uncommitted filter/detail fixes in `browser-extension/xhs-content.js` and `tests/xhs-extension-collector.test.ts`. Preserve them exactly. Every commit below uses an explicit path list and must not stage those two files.

Files created or changed by this plan:

- `browser-extension/shared/protocol.js`: protocol-v2 message shapes, local media metadata, downloading progress, and result counters.
- `browser-extension/shared/media-transfer.js`: allowlist validation, stable asset keys, complete media-job construction, response validation, bounded Base64 streaming, and retry behavior.
- `browser-extension/background.js`: media handshake routing and sequential per-topic downloads before the final result.
- `browser-extension/app-bridge.js`: verify its existing generic forwarding already carries validated protocol-v2 media messages without prematurely ending the active request; no production edit is expected.
- `browser-extension/manifest.template.json`: extension version `0.1.11` and explicit official Xiaohongshu/CDN host permissions.
- `lib/xhs-topic-media-store.ts`: dedicated IndexedDB manifests/chunks database and local file lifecycle.
- `lib/xhs-extension-client.ts`: page-side media sink, ordered async writes, acknowledgements, counters, and protocol compatibility.
- `lib/xhs-extension-topics.ts`: pure helpers for local media keys, local URL resolution, and stripping local references after deletion.
- `types/topic.ts`: optional local media metadata on `Topic.media`.
- `app/topics/page.tsx`: store wiring, Blob URL hydration/revocation, local rendering, progress feedback, and delete cleanup.
- `tests/xhs-extension-protocol.test.ts`: protocol, manifest, bridge, background, packaging, and security assertions.
- `tests/xhs-media-transfer.test.ts`: pure downloader/allowlist/chunking coverage.
- `tests/xhs-topic-media-store.test.ts`: real IndexedDB behavior under `fake-indexeddb`.
- `tests/xhs-extension-client.test.ts`: media handshake, durable acknowledgements, failure continuation, and protocol-version coverage.
- `tests/xhs-extension-topics.test.ts`: local URL preference, legacy fallback, and deletion helpers.
- `package.json`, `package-lock.json`: add `fake-indexeddb` as a test-only dependency.
- `docs/xhs-browser-extension-install.md`: local storage behavior and `0.1.11` upgrade instructions.
- Generated only, not committed: `exports/xhs-browser-extension-0.1.11/` and `exports/xhs-browser-extension-0.1.11.zip`.

### Task 1: Upgrade the strict wire protocol and manifest permissions

**Files:**
- Modify: `tests/xhs-extension-protocol.test.ts`
- Modify: `browser-extension/shared/protocol.js`
- Modify: `browser-extension/manifest.template.json`

- [ ] **Step 1: Write failing protocol-v2 and manifest tests**

Add constants and assertions to `tests/xhs-extension-protocol.test.ts` for the exact new messages:

```ts
const ASSET_KEY = "sha256-0123456789abcdef0123456789abcdef";

test("protocol v2 accepts exact media transfer envelopes and rejects malformed chunks", () => {
  assert.equal(protocol.PROTOCOL_VERSION, 2);
  const start = extensionEnvelope("media:start", {
    assetKey: ASSET_KEY,
    topicKey: "xhs:64f0a1b2c3d4e5f60718293a",
    mediaRole: "image",
    sourceUrl: "https://sns-webpic-qc.xhscdn.com/example.jpg"
  });
  const chunk = extensionEnvelope("media:chunk", {
    assetKey: ASSET_KEY,
    chunkIndex: 0,
    data: "AQID",
    byteLength: 3
  });
  const complete = extensionEnvelope("media:complete", {
    assetKey: ASSET_KEY,
    mimeType: "image/jpeg",
    byteLength: 3,
    chunkCount: 1
  });
  const mediaError = extensionEnvelope("media:error", {
    assetKey: ASSET_KEY,
    code: "MEDIA_FETCH_FAILED",
    message: "图片下载失败"
  });

  assert.equal(protocol.isEnvelope(start, "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(chunk, "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(complete, "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(mediaError, "extension-to-page"), true);
  assert.equal(protocol.isEnvelope(envelope("media:ready", { assetKey: ASSET_KEY }), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope("media:skip", { assetKey: ASSET_KEY }), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope("media:ack", { assetKey: ASSET_KEY, chunkIndex: 0 }), "page-to-extension"), true);
  assert.equal(protocol.isEnvelope(envelope("media:abort", {
    assetKey: ASSET_KEY,
    code: "QUOTA_EXCEEDED",
    message: "本机存储空间不足"
  }), "page-to-extension"), true);

  assert.equal(protocol.isEnvelope(extensionEnvelope("media:chunk", {
    assetKey: ASSET_KEY,
    chunkIndex: 1,
    data: "***",
    byteLength: 3
  }), "extension-to-page"), false);
  assert.equal(protocol.isEnvelope(extensionEnvelope("media:complete", {
    assetKey: ASSET_KEY,
    mimeType: "text/html",
    byteLength: 3,
    chunkCount: 1
  }), "extension-to-page"), false);
});

test("protocol v2 result carries local media metadata and media counters", () => {
  const localTopic = topic({
    media: [{
      type: "video",
      url: "https://sns-video-qc.xhscdn.com/example.mp4",
      posterUrl: "https://sns-webpic-qc.xhscdn.com/poster.jpg",
      localAssetKey: ASSET_KEY,
      posterLocalAssetKey: "sha256-fedcba9876543210fedcba9876543210",
      mimeType: "video/mp4",
      size: 1024
    }]
  });
  assert.equal(protocol.isEnvelope(extensionEnvelope("result", {
    topics: [localTopic],
    message: "完成",
    mediaCompleted: 2,
    mediaFailed: 0
  }), "extension-to-page"), true);
});
```

Update the manifest test to expect this exact least-privilege configuration:

```ts
assert.equal(manifest.version, "0.1.11");
assert.deepEqual(manifest.host_permissions, [
  "https://www.xiaohongshu.com/*",
  "https://*.xiaohongshu.com/*",
  "https://*.xhscdn.com/*",
  "__APP_MATCH_PATTERN__"
]);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx.cmd tsx --test tests/xhs-extension-protocol.test.ts
```

Expected: FAIL because the current protocol version is `1`, media message types are rejected, local media keys are unknown, result counters are absent, and the manifest is still `0.1.0` without CDN hosts.

- [ ] **Step 3: Implement the exact protocol-v2 fields and validators**

In `browser-extension/shared/protocol.js`, set the version and extend the key lists exactly as follows:

```js
const PROTOCOL_VERSION = 2;
const ASSET_KEY_PATTERN = /^sha256-[0-9a-f]{32}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MEDIA_KEYS = ["type", "url", "name", "posterUrl", "localAssetKey", "posterLocalAssetKey", "mimeType", "size"];
```

Add these validators beside the existing string and URL helpers:

```js
function isAssetKey(value) {
  return typeof value === "string" && ASSET_KEY_PATTERN.test(value);
}

function isMediaMime(value) {
  return typeof value === "string" && value.length <= 100 && /^(?:image|video)\/[a-z0-9.+-]+$/i.test(value);
}

function isSafeCount(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function isBase64Chunk(value) {
  return typeof value === "string" && value.length <= 262_144 && BASE64_PATTERN.test(value);
}
```

Extend `isMedia` with these exact optional checks:

```js
(!hasOwn.call(values.values, "localAssetKey") || isAssetKey(values.values.localAssetKey)) &&
(!hasOwn.call(values.values, "posterLocalAssetKey") || isAssetKey(values.values.posterLocalAssetKey)) &&
(!hasOwn.call(values.values, "mimeType") || isMediaMime(values.values.mimeType)) &&
(!hasOwn.call(values.values, "size") || isSafeCount(values.values.size, Number.MAX_SAFE_INTEGER))
```

Replace the `progress` and `result` payload branches and add the media payload branches in `validatePayload`:

```js
if (type === "progress") {
  const values = inspectExactRecord(payload, ["stage", "completed", "total", "message"]);
  return values && ["opening", "searching", "enriching", "downloading"].includes(values.stage) &&
    isSafeCount(values.completed, 10) && isSafeCount(values.total, 10) &&
    values.completed <= values.total && isBoundedString(values.message, 300) ? { ok: true } : { ok: false };
}
if (type === "result") {
  const values = inspectExactRecord(payload, ["topics", "message", "mediaCompleted", "mediaFailed"]);
  return values && isDenseArray(values.topics, 10, isTopic) && isBoundedString(values.message, 300) &&
    isSafeCount(values.mediaCompleted, 500) && isSafeCount(values.mediaFailed, 500) ? { ok: true } : { ok: false };
}
if (type === "media:start") {
  const values = inspectExactRecord(payload, ["assetKey", "topicKey", "mediaRole", "sourceUrl"]);
  return values && isAssetKey(values.assetKey) && isNonblankString(values.topicKey, 160) &&
    ["image", "video", "poster"].includes(values.mediaRole) && isHttpsUrl(values.sourceUrl) ? { ok: true } : { ok: false };
}
if (type === "media:chunk") {
  const values = inspectExactRecord(payload, ["assetKey", "chunkIndex", "data", "byteLength"]);
  return values && isAssetKey(values.assetKey) && isSafeCount(values.chunkIndex, 100_000) &&
    isBase64Chunk(values.data) && isSafeCount(values.byteLength, 196_608) ? { ok: true } : { ok: false };
}
if (type === "media:complete") {
  const values = inspectExactRecord(payload, ["assetKey", "mimeType", "byteLength", "chunkCount"]);
  return values && isAssetKey(values.assetKey) && isMediaMime(values.mimeType) &&
    isSafeCount(values.byteLength, Number.MAX_SAFE_INTEGER) && isSafeCount(values.chunkCount, 100_000) ? { ok: true } : { ok: false };
}
if (type === "media:error" || type === "media:abort") {
  const values = inspectExactRecord(payload, ["assetKey", "code", "message"]);
  return values && isAssetKey(values.assetKey) && isNonblankString(values.code, 80) &&
    isNonblankString(values.message, 300) ? { ok: true } : { ok: false };
}
if (type === "media:ready" || type === "media:skip") {
  const values = inspectExactRecord(payload, ["assetKey"]);
  return values && isAssetKey(values.assetKey) ? { ok: true } : { ok: false };
}
if (type === "media:ack") {
  const values = inspectExactRecord(payload, ["assetKey", "chunkIndex"]);
  return values && isAssetKey(values.assetKey) && isSafeCount(values.chunkIndex, 100_000) ? { ok: true } : { ok: false };
}
```

Use these exact allowed type arrays in `isEnvelope`:

```js
const allowedTypes = direction === "page-to-extension"
  ? ["ping", "collect", "cancel", "media:ready", "media:skip", "media:ack", "media:abort"]
  : ["pong", "progress", "media:start", "media:chunk", "media:complete", "media:error", "result", "error"];
```

In `browser-extension/manifest.template.json`, use:

```json
"version": "0.1.11",
"host_permissions": [
  "https://www.xiaohongshu.com/*",
  "https://*.xiaohongshu.com/*",
  "https://*.xhscdn.com/*",
  "__APP_MATCH_PATTERN__"
]
```

- [ ] **Step 4: Update old result fixtures and run protocol tests**

Every existing `extensionEnvelope("result", ...)` fixture in `tests/xhs-extension-protocol.test.ts` must contain both counters:

```ts
{ topics: [], message: "完成", mediaCompleted: 0, mediaFailed: 0 }
```

Run:

```powershell
npx.cmd tsx --test tests/xhs-extension-protocol.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit only the protocol and manifest change**

```powershell
git add -- browser-extension/shared/protocol.js browser-extension/manifest.template.json tests/xhs-extension-protocol.test.ts
git diff --cached --check
git commit -m "feat: define xhs media transfer protocol"
```

### Task 2: Build and verify the extension-side media downloader

**Files:**
- Create: `browser-extension/shared/media-transfer.js`
- Create: `tests/xhs-media-transfer.test.ts`
- Modify: `tests/xhs-extension-protocol.test.ts`

- [ ] **Step 1: Write failing tests for allowlisting, jobs, keys, chunking, MIME, and redirects**

Create `tests/xhs-media-transfer.test.ts` with these public behaviors:

```ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const transfer = require("../browser-extension/shared/media-transfer.js") as {
  MAX_CHUNK_BYTES: number;
  isAllowedMediaUrl(value: string): boolean;
  isAllowedMediaMime(value: string): boolean;
  createAssetKey(topicKey: string, role: string, order: number, sourceUrl: string): Promise<string>;
  buildMediaJobs(topic: any): Array<{ itemIndex: number; role: string; sourceUrl: string }>;
  downloadMedia(input: {
    sourceUrl: string;
    fetchImpl: typeof fetch;
    onChunk(chunk: { chunkIndex: number; data: string; byteLength: number }): Promise<void>;
  }): Promise<{ mimeType: string; byteLength: number; chunkCount: number }>;
};

test("media URL allowlist accepts only official HTTPS hosts", () => {
  assert.equal(transfer.isAllowedMediaUrl("https://ci.xiaohongshu.com/a.jpg"), true);
  assert.equal(transfer.isAllowedMediaUrl("https://sns-webpic-qc.xhscdn.com/a.jpg"), true);
  assert.equal(transfer.isAllowedMediaUrl("https://sns-video-qc.xhscdn.com/a.mp4"), true);
  assert.equal(transfer.isAllowedMediaUrl("http://sns-video-qc.xhscdn.com/a.mp4"), false);
  assert.equal(transfer.isAllowedMediaUrl("https://xhscdn.com.evil.example/a.mp4"), false);
  assert.equal(transfer.isAllowedMediaUrl("https://example.com/a.jpg"), false);
});

test("buildMediaJobs includes every image, video, and video poster in order", () => {
  assert.deepEqual(transfer.buildMediaJobs({
    media: [
      { type: "image", url: "https://ci.xiaohongshu.com/one.jpg" },
      {
        type: "video",
        url: "https://sns-video-qc.xhscdn.com/two.mp4",
        posterUrl: "https://sns-webpic-qc.xhscdn.com/two.jpg"
      }
    ]
  }), [
    { itemIndex: 0, role: "image", sourceUrl: "https://ci.xiaohongshu.com/one.jpg" },
    { itemIndex: 1, role: "video", sourceUrl: "https://sns-video-qc.xhscdn.com/two.mp4" },
    { itemIndex: 1, role: "poster", sourceUrl: "https://sns-webpic-qc.xhscdn.com/two.jpg" }
  ]);
});

test("asset keys are stable and distinguish role and order", async () => {
  const one = await transfer.createAssetKey("xhs:note", "image", 0, "https://ci.xiaohongshu.com/a.jpg");
  const same = await transfer.createAssetKey("xhs:note", "image", 0, "https://ci.xiaohongshu.com/a.jpg");
  const other = await transfer.createAssetKey("xhs:note", "poster", 0, "https://ci.xiaohongshu.com/a.jpg");
  assert.match(one, /^sha256-[0-9a-f]{32}$/);
  assert.equal(one, same);
  assert.notEqual(one, other);
});

test("downloadMedia emits bounded chunks and exact totals", async () => {
  const bytes = new Uint8Array(transfer.MAX_CHUNK_BYTES + 7).map((_, index) => index % 251);
  const chunks: Array<{ chunkIndex: number; data: string; byteLength: number }> = [];
  const result = await transfer.downloadMedia({
    sourceUrl: "https://sns-video-qc.xhscdn.com/a.mp4",
    fetchImpl: async () => new Response(bytes, {
      status: 200,
      headers: { "content-type": "video/mp4" }
    }),
    async onChunk(chunk) { chunks.push(chunk); }
  });
  assert.deepEqual(chunks.map((item) => [item.chunkIndex, item.byteLength]), [[0, transfer.MAX_CHUNK_BYTES], [1, 7]]);
  assert.deepEqual(result, { mimeType: "video/mp4", byteLength: bytes.length, chunkCount: 2 });
  assert.deepEqual(Buffer.concat(chunks.map((item) => Buffer.from(item.data, "base64"))), Buffer.from(bytes));
});

test("downloadMedia rejects non-media responses and redirects outside the allowlist", async () => {
  await assert.rejects(transfer.downloadMedia({
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg",
    fetchImpl: async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    async onChunk() {}
  }), /MEDIA_TYPE_INVALID/);
  await assert.rejects(transfer.downloadMedia({
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: "https://evil.example/a.jpg",
      headers: new Headers({ "content-type": "image/jpeg" }),
      body: new Blob([new Uint8Array([1])]).stream()
    }) as Response,
    async onChunk() {}
  }), /MEDIA_REDIRECT_BLOCKED/);
});
```

- [ ] **Step 2: Run the downloader test and verify it fails**

```powershell
npx.cmd tsx --test tests/xhs-media-transfer.test.ts
```

Expected: FAIL because `browser-extension/shared/media-transfer.js` does not exist.

- [ ] **Step 3: Implement the pure downloader module**

Create `browser-extension/shared/media-transfer.js` as a UMD/CommonJS-compatible module exporting the tested API. Use these exact constants and rules:

```js
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.XhsMediaTransfer = api;
})(globalThis, function (root) {
  const MAX_CHUNK_BYTES = 192 * 1024;
  const ALLOWED_SUFFIXES = ["xiaohongshu.com", "xhscdn.com"];

  class MediaTransferError extends Error {
    constructor(code, message) {
      super(`${code}: ${message}`);
      this.code = code;
    }
  }

  function isAllowedMediaUrl(value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") return false;
      return ALLOWED_SUFFIXES.some((suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`));
    } catch (_) {
      return false;
    }
  }

  function isAllowedMediaMime(value) {
    return typeof value === "string" && /^(?:image|video)\/[a-z0-9.+-]+$/i.test(value.split(";", 1)[0].trim());
  }

  function normalizeSourceUrl(value) {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  }

  async function createAssetKey(topicKey, role, order, sourceUrl) {
    const input = `${topicKey}\n${role}\n${order}\n${normalizeSourceUrl(sourceUrl)}`;
    const digest = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `sha256-${hex.slice(0, 32)}`;
  }

  function buildMediaJobs(topic) {
    const jobs = [];
    const media = Array.isArray(topic && topic.media) ? topic.media : [];
    media.forEach((item, itemIndex) => {
      if (!item || (item.type !== "image" && item.type !== "video")) return;
      if (isAllowedMediaUrl(item.url)) jobs.push({ itemIndex, role: item.type, sourceUrl: item.url });
      if (item.type === "video" && isAllowedMediaUrl(item.posterUrl)) {
        jobs.push({ itemIndex, role: "poster", sourceUrl: item.posterUrl });
      }
    });
    return jobs;
  }

  function encodeBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    }
    return btoa(binary);
  }

  async function downloadMedia({ sourceUrl, fetchImpl = root.fetch, onChunk }) {
    if (!isAllowedMediaUrl(sourceUrl)) throw new MediaTransferError("MEDIA_URL_BLOCKED", "媒体地址不在白名单内");
    const response = await fetchImpl(sourceUrl, {
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      referrer: "https://www.xiaohongshu.com/",
      referrerPolicy: "strict-origin-when-cross-origin"
    });
    if (!response.ok) throw new MediaTransferError("MEDIA_FETCH_FAILED", `媒体请求返回 ${response.status}`);
    if (response.url && !isAllowedMediaUrl(response.url)) throw new MediaTransferError("MEDIA_REDIRECT_BLOCKED", "媒体重定向到了白名单外主机");
    const mimeType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (!isAllowedMediaMime(mimeType)) throw new MediaTransferError("MEDIA_TYPE_INVALID", "媒体响应类型无效");
    if (!response.body) throw new MediaTransferError("MEDIA_BODY_MISSING", "媒体响应没有可读取内容");

    const reader = response.body.getReader();
    let carry = new Uint8Array(0);
    let byteLength = 0;
    let chunkIndex = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const joined = new Uint8Array(carry.length + value.length);
      joined.set(carry);
      joined.set(value, carry.length);
      let offset = 0;
      while (joined.length - offset >= MAX_CHUNK_BYTES) {
        const chunk = joined.slice(offset, offset + MAX_CHUNK_BYTES);
        await onChunk({ chunkIndex, data: encodeBase64(chunk), byteLength: chunk.length });
        byteLength += chunk.length;
        chunkIndex += 1;
        offset += MAX_CHUNK_BYTES;
      }
      carry = joined.slice(offset);
    }
    if (carry.length) {
      await onChunk({ chunkIndex, data: encodeBase64(carry), byteLength: carry.length });
      byteLength += carry.length;
      chunkIndex += 1;
    }
    return { mimeType, byteLength, chunkCount: chunkIndex };
  }

  return Object.freeze({
    MAX_CHUNK_BYTES,
    MediaTransferError,
    isAllowedMediaUrl,
    isAllowedMediaMime,
    createAssetKey,
    buildMediaJobs,
    downloadMedia
  });
});
```

- [ ] **Step 4: Verify the downloader and existing shared-directory packaging rule**

Run:

```powershell
npx.cmd tsx --test tests/xhs-media-transfer.test.ts
rg -n "Copy-Item.*browser-extension\\shared.*-Recurse" scripts/package-xhs-browser-extension.ps1
```

Expected: the downloader test PASSes; the second command shows that the packager already copies the complete `browser-extension/shared` directory, so the new module requires no packager code change. Task 5 adds and tests the background import when that integration is implemented.

- [ ] **Step 5: Commit only the pure downloader and its tests**

```powershell
git add -- browser-extension/shared/media-transfer.js tests/xhs-media-transfer.test.ts
git diff --cached --check
git commit -m "feat: stream allowlisted xhs media"
```

Do not stage the intentionally failing background import assertion until Task 5 implements it.

### Task 3: Add the dedicated IndexedDB chunk store

**Files:**
- Create: `lib/xhs-topic-media-store.ts`
- Create: `tests/xhs-topic-media-store.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the IndexedDB test implementation**

```powershell
npm.cmd install --save-dev fake-indexeddb
```

Expected: `fake-indexeddb` appears only in `devDependencies`; `package-lock.json` is updated.

- [ ] **Step 2: Write failing store lifecycle tests**

Create `tests/xhs-topic-media-store.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createXhsTopicMediaStore } from "../lib/xhs-topic-media-store";

const ASSET_KEY = "sha256-0123456789abcdef0123456789abcdef";

test("stores chunks, commits a complete manifest, and restores the exact Blob", async () => {
  const store = createXhsTopicMediaStore(new IDBFactory());
  assert.equal(await store.prepare({
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "image",
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg"
  }), "ready");
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 0, data: "AQI=", byteLength: 2 });
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 1, data: "AwQ=", byteLength: 2 });
  await store.complete({ assetKey: ASSET_KEY, mimeType: "image/jpeg", byteLength: 4, chunkCount: 2 });
  const blob = await store.getBlob(ASSET_KEY);
  assert.equal(blob?.type, "image/jpeg");
  assert.deepEqual(new Uint8Array(await blob!.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
});

test("complete media is skipped and aborted media leaves no readable file", async () => {
  const store = createXhsTopicMediaStore(new IDBFactory());
  const start = {
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "video" as const,
    sourceUrl: "https://sns-video-qc.xhscdn.com/a.mp4"
  };
  assert.equal(await store.prepare(start), "ready");
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 0, data: "AQ==", byteLength: 1 });
  await store.complete({ assetKey: ASSET_KEY, mimeType: "video/mp4", byteLength: 1, chunkCount: 1 });
  assert.equal(await store.prepare(start), "skip");

  const second = "sha256-fedcba9876543210fedcba9876543210";
  await store.prepare({ ...start, assetKey: second });
  await store.writeChunk({ assetKey: second, chunkIndex: 0, data: "Ag==", byteLength: 1 });
  await store.abort(second);
  assert.equal(await store.getBlob(second), null);
});

test("rejects wrong order and totals and deletes all selected files", async () => {
  const store = createXhsTopicMediaStore(new IDBFactory());
  await store.prepare({
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "poster",
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg"
  });
  await assert.rejects(store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 1, data: "AQ==", byteLength: 1 }), /chunk order/i);
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 0, data: "AQ==", byteLength: 1 });
  await assert.rejects(store.complete({ assetKey: ASSET_KEY, mimeType: "image/jpeg", byteLength: 2, chunkCount: 1 }), /byte length/i);
  await store.abort(ASSET_KEY);
  assert.equal(await store.getBlob(ASSET_KEY), null);
});

test("cleans chunks abandoned by a canceled or closed page", async () => {
  const store = createXhsTopicMediaStore(new IDBFactory());
  await store.prepare({
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "image",
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg"
  });
  await store.writeChunk({ assetKey: ASSET_KEY, chunkIndex: 0, data: "AQ==", byteLength: 1 });
  assert.equal(await store.cleanupIncomplete(), 1);
  assert.equal(await store.prepare({
    assetKey: ASSET_KEY,
    topicKey: "xhs:note",
    mediaRole: "image",
    sourceUrl: "https://ci.xiaohongshu.com/a.jpg"
  }), "ready");
});
```

- [ ] **Step 3: Run the store test and verify it fails**

```powershell
npx.cmd tsx --test tests/xhs-topic-media-store.test.ts
```

Expected: FAIL because `lib/xhs-topic-media-store.ts` does not exist.

- [ ] **Step 4: Implement the dedicated manifests/chunks database**

Create `lib/xhs-topic-media-store.ts` with this public contract and exact database names:

```ts
export const XHS_TOPIC_MEDIA_DB_NAME = "content-production-studio-xhs-topic-media";
const DB_VERSION = 1;
const MANIFESTS = "manifests";
const CHUNKS = "chunks";

export type MediaRole = "image" | "video" | "poster";

export interface MediaStart {
  assetKey: string;
  topicKey: string;
  mediaRole: MediaRole;
  sourceUrl: string;
}

export interface MediaChunk {
  assetKey: string;
  chunkIndex: number;
  data: string;
  byteLength: number;
}

export interface MediaComplete {
  assetKey: string;
  mimeType: string;
  byteLength: number;
  chunkCount: number;
}

interface Manifest extends MediaStart {
  mimeType: string;
  size: number;
  chunkCount: number;
  status: "complete";
  createdAt: string;
}

interface ChunkRecord {
  assetKey: string;
  chunkIndex: number;
  blob: Blob;
  byteLength: number;
}

export interface XhsTopicMediaStore {
  prepare(start: MediaStart): Promise<"ready" | "skip">;
  writeChunk(chunk: MediaChunk): Promise<void>;
  complete(complete: MediaComplete): Promise<Manifest>;
  abort(assetKey: string): Promise<void>;
  getBlob(assetKey: string): Promise<Blob | null>;
  deleteAssets(assetKeys: string[]): Promise<void>;
  cleanupIncomplete(): Promise<number>;
}
```

Use an in-memory `pending` map for the active transfer sequence and these exact invariants:

```ts
const pending = new Map<string, MediaStart & { nextChunkIndex: number; byteLength: number }>();

function decodeChunk(data: string, declaredLength: number) {
  const binary = atob(data);
  if (binary.length !== declaredLength) throw new Error("Media chunk byte length mismatch.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes]);
}
```

Open IndexedDB with `manifests` keyed by `assetKey` and `chunks` keyed by `[assetKey, chunkIndex]`, plus a `byAsset` index:

```ts
function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(XHS_TOPIC_MEDIA_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MANIFESTS)) database.createObjectStore(MANIFESTS, { keyPath: "assetKey" });
      if (!database.objectStoreNames.contains(CHUNKS)) {
        const chunks = database.createObjectStore(CHUNKS, { keyPath: ["assetKey", "chunkIndex"] });
        chunks.createIndex("byAsset", "assetKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open XHS topic media database."));
  });
}
```

Implement `prepare`, `writeChunk`, and `complete` so that:

```ts
async prepare(start) {
  const existing = await getManifest(start.assetKey);
  if (existing?.status === "complete") return "skip";
  await deleteAssets([start.assetKey]);
  pending.set(start.assetKey, { ...start, nextChunkIndex: 0, byteLength: 0 });
  return "ready";
},
async writeChunk(chunk) {
  const state = pending.get(chunk.assetKey);
  if (!state || state.nextChunkIndex !== chunk.chunkIndex) throw new Error("Media chunk order mismatch.");
  const blob = decodeChunk(chunk.data, chunk.byteLength);
  await putChunk({ assetKey: chunk.assetKey, chunkIndex: chunk.chunkIndex, blob, byteLength: chunk.byteLength });
  state.nextChunkIndex += 1;
  state.byteLength += chunk.byteLength;
},
async complete(input) {
  const state = pending.get(input.assetKey);
  if (!state || state.nextChunkIndex !== input.chunkCount) throw new Error("Media chunk count mismatch.");
  if (state.byteLength !== input.byteLength) throw new Error("Media byte length mismatch.");
  const manifest: Manifest = {
    assetKey: input.assetKey,
    topicKey: state.topicKey,
    mediaRole: state.mediaRole,
    sourceUrl: state.sourceUrl,
    mimeType: input.mimeType,
    size: input.byteLength,
    chunkCount: input.chunkCount,
    status: "complete",
    createdAt: new Date().toISOString()
  };
  await putManifest(manifest);
  pending.delete(input.assetKey);
  return manifest;
}
```

Use these exact request, transaction, and cursor helpers:

```ts
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function deleteChunkCursor(store: IDBObjectStore, assetKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.index("byAsset").openCursor(assetKey);
    request.onerror = () => reject(request.error ?? new Error("Unable to enumerate media chunks."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });
}
```

Finish `createXhsTopicMediaStore` with concrete database operations:

```ts
export function createXhsTopicMediaStore(factory: IDBFactory = indexedDB): XhsTopicMediaStore {
  const databasePromise = openDatabase(factory);
  const pending = new Map<string, MediaStart & { nextChunkIndex: number; byteLength: number }>();

  async function getManifest(assetKey: string) {
    const database = await databasePromise;
    const transaction = database.transaction(MANIFESTS, "readonly");
    return requestValue(transaction.objectStore(MANIFESTS).get(assetKey)) as Promise<Manifest | undefined>;
  }

  async function putManifest(manifest: Manifest) {
    const database = await databasePromise;
    const transaction = database.transaction(MANIFESTS, "readwrite");
    transaction.objectStore(MANIFESTS).put(manifest);
    await transactionDone(transaction);
  }

  async function putChunk(chunk: ChunkRecord) {
    const database = await databasePromise;
    const transaction = database.transaction(CHUNKS, "readwrite");
    transaction.objectStore(CHUNKS).put(chunk);
    await transactionDone(transaction);
  }

  async function getChunks(assetKey: string) {
    const database = await databasePromise;
    const transaction = database.transaction(CHUNKS, "readonly");
    return requestValue(transaction.objectStore(CHUNKS).index("byAsset").getAll(assetKey)) as Promise<ChunkRecord[]>;
  }

  async function getAllRecords<T>(storeName: string) {
    const database = await databasePromise;
    const transaction = database.transaction(storeName, "readonly");
    return requestValue(transaction.objectStore(storeName).getAll()) as Promise<T[]>;
  }

  async function deleteAssets(assetKeys: string[]) {
    if (!assetKeys.length) return;
    const database = await databasePromise;
    const transaction = database.transaction([MANIFESTS, CHUNKS], "readwrite");
    const manifests = transaction.objectStore(MANIFESTS);
    const chunks = transaction.objectStore(CHUNKS);
    for (const assetKey of Array.from(new Set(assetKeys))) {
      manifests.delete(assetKey);
      await deleteChunkCursor(chunks, assetKey);
      pending.delete(assetKey);
    }
    await transactionDone(transaction);
  }

  return {
    async prepare(start) {
      const existing = await getManifest(start.assetKey);
      if (existing?.status === "complete") return "skip";
      await deleteAssets([start.assetKey]);
      pending.set(start.assetKey, { ...start, nextChunkIndex: 0, byteLength: 0 });
      return "ready";
    },
    async writeChunk(chunk) {
      const state = pending.get(chunk.assetKey);
      if (!state || state.nextChunkIndex !== chunk.chunkIndex) throw new Error("Media chunk order mismatch.");
      const blob = decodeChunk(chunk.data, chunk.byteLength);
      await putChunk({ assetKey: chunk.assetKey, chunkIndex: chunk.chunkIndex, blob, byteLength: chunk.byteLength });
      state.nextChunkIndex += 1;
      state.byteLength += chunk.byteLength;
    },
    async complete(input) {
      const state = pending.get(input.assetKey);
      if (!state || state.nextChunkIndex !== input.chunkCount) throw new Error("Media chunk count mismatch.");
      if (state.byteLength !== input.byteLength) throw new Error("Media byte length mismatch.");
      const manifest: Manifest = {
        assetKey: input.assetKey,
        topicKey: state.topicKey,
        mediaRole: state.mediaRole,
        sourceUrl: state.sourceUrl,
        mimeType: input.mimeType,
        size: input.byteLength,
        chunkCount: input.chunkCount,
        status: "complete",
        createdAt: new Date().toISOString()
      };
      await putManifest(manifest);
      pending.delete(input.assetKey);
      return manifest;
    },
    async abort(assetKey) {
      await deleteAssets([assetKey]);
    },
    async getBlob(assetKey) {
      const manifest = await getManifest(assetKey);
      if (!manifest || manifest.status !== "complete") return null;
      const chunks = (await getChunks(assetKey)).sort((left, right) => left.chunkIndex - right.chunkIndex);
      if (chunks.length !== manifest.chunkCount) return null;
      let byteLength = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        if (chunks[index].chunkIndex !== index) return null;
        byteLength += chunks[index].byteLength;
      }
      if (byteLength !== manifest.size) return null;
      return new Blob(chunks.map((chunk) => chunk.blob), { type: manifest.mimeType });
    },
    deleteAssets,
    async cleanupIncomplete() {
      const manifests = await getAllRecords<Manifest>(MANIFESTS);
      const complete = new Set(manifests.filter((item) => item.status === "complete").map((item) => item.assetKey));
      const chunks = await getAllRecords<ChunkRecord>(CHUNKS);
      const abandoned = Array.from(new Set(chunks.map((item) => item.assetKey).filter((assetKey) => !complete.has(assetKey))));
      await deleteAssets(abandoned);
      return abandoned.length;
    }
  };
}
```

Export only `createXhsTopicMediaStore` and the types/constants in this task.

- [ ] **Step 5: Run the store tests and a type build**

```powershell
npx.cmd tsx --test tests/xhs-topic-media-store.test.ts
npm.cmd run build
```

Expected: both commands PASS.

- [ ] **Step 6: Commit only the store and test dependency**

```powershell
git add -- package.json package-lock.json lib/xhs-topic-media-store.ts tests/xhs-topic-media-store.test.ts
git diff --cached --check
git commit -m "feat: persist xhs topic media locally"
```

### Task 4: Make the website client persist and acknowledge media messages

**Files:**
- Modify: `tests/xhs-extension-client.test.ts`
- Modify: `lib/xhs-extension-client.ts`
- Verify unchanged: `browser-extension/app-bridge.js`

- [ ] **Step 1: Write failing client handshake tests**

Add a fake media store to `tests/xhs-extension-client.test.ts`:

```ts
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

  assert.deepEqual(store.calls, ["prepare", "chunk", "complete"]);
  assert.deepEqual(target.messages.slice(1).map((item) => (item.message as any).type), ["media:ready", "media:ack", "media:ack"]);
  assert.deepEqual(await collected, { topics: [], message: "完成", mediaCompleted: 1, mediaFailed: 0 });
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
  await Promise.resolve();
  await Promise.resolve();
  const abort = target.messages.at(-1)?.message as any;
  assert.equal(abort.type, "media:abort");
  assert.equal(abort.payload.code, "QUOTA_EXCEEDED");
  target.receive(extensionMessage("result", REQUEST_ID, {
    topics: [], message: "部分媒体失败", mediaCompleted: 0, mediaFailed: 1
  }));
  assert.equal((await collected).mediaFailed, 1);
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
```

Define `ASSET_KEY` once beside `REQUEST_ID`. Update every old result fixture to include `mediaCompleted` and `mediaFailed`, and update compatible detection expectations from protocol `1` to `2`.

- [ ] **Step 2: Run the client test and verify it fails**

```powershell
npx.cmd tsx --test tests/xhs-extension-client.test.ts
```

Expected: FAIL because protocol version is still `1` in the client, `collect` has no media store, and media messages are ignored.

- [ ] **Step 3: Add the typed media sink and protocol-v2 result fields**

In `lib/xhs-extension-client.ts`:

```ts
import type { XhsTopicMediaStore, MediaChunk, MediaComplete, MediaStart } from "@/lib/xhs-topic-media-store";

export const XHS_EXTENSION_PROTOCOL_VERSION = 2;
const LEGACY_PING_DELAY_MS = 150;
type PageMessageType = "ping" | "collect" | "cancel" | "media:ready" | "media:skip" | "media:ack" | "media:abort";
type ExtensionMessageType = "pong" | "progress" | "media:start" | "media:chunk" | "media:complete" | "media:error" | "result" | "error";

export interface ExtensionProgress {
  stage: "opening" | "searching" | "enriching" | "downloading";
  completed: number;
  total: number;
  message: string;
}

export interface ExtensionCollectResult {
  topics: Topic[];
  message: string;
  mediaCompleted: number;
  mediaFailed: number;
}
```

Add `mediaStore?: XhsTopicMediaStore`, `mediaQueue: Promise<void>`, and `requestTimeout: number` to `PendingRequest`. Change the constructor signature without breaking existing two-argument tests:

```ts
export function createXhsExtensionClient(
  target: ExtensionTarget = getDefaultTarget(),
  timeoutMs?: number,
  mediaStore?: XhsTopicMediaStore
): XhsExtensionClient {
```

Let `send` accept only the current version, and add a separate legacy-detection sender that cannot be used for collection:

```ts
const sendEnvelope = (type: PageMessageType, requestId: string, payload: unknown, protocolVersion: number) => {
  target.postMessage({
    channel: XHS_EXTENSION_CHANNEL,
    protocolVersion,
    direction: "page-to-extension",
    type,
    requestId,
    payload
  } satisfies MessageEnvelope, origin);
};
const send = (type: PageMessageType, requestId: string, payload: unknown) =>
  sendEnvelope(type, requestId, payload, XHS_EXTENSION_PROTOCOL_VERSION);
```

In `detect`, start the normal protocol-v2 request, then send one delayed protocol-v1 `ping` only if that request is still pending:

```ts
detect() {
  if (disposed) return Promise.reject(new Error("The XHS extension client was disposed."));
  const requestId = crypto.randomUUID();
  const detection = startRequest<{ version: string }>(requestId, "ping", {}, timeoutMs ?? DEFAULT_PING_TIMEOUT_MS, "pong");
  setTimeout(() => {
    if (pending.has(requestId)) sendEnvelope("ping", requestId, {}, 1);
  }, LEGACY_PING_DELAY_MS);
  return detection.then((payload) => ({ version: payload.version, protocolVersion: XHS_EXTENSION_PROTOCOL_VERSION }));
}
```

The new extension ignores the legacy ping; an installed `0.1.10` bridge accepts it and returns a protocol-v1 pong, which the client turns into the existing explicit upgrade error.

Initialize collection requests with a resolved queue:

```ts
pending.set(requestId, {
  expectedTerminalType,
  resolve,
  reject,
  timer,
  onProgress,
  mediaStore,
  mediaQueue: Promise.resolve(),
  requestTimeout
});
```

Make the existing `timer` property writable and reset the idle timeout after every valid progress or media-transfer message so a large video cannot fail merely because the total batch lasts longer than ten minutes:

```ts
const refreshPendingTimer = (requestId: string) => {
  const request = pending.get(requestId);
  if (!request) return;
  clearTimeout(request.timer);
  request.timer = setTimeout(
    () => rejectPending(requestId, new Error(`XHS extension request timed out after ${request.requestTimeout}ms.`)),
    request.requestTimeout
  );
};
```

Call `refreshPendingTimer(message.requestId)` only after validating a `progress`, `media:start`, `media:chunk`, `media:complete`, or `media:error` payload. This keeps the timeout an inactivity guard rather than a total video-download limit.

Add this ordered handler inside `createXhsExtensionClient` and call it before terminal result handling:

```ts
const ASSET_KEY_PATTERN = /^sha256-[0-9a-f]{32}$/;

function isMediaMessagePayload(type: string, value: unknown) {
  if (!isRecord(value) || typeof value.assetKey !== "string" || !ASSET_KEY_PATTERN.test(value.assetKey)) return false;
  if (type === "media:start") {
    return typeof value.topicKey === "string" && value.topicKey.length > 0 && value.topicKey.length <= 160 &&
      (value.mediaRole === "image" || value.mediaRole === "video" || value.mediaRole === "poster") &&
      typeof value.sourceUrl === "string" && value.sourceUrl.startsWith("https://");
  }
  if (type === "media:chunk") {
    return typeof value.chunkIndex === "number" && Number.isSafeInteger(value.chunkIndex) && value.chunkIndex >= 0 &&
      typeof value.data === "string" && value.data.length <= 262_144 &&
      typeof value.byteLength === "number" && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 && value.byteLength <= 196_608;
  }
  if (type === "media:complete") {
    return typeof value.mimeType === "string" && /^(?:image|video)\//.test(value.mimeType) &&
      typeof value.byteLength === "number" && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 &&
      typeof value.chunkCount === "number" && Number.isSafeInteger(value.chunkCount) && value.chunkCount >= 0;
  }
  return type === "media:error" && typeof value.code === "string" && typeof value.message === "string";
}

const queueMediaMessage = (request: PendingRequest, message: Partial<MessageEnvelope>) => {
  if (!request.mediaStore || typeof message.type !== "string" || !isMediaMessagePayload(message.type, message.payload)) return false;
  const store = request.mediaStore;
  const payload = message.payload as Record<string, any>;
  request.mediaQueue = request.mediaQueue.then(async () => {
    try {
      if (message.type === "media:start") {
        const status = await store.prepare(payload as MediaStart);
        send(status === "skip" ? "media:skip" : "media:ready", message.requestId!, { assetKey: payload.assetKey });
      } else if (message.type === "media:chunk") {
        await store.writeChunk(payload as MediaChunk);
        send("media:ack", message.requestId!, { assetKey: payload.assetKey, chunkIndex: payload.chunkIndex });
      } else if (message.type === "media:complete") {
        await store.complete(payload as MediaComplete);
        send("media:ack", message.requestId!, { assetKey: payload.assetKey, chunkIndex: payload.chunkCount });
      } else if (message.type === "media:error") {
        await store.abort(payload.assetKey);
      }
    } catch (error) {
      await store.abort(payload.assetKey).catch(() => undefined);
      const quota = error instanceof DOMException && error.name === "QuotaExceededError";
      send("media:abort", message.requestId!, {
        assetKey: payload.assetKey,
        code: quota ? "QUOTA_EXCEEDED" : "MEDIA_STORE_FAILED",
        message: quota ? "本机存储空间不足" : "媒体保存失败"
      });
    }
  });
  return true;
};
```

For `media:start`, `media:chunk`, `media:complete`, and `media:error`, use this branch before terminal handling:

```ts
if (["media:start", "media:chunk", "media:complete", "media:error"].includes(String(message.type))) {
  refreshPendingTimer(message.requestId);
  if (!queueMediaMessage(request, message)) rejectPending(message.requestId, new Error("扩展媒体响应格式异常。"));
  return;
}
```

For a terminal result, wait for every queued IndexedDB action before clearing and resolving:

```ts
if (message.type === "result" && request.expectedTerminalType === "result") {
  if (!isResultPayload(message.payload)) {
    rejectPending(message.requestId, new Error("扩展响应格式异常。"));
    return;
  }
  void request.mediaQueue.then(() => {
    if (!pending.has(message.requestId)) return;
    clearTimeout(request.timer);
    pending.delete(message.requestId);
    request.resolve(message.payload);
  });
  return;
}
```

Extend `isProgressPayload` with `downloading`; extend `isResultPayload` to require finite, nonnegative `mediaCompleted` and `mediaFailed`.

Capture the pending request before cancellation, reject the public collection promise as today, then clean incomplete chunks after its queued writes settle:

```ts
cancel(requestId) {
  if (disposed) return Promise.reject(new Error("The XHS extension client was disposed."));
  const request = pending.get(requestId);
  send("cancel", requestId, {});
  if (request?.expectedTerminalType === "result") rejectPending(requestId, new Error("XHS extension collection was canceled."));
  if (!request?.mediaStore) return Promise.resolve();
  return request.mediaQueue
    .then(() => request.mediaStore!.cleanupIncomplete())
    .then(() => undefined);
}
```

In `dispose`, start the same best-effort cleanup before rejecting each pending request; the next page load runs `cleanupIncomplete` again if browser shutdown interrupts it:

```ts
for (const [requestId, request] of pending) {
  if (request.mediaStore) void request.mediaQueue.then(() => request.mediaStore!.cleanupIncomplete());
  rejectPending(requestId, new Error("The XHS extension client was disposed."));
}
```

- [ ] **Step 4: Keep the app bridge active for all media events**

In `browser-extension/app-bridge.js`, retain the existing exact validation and forwarding. The only terminal types remain `result` and `error`:

```js
if ((message.type === "result" || message.type === "error") && message.requestId === activeRequestId) {
  activeRequestId = null;
}
```

Verify that the existing terminal check contains only `result` and `error` and does not name any media event:

```powershell
rg -n 'message\.type === "result" \|\| message\.type === "error"|media:complete.*activeRequestId' browser-extension/app-bridge.js
```

Expected: the first expression is found; the second expression is absent. No `app-bridge.js` edit is needed because the bridge already forwards every protocol-approved nonterminal message and keeps `activeRequestId` until `result`, `error`, cancellation, or disconnect.

- [ ] **Step 5: Run client/protocol tests**

```powershell
npx.cmd tsx --test tests/xhs-extension-client.test.ts tests/xhs-extension-protocol.test.ts
```

Expected: PASS. Task 5 adds the background import/orchestration assertion immediately before implementing that integration.

- [ ] **Step 6: Commit the page-side protocol client**

```powershell
git add -- lib/xhs-extension-client.ts tests/xhs-extension-client.test.ts
git diff --cached --check
git commit -m "feat: persist extension media chunks"
```

### Task 5: Orchestrate downloads in the extension background

**Files:**
- Modify: `tests/xhs-extension-protocol.test.ts`
- Modify: `browser-extension/background.js`

- [ ] **Step 1: Add failing orchestration assertions**

Extend the existing background source test in `tests/xhs-extension-protocol.test.ts`:

```ts
assert.match(background, /importScripts\([\s\S]*shared\/media-transfer\.js/);
assert.match(background, /async function transferTopicMedia/);
assert.match(background, /mediaTransfer\.buildMediaJobs\(topic\)/);
assert.match(background, /await waitForMediaReply\(context, assetKey, new Set\(\["media:ready", "media:skip", "media:abort"\]\)\)/);
assert.match(background, /post\(context, "media:chunk"/);
assert.match(background, /post\(context, "media:complete"/);
assert.match(background, /mediaCompleted/);
assert.match(background, /mediaFailed/);
assert.match(background, /await transferTopicMedia\(context, topic/);
```

Add these exact routing assertions so `startCollection` is called only for `collect`, while transfer replies go to the active waiter:

```ts
assert.match(background, /\["media:ready", "media:skip", "media:ack", "media:abort"\]\.includes\(message\.type\)/);
assert.match(background, /routeMediaReply\(active, message\)/);
assert.match(background, /message\.type === "collect"\) void startCollection\(port, originTabId, message\)/);
assert.doesNotMatch(background, /^\s*void startCollection\(port, originTabId, message\);/m);
```

- [ ] **Step 2: Run the protocol test and verify it fails**

```powershell
npx.cmd tsx --test tests/xhs-extension-protocol.test.ts
```

Expected: FAIL because `background.js` does not import or orchestrate media transfers.

- [ ] **Step 3: Import the media module and add reply routing**

Change the first line and module constants in `browser-extension/background.js`:

```js
importScripts("shared/protocol.js", "shared/collector.js", "shared/task-state.js", "shared/media-transfer.js");
const mediaTransfer = globalThis.XhsMediaTransfer;
const MEDIA_REPLY_TIMEOUT_MS = 30_000;
```

Add `mediaWaiter: null`, `mediaStorageBlocked: false`, `mediaCompleted: 0`, and `mediaFailed: 0` to the task context. Add these exact routing functions:

```js
function waitForMediaReply(context, assetKey, allowedTypes, expectedChunkIndex) {
  ensureRunning(context);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      context.mediaWaiter = null;
      reject(new TaskError("MEDIA_ACK_TIMEOUT", "网页保存媒体超时"));
    }, MEDIA_REPLY_TIMEOUT_MS);
    context.mediaWaiter = { assetKey, allowedTypes, expectedChunkIndex, resolve, reject, timer };
  });
}

function routeMediaReply(context, message) {
  const waiter = context && context.mediaWaiter;
  if (!waiter || message.requestId !== context.requestId || !waiter.allowedTypes.has(message.type)) return;
  if (!message.payload || message.payload.assetKey !== waiter.assetKey) return;
  if (message.type === "media:ack" && message.payload.chunkIndex !== waiter.expectedChunkIndex) return;
  clearTimeout(waiter.timer);
  context.mediaWaiter = null;
  if (message.type === "media:abort") {
    const error = new TaskError(message.payload.code, message.payload.message);
    waiter.reject(error);
  } else {
    waiter.resolve(message);
  }
}
```

When cancelling a context, reject and clear `mediaWaiter` as well as `abortWait`:

```js
if (context.mediaWaiter) {
  clearTimeout(context.mediaWaiter.timer);
  context.mediaWaiter.reject(error);
  context.mediaWaiter = null;
}
```

- [ ] **Step 4: Implement sequential transfer with retry and partial failure**

Add these functions before `runCollection`:

```js
function attachLocalKey(topic, job, assetKey, metadata) {
  const item = topic.media[job.itemIndex];
  if (!item) return;
  if (job.role === "poster") item.posterLocalAssetKey = assetKey;
  else {
    item.localAssetKey = assetKey;
    item.mimeType = metadata.mimeType;
    item.size = metadata.byteLength;
  }
}

async function downloadOneMedia(context, topicKey, topic, job, order) {
  const assetKey = await mediaTransfer.createAssetKey(topicKey, job.role, order, job.sourceUrl);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      post(context, "media:start", { assetKey, topicKey, mediaRole: job.role, sourceUrl: job.sourceUrl });
      const startReply = await waitForMediaReply(context, assetKey, new Set(["media:ready", "media:skip", "media:abort"]));
      if (startReply.type === "media:skip") {
        attachLocalKey(topic, job, assetKey, {
          mimeType: topic.media[job.itemIndex]?.mimeType || (job.role === "video" ? "video/mp4" : "image/jpeg"),
          byteLength: topic.media[job.itemIndex]?.size || 0
        });
        return;
      }
      const metadata = await mediaTransfer.downloadMedia({
        sourceUrl: job.sourceUrl,
        async onChunk(chunk) {
          post(context, "media:chunk", { assetKey, ...chunk });
          await waitForMediaReply(context, assetKey, new Set(["media:ack", "media:abort"]), chunk.chunkIndex);
        }
      });
      post(context, "media:complete", { assetKey, ...metadata });
      await waitForMediaReply(context, assetKey, new Set(["media:ack", "media:abort"]), metadata.chunkCount);
      attachLocalKey(topic, job, assetKey, metadata);
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof TaskError && error.code === "QUOTA_EXCEEDED") throw error;
      post(context, "media:error", {
        assetKey,
        code: error && error.code ? String(error.code).slice(0, 80) : "MEDIA_FETCH_FAILED",
        message: error instanceof Error ? error.message.slice(0, 300) : "媒体下载失败"
      });
    }
  }
  throw lastError || new TaskError("MEDIA_FETCH_FAILED", "媒体下载失败");
}

async function transferTopicMedia(context, topic, topicKey, completed, total) {
  const jobs = mediaTransfer.buildMediaJobs(topic);
  for (let order = 0; order < jobs.length; order += 1) {
    if (context.mediaStorageBlocked) break;
    const job = jobs[order];
    post(context, "progress", {
      stage: "downloading",
      completed,
      total,
      message: `正在下载第 ${completed + 1}/${total} 篇的媒体 ${order + 1}/${jobs.length}`
    });
    try {
      await downloadOneMedia(context, topicKey, topic, job, order);
      context.mediaCompleted += 1;
    } catch (error) {
      const failure = error instanceof TaskError
        ? error
        : new TaskError(error && error.code ? error.code : "MEDIA_FETCH_FAILED", error instanceof Error ? error.message : "媒体下载失败");
      context.mediaFailed += 1;
      if (failure.code === "QUOTA_EXCEEDED") context.mediaStorageBlocked = true;
      post(context, "media:error", {
        assetKey: await mediaTransfer.createAssetKey(topicKey, job.role, order, job.sourceUrl),
        code: failure.code,
        message: failure.message
      });
    }
  }
}
```

Call `await transferTopicMedia(context, topic, key, topics.length, total)` immediately after `collector.buildTopic` and before `topics.push(topic)`. Keep login, captcha, and rate limiting as whole-batch failures; treat only media failures as partial.

Send the final result only after all media work and the task tab has closed:

```js
post(context, "result", {
  topics,
  message: `本机浏览器已抓取 ${topics.length} 条${skippedMessage}`,
  mediaCompleted: context.mediaCompleted,
  mediaFailed: context.mediaFailed
});
```

In the Port listener, use an explicit collect branch:

```js
if (["media:ready", "media:skip", "media:ack", "media:abort"].includes(message.type)) {
  if (active && active.port === port) routeMediaReply(active, message);
  return;
}
if (message.type === "collect") void startCollection(port, originTabId, message);
```

- [ ] **Step 5: Run downloader/protocol tests and inspect forbidden APIs**

```powershell
npx.cmd tsx --test tests/xhs-media-transfer.test.ts tests/xhs-extension-protocol.test.ts
rg -n 'eval\(|new Function|chrome\.cookies|document\.cookie|<all_urls>' browser-extension
```

Expected: tests PASS; `rg` returns no forbidden usage.

- [ ] **Step 6: Commit only background orchestration and its test**

```powershell
git add -- browser-extension/background.js tests/xhs-extension-protocol.test.ts
git diff --cached --check
git commit -m "feat: download topic media during collection"
```

### Task 6: Resolve local media URLs and clean files on topic deletion

**Files:**
- Modify: `types/topic.ts`
- Modify: `lib/xhs-extension-topics.ts`
- Modify: `tests/xhs-extension-topics.test.ts`
- Modify: `app/topics/page.tsx`

- [ ] **Step 1: Write failing pure topic-media tests**

Add to `tests/xhs-extension-topics.test.ts`:

```ts
import {
  mergeExtensionTopics,
  resolveTopicMedia,
  stripTopicLocalMedia,
  topicMediaAssetKeys
} from "../lib/xhs-extension-topics";

test("local keys resolve to Blob URLs while legacy and failed media keep remote URLs", () => {
  const item = topic("media", "防晒", "https://www.xiaohongshu.com/explore/94f0a1b2c3d4e5f60718293d");
  item.media = [
    {
      type: "image",
      url: "https://ci.xiaohongshu.com/a.jpg",
      localAssetKey: "sha256-0123456789abcdef0123456789abcdef"
    },
    { type: "image", url: "https://ci.xiaohongshu.com/failed.jpg" },
    {
      type: "video",
      url: "https://sns-video-qc.xhscdn.com/a.mp4",
      posterUrl: "https://sns-webpic-qc.xhscdn.com/a.jpg",
      localAssetKey: "sha256-11111111111111111111111111111111",
      posterLocalAssetKey: "sha256-22222222222222222222222222222222"
    }
  ];
  const resolved = resolveTopicMedia(item, new Map([
    ["sha256-0123456789abcdef0123456789abcdef", "blob:image"],
    ["sha256-11111111111111111111111111111111", "blob:video"],
    ["sha256-22222222222222222222222222222222", "blob:poster"]
  ]));
  assert.deepEqual(resolved.map((media) => [media.url, media.posterUrl]), [
    ["blob:image", undefined],
    ["https://ci.xiaohongshu.com/failed.jpg", undefined],
    ["blob:video", "blob:poster"]
  ]);
});

test("delete helpers collect and strip every local media reference", () => {
  const item = topic("media", "防晒", "https://www.xiaohongshu.com/explore/94f0a1b2c3d4e5f60718293d");
  item.media = [{
    type: "video",
    url: "https://sns-video-qc.xhscdn.com/a.mp4",
    localAssetKey: "sha256-11111111111111111111111111111111",
    posterLocalAssetKey: "sha256-22222222222222222222222222222222"
  }];
  assert.deepEqual(topicMediaAssetKeys(item), [
    "sha256-11111111111111111111111111111111",
    "sha256-22222222222222222222222222222222"
  ]);
  assert.deepEqual(stripTopicLocalMedia(item).media, [{
    type: "video",
    url: "https://sns-video-qc.xhscdn.com/a.mp4"
  }]);
});
```

Update the existing page source test with these exact assertions; retain the other collection-limit and sort assertions:

```ts
assert.match(source, /createXhsTopicMediaStore\(\)/);
assert.match(source, /createXhsExtensionClient\(window, undefined, mediaStore\)/);
assert.match(source, /resolveTopicMedia\(item, localMediaUrls\)/);
assert.match(source, /URL\.createObjectURL\(blob\)/);
assert.match(source, /URL\.revokeObjectURL\(url\)/);
assert.match(source, /topicMediaStoreRef\.current\?\.deleteAssets\(keysToDelete\)/);
assert.match(source, /navigator\.storage\.persist\(\)/);
assert.match(source, /navigator\.storage\.estimate\(\)/);
assert.doesNotMatch(source, /appendMaterialLibrary|createLibraryAsset/);
assert.doesNotMatch(source, /\/api\/topics\/media-proxy/);
```

- [ ] **Step 2: Run the topic tests and verify they fail**

```powershell
npx.cmd tsx --test tests/xhs-extension-topics.test.ts
```

Expected: FAIL because the new media fields and helper functions do not exist.

- [ ] **Step 3: Extend the Topic media type and pure helpers**

In `types/topic.ts`, replace the inline media item with:

```ts
export interface TopicMedia {
  type: "image" | "video";
  url: string;
  name?: string;
  posterUrl?: string;
  localAssetKey?: string;
  posterLocalAssetKey?: string;
  mimeType?: string;
  size?: number;
}

export interface Topic {
  id: string;
  platform: string;
  title: string;
  contentType: string;
  likes: string;
  views?: string;
  comments: string;
  saves: string;
  risk: "低" | "中" | "高";
  priority: "P0" | "P1" | "P2";
  status: TopicStatus;
  sourceAccount: string;
  fetchedAt: string;
  url?: string;
  authorUrl?: string;
  coverUrl?: string;
  coverType?: "image" | "video";
  media?: TopicMedia[];
  mediaType?: "图文" | "视频";
  keyword?: string;
  parsedContent?: string;
}
```

Add these exports to `lib/xhs-extension-topics.ts`:

```ts
import type { Topic, TopicMedia } from "@/types/topic";

export function topicMediaAssetKeys(item: Topic) {
  return Array.from(new Set((item.media ?? []).flatMap((media) =>
    [media.localAssetKey, media.posterLocalAssetKey].filter((key): key is string => Boolean(key))
  )));
}

export function stripTopicLocalMedia(item: Topic): Topic {
  return {
    ...item,
    media: item.media?.map(({ localAssetKey: _local, posterLocalAssetKey: _poster, mimeType: _mime, size: _size, ...media }) => media)
  };
}

export function resolveTopicMedia(item: Topic, objectUrls: ReadonlyMap<string, string>): TopicMedia[] {
  return (item.media ?? []).map((media) => ({
    ...media,
    url: media.localAssetKey ? objectUrls.get(media.localAssetKey) ?? "" : media.url,
    posterUrl: media.posterLocalAssetKey ? objectUrls.get(media.posterLocalAssetKey) ?? "" : media.posterUrl
  }));
}
```

- [ ] **Step 4: Wire the store and client into the topics page**

Add imports in `app/topics/page.tsx`:

```ts
import { createXhsTopicMediaStore, type XhsTopicMediaStore } from "@/lib/xhs-topic-media-store";
import { mergeExtensionTopics, resolveTopicMedia, stripTopicLocalMedia, topicMediaAssetKeys } from "@/lib/xhs-extension-topics";
```

Add refs/state:

```ts
const topicMediaStoreRef = useRef<XhsTopicMediaStore | null>(null);
const [localMediaUrls, setLocalMediaUrls] = useState<Map<string, string>>(new Map());
```

In the extension setup effect, create one store and pass it to the client:

```ts
const mediaStore = createXhsTopicMediaStore();
topicMediaStoreRef.current = mediaStore;
const client = createXhsExtensionClient(window, undefined, mediaStore);
```

Run abandoned-chunk cleanup before marking the extension ready, then keep the existing compatible/missing/outdated branches:

```ts
void mediaStore.cleanupIncomplete()
  .then(() => client.detect())
  .then(() => {
    if (!mounted) return;
    setExtensionStatus("ready");
    setFeedback("本机抓取扩展已连接，抓取结果只会保存在当前浏览器。");
  })
  .catch((error: unknown) => {
    if (!mounted) return;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("incompatible") || message.includes("upgrade")) {
      setExtensionStatus("outdated");
      setFeedback("本机抓取扩展版本过低，请更新扩展后刷新页面。");
    } else {
      setExtensionStatus("missing");
      setFeedback("未检测到本机抓取扩展，或本机媒体存储无法初始化，请检查后刷新页面。");
    }
  });
```

Use this cleanup body so both refs are released without deleting persisted files:

```ts
return () => {
  mounted = false;
  extensionClientRef.current = null;
  topicMediaStoreRef.current = null;
  client.dispose();
};
```

Add a separate hydration effect that processes `topicRows` and `rejectedTopics`, not the left material library:

```ts
useEffect(() => {
  if (!hydrated || !topicMediaStoreRef.current) return;
  let cancelled = false;
  const created: string[] = [];
  const keys = Array.from(new Set([...topicRows, ...rejectedTopics].flatMap(topicMediaAssetKeys)));
  void Promise.all(keys.map(async (key) => {
    try {
      const blob = await topicMediaStoreRef.current!.getBlob(key);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      created.push(url);
      return [key, url] as const;
    } catch {
      return null;
    }
  })).then((entries) => {
    if (cancelled) {
      for (const url of created) URL.revokeObjectURL(url);
      return;
    }
    setLocalMediaUrls(new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
  });
  return () => {
    cancelled = true;
    for (const url of created) URL.revokeObjectURL(url);
  };
}, [hydrated, rejectedTopics, topicRows]);
```

After collection resolves and topics merge, the state change above loads every new local key. Show precise counters:

```ts
setFeedback(result.topics.length
  ? `本机抓取完成：返回 ${result.topics.length} 条，本地媒体成功 ${result.mediaCompleted} 个、失败 ${result.mediaFailed} 个。`
  : (result.message || "这次没有新增内容：可能已经重复，或当前筛选条件下没有新笔记。"));
```

Before closing the collection modal, request persistent browser storage when supported and stop immediately only when the browser reports zero remaining quota:

```ts
if (navigator.storage) {
  await navigator.storage.persist().catch(() => false);
  const estimate = await navigator.storage.estimate().catch(() => null);
  if (estimate?.quota && (estimate.usage ?? 0) >= estimate.quota) {
    setFeedback("本机浏览器存储空间不足，请先清理空间后再抓取。");
    return;
  }
}
```

Place this after task input validation and before `setCollectOpen(false)`. Do not impose a made-up per-file size cap; quota write failures still follow the partial-preservation flow.

Pass `localMediaUrls` into `TopicCard`:

```tsx
<TopicCard
  key={item.id}
  item={item}
  localMediaUrls={localMediaUrls}
  mode={listMode === "approved" || item.status === "approved" ? "approved" : "candidate"}
  listMode={listMode === "approved" ? "approved" : "all"}
  onPreview={() => openTopicPreview(item)}
  onMediaPreview={(media) => setPreviewMedia({
    title: item.title,
    url: media.url,
    type: media.type,
    name: media.name,
    posterUrl: media.posterUrl
  })}
  onApprove={() => approveTopic(item)}
  onCancelApprove={() => cancelApproveTopic(item)}
  onDelete={() => void deleteTopic(item)}
/>
```

Add the prop to `TopicCard` and resolve it inside the card:

```ts
function TopicCard({
  item,
  localMediaUrls,
  mode,
  listMode,
  onPreview,
  onMediaPreview,
  onApprove,
  onCancelApprove,
  onDelete
}: {
  item: Topic;
  localMediaUrls: ReadonlyMap<string, string>;
  mode: "candidate" | "approved";
  listMode: "all" | "approved";
  onPreview: () => void;
  onMediaPreview: (media: { type: "image" | "video"; url: string; name?: string; posterUrl?: string }) => void;
  onApprove: () => void;
  onCancelApprove: () => void;
  onDelete: () => void;
}) {
const mediaItems = resolveTopicMedia(item, localMediaUrls).filter((media) => media.url);
```

The card and preview then receive Blob URLs for completed media. Historical topics and failed downloads have no local key and continue using their existing remote URLs. Keep `buildGenerationHref` on the original topic metadata so a Blob URL is never persisted into navigation parameters.

- [ ] **Step 5: Delete files while preserving the existing soft-delete UI behavior**

Make `deleteTopic` asynchronous. Compute references held by every other visible/rejected topic, delete only unreferenced local files, and strip local keys from the row placed in the deleted list:

```ts
const deleteTopic = async (item: Topic) => {
  const remaining = [...topicRows, ...rejectedTopics, ...deletedTopics]
    .filter((row) => topicUrl(row) !== topicUrl(item));
  const retainedKeys = new Set(remaining.flatMap(topicMediaAssetKeys));
  const keysToDelete = topicMediaAssetKeys(item).filter((key) => !retainedKeys.has(key));
  try {
    await topicMediaStoreRef.current?.deleteAssets(keysToDelete);
  } catch (error) {
    setFeedback(error instanceof Error ? `删除本地媒体失败：${error.message}` : "删除本地媒体失败。");
    return;
  }
  const nextItem: Topic = { ...stripTopicLocalMedia(item), status: "pending" };
  setDeletedTopics((items) => [nextItem, ...items.filter((row) => topicUrl(row) !== topicUrl(item))]);
  setTopicRows((rows) => rows.filter((row) => topicUrl(row) !== topicUrl(item)));
  setFeedback(`已删除选题及其本地媒体：${item.title}。不会加入拒绝名单。`);
};
```

Call it without returning an unhandled promise:

```tsx
onDelete={() => void deleteTopic(item)}
```

Do not call `deleteAssets` from approve, cancel-approve, reject, or restore functions.

- [ ] **Step 6: Run topic/store/client tests and build**

```powershell
npx.cmd tsx --test tests/xhs-extension-topics.test.ts tests/xhs-topic-media-store.test.ts tests/xhs-extension-client.test.ts
npm.cmd run build
```

Expected: all tests PASS; Next production build completes.

- [ ] **Step 7: Commit only topic types, helpers, page, and tests**

```powershell
git add -- types/topic.ts lib/xhs-extension-topics.ts app/topics/page.tsx tests/xhs-extension-topics.test.ts
git diff --cached --check
git commit -m "feat: render local media in topic cards"
```

### Task 7: Verify partial failures, cleanup, and regressions as one integrated change

**Files:**
- Modify if a discovered assertion requires it: only files already named in Tasks 1-6
- Test: all `tests/xhs-*.test.ts`

- [ ] **Step 1: Run the complete XHS extension suite**

```powershell
npx.cmd tsx --test tests/xhs-extension-client.test.ts tests/xhs-extension-protocol.test.ts tests/xhs-extension-task-state.test.ts tests/xhs-extension-collector.test.ts tests/xhs-extension-topics.test.ts tests/xhs-media-transfer.test.ts tests/xhs-topic-media-store.test.ts tests/xhs-server-routes-disabled.test.ts
```

Expected: PASS. This includes the pre-existing dirty collector test and confirms the media work did not regress search, filters, detail clicking, full copy extraction, or server-route disabling.

- [ ] **Step 2: Run the complete project test and build gates**

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: all tests PASS, build succeeds, and `git diff --check` prints no errors.

- [ ] **Step 3: Audit the exact data boundaries**

Run:

```powershell
rg -n 'content-production-studio-xhs-topic-media|media:start|media:chunk|media:complete|media:ack|media:abort' browser-extension lib app tests
rg -n 'appendMaterialLibrary|createLibraryAsset|content-production-studio-assets|/api/topics/media-proxy' app/topics/page.tsx lib/xhs-topic-media-store.ts browser-extension
rg -n 'fetch\(' app/topics/page.tsx lib/xhs-topic-media-store.ts
```

Expected:

- The first command finds the dedicated store and protocol flow.
- The second finds no material-library write or media-proxy use in the new path.
- The third finds no website-side remote media download; only the extension background downloader performs remote fetches.

- [ ] **Step 4: Review all feature commits and preserve unrelated dirty files**

```powershell
git status --short
git log --oneline --decorate -8
git diff -- browser-extension/xhs-content.js tests/xhs-extension-collector.test.ts
```

Expected: no uncommitted changes from Tasks 1-6 remain. The two previously dirty files may still appear and must retain their original filter/detail fixes.

If verification requires a correction, stage only the named feature files and make one focused commit:

```powershell
git add -- browser-extension/shared/protocol.js browser-extension/shared/media-transfer.js browser-extension/background.js browser-extension/app-bridge.js browser-extension/manifest.template.json lib/xhs-topic-media-store.ts lib/xhs-extension-client.ts lib/xhs-extension-topics.ts types/topic.ts app/topics/page.tsx tests/xhs-extension-protocol.test.ts tests/xhs-media-transfer.test.ts tests/xhs-topic-media-store.test.ts tests/xhs-extension-client.test.ts tests/xhs-extension-topics.test.ts package.json package-lock.json
git diff --cached --check
git commit -m "fix: complete xhs local media lifecycle"
```

### Task 8: Document, package, deploy, and perform a real browser acceptance run

**Files:**
- Modify: `docs/xhs-browser-extension-install.md`
- Generated: `exports/xhs-browser-extension-0.1.11/`
- Generated: `exports/xhs-browser-extension-0.1.11.zip`

- [ ] **Step 1: Update the install/upgrade guide**

Add an `0.1.11` section to `docs/xhs-browser-extension-install.md` containing these exact operator facts:

```markdown
## 0.1.11 本机媒体保存

- 新抓取的正文图片、视频和视频封面会下载到当前浏览器站点数据中的专用 IndexedDB。
- 媒体仍显示在“爆款选题库”卡片内，不会进入左侧“素材库”。
- 清除该网站的浏览器站点数据会同时清除这些本机媒体文件。
- 删除选题会删除对应本机媒体；保留、取消保留和拒绝不会删除媒体。
- 单个媒体失败时，其余成功媒体和选题文案仍会保留，批次继续执行。
- 网页协议和扩展必须同时升级；旧扩展会显示“版本过低”。
```

Append these exact upgrade steps under that section:

```markdown
### 从旧版升级

1. 先等待新版网页部署完成；网页和扩展协议必须同为版本 2。
2. 在 `chrome://extensions` 或 `edge://extensions` 停用或移除旧的解压扩展。
3. 解压 `xhs-browser-extension-0.1.11.zip`，开启开发者模式并点击“加载已解压的扩展程序”。
4. 选择解压后的 `xhs-browser-extension-0.1.11` 文件夹。
5. 后续替换文件时先在扩展管理页点击“重新加载”，再刷新生产网站。
6. 回到“爆款选题库”，确认状态显示“本机抓取已连接”后再开始抓取。
```

- [ ] **Step 2: Run the final automated gate before packaging**

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: PASS with no whitespace errors.

- [ ] **Step 3: Package extension version 0.1.11 for production**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-xhs-browser-extension.ps1 -AppOrigin 'https://xhstw.qycm.top' -Version '0.1.11'
```

Expected: the script prints the absolute ZIP path and SHA256 for `exports/xhs-browser-extension-0.1.11.zip`.

- [ ] **Step 4: Inspect the generated package**

```powershell
$manifest = Get-Content -LiteralPath 'exports\xhs-browser-extension-0.1.11\manifest.json' -Raw -Encoding utf8 | ConvertFrom-Json
$manifest.version
$manifest.host_permissions
tar -tf 'exports\xhs-browser-extension-0.1.11.zip'
Get-FileHash -Algorithm SHA256 -LiteralPath 'exports\xhs-browser-extension-0.1.11.zip'
```

Expected:

- Version is `0.1.11`.
- App permission is `https://xhstw.qycm.top/*`.
- XHS permissions are restricted to `www.xiaohongshu.com`, `*.xiaohongshu.com`, and `*.xhscdn.com` over HTTPS.
- ZIP includes `background.js`, `app-bridge.js`, `xhs-content.js`, `shared/media-transfer.js`, other shared scripts, `manifest.json`, and `安装说明.md`.

- [ ] **Step 5: Commit the guide, not the ignored package artifacts**

```powershell
git add -- docs/xhs-browser-extension-install.md
git diff --cached --check
git commit -m "docs: explain local xhs media storage"
```

- [ ] **Step 6: Stop at the external deployment boundary and obtain publication authorization**

Show the exact commit and branch that passed verification:

```powershell
git status --short
git log -1 --oneline
git branch --show-current
```

Do not push merely because the local plan reached this step. After the user explicitly authorizes publication to GitHub main, publish the verified commit with:

```powershell
git push origin HEAD:main
```

Expected: Git reports the new main commit on `github.com/zxc9802/xhstw`. Wait for the repository-connected Zeabur production service to deploy that commit, then refresh `https://xhstw.qycm.top/topics` and confirm the new page rejects protocol-v1 extensions as outdated. Do not run the protocol-v2 extension against an older deployed page.

- [ ] **Step 7: Run real browser acceptance with one image note and one video note**

In the logged-in user Chrome/Edge profile:

1. Load the unpacked `exports/xhs-browser-extension-0.1.11` directory and refresh `https://xhstw.qycm.top/topics`.
2. Confirm the page says “本机抓取已连接”.
3. Capture one multi-image note and one video note using a user-selected sort method.
4. Confirm every image appears in the existing card strip, the video card shows its poster, and the preview plays the video.
5. In DevTools > Application > IndexedDB, confirm `content-production-studio-xhs-topic-media` contains complete manifests and chunks.
6. Switch DevTools Network to Offline and refresh the topics page. Confirm the captured images/poster display and the video plays.
7. Delete one captured topic. Confirm its manifest/chunks disappear and the other topic still works.
8. Toggle 保留/取消保留 on the remaining topic. Confirm its manifests/chunks remain.
9. Confirm the left navigation “素材库” has no new entries from this capture.

- [ ] **Step 8: Record final evidence before any push**

```powershell
git status --short
git log -1 --oneline
Get-FileHash -Algorithm SHA256 -LiteralPath 'exports\xhs-browser-extension-0.1.11.zip'
```

Expected: committed feature files are clean; only previously preserved dirty files or intentionally ignored package artifacts remain. Record the test command results, build result, real-browser image/video/offline/delete checks, ZIP path, and SHA256 in the handoff. A GitHub push requires a separate explicit user request.

## Spec coverage checklist

- All正文 images: Tasks 2 and 5 construct and download every image job.
- Video plus poster: Tasks 2, 5, and 6 handle separate local keys and card/preview URLs.
- Current computer/browser only: Task 3 uses a dedicated IndexedDB; Task 7 audits out server and material-library paths.
- Existing red-box card area: Task 6 changes only the media source used by the current card and preview.
- Partial failure and quota behavior: Tasks 4 and 5 abort one media, preserve completed files/topics, and stop later media only for quota exhaustion.
- Deduplication: stable asset keys plus `prepare -> skip` in Tasks 2-4 avoid repeated downloads.
- Delete versus keep lifecycle: Task 6 deletes unreferenced assets only on delete; keep/reject flows remain unchanged.
- New captures only: Task 6 resolves only topics carrying new local keys and does not backfill old rows.
- Old extension rejection: Tasks 1 and 4 raise the protocol to version 2; Task 8 requires matching deployment and reload.
- Security: Tasks 1, 2, 5, and 7 enforce HTTPS host/MIME/redirect/message bounds and audit forbidden permissions.
