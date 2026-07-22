# User Browser XHS Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace production server-side Xiaohongshu collection with a one-click Chrome/Edge extension flow that runs entirely in each user's own visible browser and returns results to that user's existing local topic library.

**Architecture:** The website communicates with a Manifest V3 extension through a narrowly scoped content-script bridge. The extension service worker owns one local task at a time, navigates a visible Xiaohongshu tab, invokes fixed search/detail collectors, and sends progress and `Topic` results back to the originating website tab. Existing server collection and media-proxy routes return `410 Gone`, so missing or failed extensions never fall back to the server.

**Tech Stack:** Next.js 15, React 19, TypeScript, Node `node:test`/`tsx`, Manifest V3 Chrome/Edge extension, plain browser JavaScript, PowerShell packaging.

---

## File map

### Website files

- Create `lib/xhs-extension-client.ts` — typed page-to-extension protocol, detection, progress, result, cancellation, and timeout handling.
- Create `lib/xhs-extension-topics.ts` — pure construction/merge helpers for extension topics.
- Modify `app/topics/page.tsx` — extension status UI, one-click collection, progress display, two-keyword/five-result limits, and direct browser media URLs.
- Modify `app/api/topics/opencli-xhs/route.ts` — permanent `410 Gone` response.
- Modify `app/api/topics/open-xhs-link/route.ts` — permanent `410 Gone` response.
- Modify `app/api/topics/media-proxy/route.ts` — permanent `410 Gone` response.

### Extension files

- Create `browser-extension/manifest.template.json` — least-privilege MV3 manifest with a packaging-time application origin token.
- Create `browser-extension/shared/protocol.js` — extension-side constants and task/envelope validation.
- Create `browser-extension/shared/collector.js` — pure Xiaohongshu page detection, card/detail parsing, normalization, and `Topic` mapping.
- Create `browser-extension/shared/task-state.js` — pure single-task and cooldown state transitions.
- Create `browser-extension/app-bridge.js` — website content script and long-lived extension port.
- Create `browser-extension/xhs-content.js` — fixed page filter/search/detail actions.
- Create `browser-extension/background.js` — visible-tab orchestration, pacing, cleanup, and error routing.

### Tests, fixtures, and delivery

- Create `tests/xhs-extension-client.test.ts`.
- Create `tests/xhs-extension-protocol.test.ts`.
- Create `tests/xhs-extension-collector.test.ts`.
- Create `tests/xhs-extension-task-state.test.ts`.
- Create `tests/xhs-extension-topics.test.ts`.
- Create `tests/xhs-server-routes-disabled.test.ts`.
- Create `tests/fixtures/xhs-search.html` and `tests/fixtures/xhs-detail.html`.
- Modify `package.json` and `package-lock.json` — add `linkedom` as a test-only DOM parser.
- Create `scripts/package-xhs-browser-extension.ps1`.
- Create `docs/xhs-browser-extension-install.md`.

## Protocol decisions locked for implementation

Use these exact envelope values on both the website and extension sides:

```ts
const CHANNEL = "content-production-studio.xhs-extension";
const PROTOCOL_VERSION = 1;

type PageMessageType = "ping" | "collect" | "cancel";
type ExtensionMessageType = "pong" | "progress" | "result" | "error";

type XhsCollectTask = {
  requestId: string;
  queries: string[];
  limitPerQuery: number;
  mediaType: "全部" | "图文" | "视频";
  dateRange: "全部" | "一天内" | "一周内" | "半年内";
  sortBy: "浏览量" | "点赞量" | "评论量" | "收藏量";
  existingUrls: string[];
};
```

Every message contains `channel`, `protocolVersion`, `direction`, `type`, and `requestId`. The page uses `direction: "page-to-extension"`; the extension uses `direction: "extension-to-page"`. The extension rejects tasks with more than two keywords, more than five results per keyword, unknown enum values, a missing UUID-shaped request ID, or non-string existing URLs.

---

### Task 1: Build and test the website-side extension client

**Files:**
- Create: `lib/xhs-extension-client.ts`
- Test: `tests/xhs-extension-client.test.ts`

- [ ] **Step 1: Write the failing client tests**

Create a small fake message target and cover detection, streamed progress, final results, error propagation, and disposal:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  XHS_EXTENSION_CHANNEL,
  XHS_EXTENSION_PROTOCOL_VERSION,
  createXhsExtensionClient
} from "../lib/xhs-extension-client";

class FakeMessageTarget {
  readonly origin = "https://studio.example.test";
  readonly sent: unknown[] = [];
  private listeners = new Set<(event: MessageEvent) => void>();

  postMessage(message: unknown) {
    this.sent.push(message);
  }

  addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }

  emit(data: unknown) {
    for (const listener of this.listeners) {
      listener({ data, origin: this.origin, source: this } as unknown as MessageEvent);
    }
  }
}

test("detects a compatible local extension", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target);
  const pending = client.detect();
  const request = target.sent[0] as { requestId: string };
  target.emit({
    channel: XHS_EXTENSION_CHANNEL,
    protocolVersion: XHS_EXTENSION_PROTOCOL_VERSION,
    direction: "extension-to-page",
    type: "pong",
    requestId: request.requestId,
    payload: { version: "0.1.0" }
  });
  assert.deepEqual(await pending, { version: "0.1.0", protocolVersion: 1 });
  client.dispose();
});

test("streams progress before resolving collection results", async () => {
  const target = new FakeMessageTarget();
  const client = createXhsExtensionClient(target);
  const progress: string[] = [];
  const requestId = "11111111-1111-4111-8111-111111111111";
  const pending = client.collect({
    requestId,
    queries: ["防晒"],
    limitPerQuery: 2,
    mediaType: "图文",
    dateRange: "一周内",
    sortBy: "点赞量",
    existingUrls: []
  }, (event) => progress.push(event.message));

  target.emit({
    channel: XHS_EXTENSION_CHANNEL,
    protocolVersion: 1,
    direction: "extension-to-page",
    type: "progress",
    requestId,
    payload: { stage: "searching", completed: 0, total: 2, message: "正在搜索防晒" }
  });
  target.emit({
    channel: XHS_EXTENSION_CHANNEL,
    protocolVersion: 1,
    direction: "extension-to-page",
    type: "result",
    requestId,
    payload: { topics: [], message: "抓取完成" }
  });

  assert.deepEqual(progress, ["正在搜索防晒"]);
  assert.deepEqual(await pending, { topics: [], message: "抓取完成" });
  client.dispose();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="compatible local extension|streams progress" tests/**/*.test.ts
```

Expected: FAIL because `lib/xhs-extension-client.ts` does not exist.

- [ ] **Step 3: Implement the typed client**

Implement the constants and exported types shown in “Protocol decisions”, plus:

```ts
export interface ExtensionProgress {
  stage: "opening" | "searching" | "enriching";
  completed: number;
  total: number;
  message: string;
}

export interface ExtensionCollectResult {
  topics: Topic[];
  message: string;
}

export interface MessageTargetLike {
  readonly origin: string;
  postMessage(message: unknown, targetOrigin?: string): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export function createXhsExtensionClient(
  target: MessageTargetLike = window as unknown as MessageTargetLike,
  timeoutMs = 2_000
) {
  const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    onProgress?: (progress: ExtensionProgress) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  const onMessage = (event: MessageEvent) => {
    const message = event.data as Record<string, unknown>;
    if (event.source !== target || event.origin !== target.origin) return;
    if (message.channel !== XHS_EXTENSION_CHANNEL) return;
    if (message.direction !== "extension-to-page" || typeof message.requestId !== "string") return;
    const request = pending.get(message.requestId);
    if (!request) return;
    if (message.protocolVersion !== XHS_EXTENSION_PROTOCOL_VERSION) {
      clearTimeout(request.timer);
      pending.delete(message.requestId);
      request.reject(new Error("本机抓取扩展版本不兼容，请升级扩展"));
      return;
    }
    if (message.type === "progress") {
      request.onProgress?.(message.payload as ExtensionProgress);
      return;
    }
    clearTimeout(request.timer);
    pending.delete(message.requestId);
    if (message.type === "error") {
      const payload = message.payload as { code?: string; message?: string };
      request.reject(new Error(payload.message || payload.code || "本机抓取扩展执行失败"));
      return;
    }
    request.resolve(message.payload);
  };

  target.addEventListener("message", onMessage);

  const send = <T>(
    type: "ping" | "collect" | "cancel",
    requestId: string,
    payload: unknown,
    onProgress?: (progress: ExtensionProgress) => void
  ) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(type === "ping" ? "未检测到本机抓取扩展" : "本机抓取扩展响应超时"));
    }, type === "ping" ? timeoutMs : 10 * 60_000);
    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, onProgress, timer });
    target.postMessage({
      channel: XHS_EXTENSION_CHANNEL,
      protocolVersion: XHS_EXTENSION_PROTOCOL_VERSION,
      direction: "page-to-extension",
      type,
      requestId,
      payload
    }, target.origin);
  });

  return {
    detect: async () => {
      const requestId = crypto.randomUUID();
      const payload = await send<{ version: string }>("ping", requestId, {});
      return { version: payload.version, protocolVersion: XHS_EXTENSION_PROTOCOL_VERSION };
    },
    collect: (task: XhsCollectTask, onProgress?: (progress: ExtensionProgress) => void) =>
      send<ExtensionCollectResult>("collect", task.requestId, task, onProgress),
    cancel: (requestId: string) => send<void>("cancel", requestId, {}),
    dispose: () => {
      target.removeEventListener("message", onMessage);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("本机抓取连接已关闭"));
      }
      pending.clear();
    }
  };
}
```

Import `Topic` from `@/types/topic`. Export the protocol constants, task type, progress type, result type, and factory.

- [ ] **Step 4: Run the focused tests and type check**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="compatible local extension|streams progress" tests/**/*.test.ts
npx.cmd tsc --noEmit
```

Expected: both client tests PASS; TypeScript exits 0.

- [ ] **Step 5: Commit Task 1**

```powershell
git add lib/xhs-extension-client.ts tests/xhs-extension-client.test.ts
git commit -m "feat: add xhs extension web client"
```

---

### Task 2: Define the extension protocol and least-privilege manifest

**Files:**
- Create: `browser-extension/manifest.template.json`
- Create: `browser-extension/shared/protocol.js`
- Test: `tests/xhs-extension-protocol.test.ts`

- [ ] **Step 1: Write failing protocol and permission tests**

Load `protocol.js` through `createRequire` and parse the manifest template:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("extension task validation enforces the approved limits", () => {
  const protocol = require("../browser-extension/shared/protocol.js");
  const valid = {
    requestId: "11111111-1111-4111-8111-111111111111",
    queries: ["防晒", "通勤护肤"],
    limitPerQuery: 5,
    mediaType: "全部",
    dateRange: "一周内",
    sortBy: "点赞量",
    existingUrls: []
  };
  assert.equal(protocol.validateTask(valid).ok, true);
  assert.equal(protocol.validateTask({ ...valid, queries: ["a", "b", "c"] }).ok, false);
  assert.equal(protocol.validateTask({ ...valid, limitPerQuery: 6 }).ok, false);
});

test("manifest never requests cookie, history, or all-url access", () => {
  const manifest = JSON.parse(fs.readFileSync("browser-extension/manifest.template.json", "utf8"));
  const permissions = [...(manifest.permissions || []), ...(manifest.host_permissions || [])];
  assert.equal(permissions.includes("cookies"), false);
  assert.equal(permissions.includes("history"), false);
  assert.equal(permissions.includes("<all_urls>"), false);
  assert.deepEqual(manifest.host_permissions, [
    "https://www.xiaohongshu.com/*",
    "__APP_MATCH_PATTERN__"
  ]);
});
```

- [ ] **Step 2: Run the protocol tests and verify they fail**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="approved limits|all-url access" tests/**/*.test.ts
```

Expected: FAIL because both extension files are absent.

- [ ] **Step 3: Create the manifest template**

Use this exact manifest:

```json
{
  "manifest_version": 3,
  "name": "小红书本机抓取助手",
  "version": "0.1.0",
  "description": "在用户自己的浏览器中执行内容生产中台下达的小红书公开页面抓取任务。",
  "permissions": ["storage", "tabs"],
  "host_permissions": [
    "https://www.xiaohongshu.com/*",
    "__APP_MATCH_PATTERN__"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["http://127.0.0.1:3000/*", "__APP_MATCH_PATTERN__"],
      "js": ["shared/protocol.js", "app-bridge.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["https://www.xiaohongshu.com/*"],
      "js": ["shared/protocol.js", "shared/collector.js", "xhs-content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_title": "小红书本机抓取助手"
  }
}
```

- [ ] **Step 4: Implement `shared/protocol.js`**

Use a CommonJS/global wrapper so Node tests and classic extension scripts share the same implementation:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.XhsExtensionProtocol = api;
})(globalThis, function () {
  const CHANNEL = "content-production-studio.xhs-extension";
  const PROTOCOL_VERSION = 1;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const allowed = {
    mediaType: new Set(["全部", "图文", "视频"]),
    dateRange: new Set(["全部", "一天内", "一周内", "半年内"]),
    sortBy: new Set(["浏览量", "点赞量", "评论量", "收藏量"])
  };

  function validateTask(task) {
    if (!task || typeof task !== "object") return { ok: false, error: "任务格式无效" };
    if (!UUID.test(String(task.requestId || ""))) return { ok: false, error: "任务编号无效" };
    if (!Array.isArray(task.queries) || task.queries.length < 1 || task.queries.length > 2) {
      return { ok: false, error: "每次只能抓取 1 到 2 个关键词" };
    }
    if (task.queries.some((value) => typeof value !== "string" || !value.trim() || value.length > 40)) {
      return { ok: false, error: "关键词格式无效" };
    }
    if (!Number.isInteger(task.limitPerQuery) || task.limitPerQuery < 1 || task.limitPerQuery > 5) {
      return { ok: false, error: "每个关键词只能抓取 1 到 5 篇" };
    }
    if (!allowed.mediaType.has(task.mediaType)
      || !allowed.dateRange.has(task.dateRange)
      || !allowed.sortBy.has(task.sortBy)) {
      return { ok: false, error: "筛选参数无效" };
    }
    if (!Array.isArray(task.existingUrls) || task.existingUrls.some((value) => typeof value !== "string")) {
      return { ok: false, error: "去重链接格式无效" };
    }
    return { ok: true };
  }

  function isEnvelope(message, direction) {
    return Boolean(message)
      && message.channel === CHANNEL
      && message.protocolVersion === PROTOCOL_VERSION
      && message.direction === direction
      && UUID.test(String(message.requestId || ""));
  }

  return Object.freeze({ CHANNEL, PROTOCOL_VERSION, validateTask, isEnvelope });
});
```

- [ ] **Step 5: Run protocol tests**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="approved limits|all-url access" tests/**/*.test.ts
```

Expected: both tests PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add browser-extension/manifest.template.json browser-extension/shared/protocol.js tests/xhs-extension-protocol.test.ts
git commit -m "feat: define xhs extension protocol"
```

---

### Task 3: Extract a testable Xiaohongshu page collector

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `browser-extension/shared/collector.js`
- Create: `tests/fixtures/xhs-search.html`
- Create: `tests/fixtures/xhs-detail.html`
- Test: `tests/xhs-extension-collector.test.ts`

- [ ] **Step 1: Add the test-only DOM dependency**

Run:

```powershell
npm.cmd install --save-dev linkedom
```

Expected: `linkedom` appears under `devDependencies` and the lockfile updates.

- [ ] **Step 2: Create representative HTML fixtures**

The search fixture must contain two `section.note-item` cards with title links, authors, metrics, dates, and images. The detail fixture must contain a title, author, content, published date, three metrics, two images, and no block marker. Use stable example URLs under `https://www.xiaohongshu.com/search_result/<24-hex-id>` and `https://sns-webpic-qc.xhscdn.com/example.webp`.

- [ ] **Step 3: Write the failing collector tests**

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);
const collector = require("../browser-extension/shared/collector.js");

test("parses search cards into normalized local-browser topics", () => {
  const { document } = parseHTML(fs.readFileSync("tests/fixtures/xhs-search.html", "utf8"));
  const rows = collector.parseSearchCards(document, "防晒", 2);
  assert.equal(rows.length, 2);
  assert.match(rows[0].url, /^https:\/\/www\.xiaohongshu\.com\/explore\//);
  assert.equal(rows[0].title, "通勤防晒实测");
  assert.equal(rows[0].author, "测试作者");
});

test("parses detail fields and detects security blocks", () => {
  const { document } = parseHTML(fs.readFileSync("tests/fixtures/xhs-detail.html", "utf8"));
  const detail = collector.parseDetail(document, "通勤防晒实测");
  assert.equal(detail.title, "通勤防晒实测");
  assert.equal(detail.content, "这是一段公开笔记正文 #防晒");
  assert.equal(detail.media.length, 2);
  assert.deepEqual(collector.detectPageState("安全限制 访问频繁 300013"), {
    ok: false,
    code: "RATE_LIMITED",
    message: "小红书提示访问频繁，请稍后再试"
  });
});
```

- [ ] **Step 4: Run the collector tests and verify they fail**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="normalized local-browser topics|security blocks" tests/**/*.test.ts
```

Expected: FAIL because `collector.js` is absent.

- [ ] **Step 5: Implement the pure collector**

Expose these functions from the same CommonJS/global wrapper pattern as `protocol.js`:

```js
function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function detectPageState(text) {
  const value = clean(text);
  if (/300013|安全限制|访问频繁/.test(value)) {
    return { ok: false, code: "RATE_LIMITED", message: "小红书提示访问频繁，请稍后再试" };
  }
  if (/验证码|请完成验证|滑块验证/.test(value)) {
    return { ok: false, code: "CAPTCHA", message: "小红书需要人工验证" };
  }
  if (/登录后查看|手机号登录|扫码登录/.test(value) && !/退出登录|个人中心/.test(value)) {
    return { ok: false, code: "LOGIN_REQUIRED", message: "请先在当前浏览器登录小红书" };
  }
  return { ok: true };
}

function noteId(url) {
  return String(url || "").match(/(?:explore|discovery\/item|search_result)\/([0-9a-f]{16,32})/i)?.[1] || "";
}

function normalizeNoteUrl(url) {
  const id = noteId(url);
  if (!id) return String(url || "");
  const parsed = new URL(url, "https://www.xiaohongshu.com");
  const next = new URL("https://www.xiaohongshu.com/explore/" + id);
  for (const key of ["xsec_token", "xsec_source"]) {
    const value = parsed.searchParams.get(key);
    if (value) next.searchParams.set(key, value);
  }
  if (!next.searchParams.has("xsec_source")) next.searchParams.set("xsec_source", "pc_search");
  return next.toString();
}

function parseSearchCards(document, query, limit) {
  const cards = Array.from(document.querySelectorAll("section.note-item, .note-item, [data-note-id]"));
  return cards.slice(0, limit).map((card) => {
    const link = Array.from(card.querySelectorAll("a"))
      .map((node) => node.href || node.getAttribute("href") || "")
      .find((href) => /\/(?:search_result|explore)\//.test(href)) || "";
    const metricText = clean(card.textContent);
    const image = card.querySelector("img");
    return {
      title: clean(card.querySelector(".title, [class*=title]")?.textContent),
      author: clean(card.querySelector(".author, [class*=author], [class*=user]")?.textContent),
      url: normalizeNoteUrl(link),
      coverUrl: image?.currentSrc || image?.src || image?.getAttribute("src") || "",
      likes: metricText.match(/(?:点赞)?\s*([\d.]+\s*(?:万|w|W|k|K|\+)?)/)?.[1] || "",
      publishedAt: metricText.match(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}-\d{1,2}|今天|昨天/)?.[0] || "",
      query
    };
  }).filter((row) => row.title && row.url);
}

function parseDetail(document, expectedTitle) {
  const bodyText = clean(document.body?.innerText || document.body?.textContent);
  const state = detectPageState(bodyText);
  if (!state.ok) return state;
  const images = Array.from(document.querySelectorAll("img"))
    .map((image) => image.currentSrc || image.src || image.getAttribute("src") || "")
    .filter((url, index, all) => /^https?:\/\//.test(url) && all.indexOf(url) === index)
    .filter((url) => !/avatar|profile|icon|emoji|comment/i.test(url))
    .slice(0, 10);
  return {
    ok: true,
    title: clean(document.querySelector(".title, [class*=title]")?.textContent) || expectedTitle,
    author: clean(document.querySelector(".author, [class*=author], [class*=user]")?.textContent),
    content: clean(document.querySelector(".content, .desc, [class*=content], [class*=desc]")?.textContent),
    publishedAt: bodyText.match(/20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}-\d{1,2}|今天|昨天/)?.[0] || "",
    media: images.map((url, index) => ({ type: "image", url, name: "详情图片 " + (index + 1) }))
  };
}
```

Also expose this `buildTopic` implementation:

```js
function buildTopic(row, detail, now) {
  const resolvedDetail = detail && detail.ok ? detail : {};
  const media = Array.isArray(resolvedDetail.media) && resolvedDetail.media.length
    ? resolvedDetail.media
    : (row.coverUrl ? [{ type: "image", url: row.coverUrl, name: "搜索封面" }] : []);
  const id = noteId(row.url) || clean(row.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40);
  return {
    id: "local_xhs_" + id,
    platform: "小红书",
    title: resolvedDetail.title || row.title,
    contentType: media.some((item) => item.type === "video") ? "小红书视频" : "小红书图文",
    likes: row.likes || "-",
    views: row.views || "-",
    comments: resolvedDetail.comments || row.comments || "-",
    saves: resolvedDetail.saves || row.saves || "-",
    risk: "低",
    priority: "P2",
    status: "pending",
    sourceAccount: "本机浏览器 · " + (resolvedDetail.author || row.author || "小红书公开页面"),
    fetchedAt: resolvedDetail.publishedAt || row.publishedAt || now,
    url: normalizeNoteUrl(row.url),
    authorUrl: row.authorUrl || undefined,
    coverUrl: media[0]?.url || row.coverUrl || undefined,
    coverType: media[0]?.type || "image",
    media,
    mediaType: media.some((item) => item.type === "video") ? "视频" : "图文",
    keyword: row.query,
    parsedContent: resolvedDetail.content || ""
  };
}
```

- [ ] **Step 6: Run collector tests**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="normalized local-browser topics|security blocks" tests/**/*.test.ts
```

Expected: both collector tests PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add package.json package-lock.json browser-extension/shared/collector.js tests/fixtures/xhs-search.html tests/fixtures/xhs-detail.html tests/xhs-extension-collector.test.ts
git commit -m "feat: add local xhs page collector"
```

---

### Task 4: Add single-task and cooldown state

**Files:**
- Create: `browser-extension/shared/task-state.js`
- Test: `tests/xhs-extension-task-state.test.ts`

- [ ] **Step 1: Write failing state tests**

Cover `idle -> opening -> searching -> enriching -> completed`, rejection of a second task, and the exact 60-minute cooldown after `RATE_LIMITED`:

```ts
test("rate limits the browser for exactly sixty minutes", () => {
  const now = Date.parse("2026-07-22T10:00:00+08:00");
  const started = state.startTask(state.initialState(), "task-1", 7, now);
  const blocked = state.failTask(started, "RATE_LIMITED", now);
  assert.equal(blocked.cooldownUntil, now + 60 * 60_000);
  assert.equal(state.canStart(blocked, now + 59 * 60_000).ok, false);
  assert.equal(state.canStart(blocked, now + 60 * 60_000).ok, true);
});
```

- [ ] **Step 2: Run the state test and verify it fails**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="exactly sixty minutes" tests/**/*.test.ts
```

Expected: FAIL because `task-state.js` is absent.

- [ ] **Step 3: Implement the state transitions**

Use the same CommonJS/global wrapper as the other shared files and expose these functions:

```js
function initialState() {
  return { requestId: null, tabId: null, stage: "idle", cooldownUntil: 0 };
}

function canStart(current, now) {
  if (current.requestId) return { ok: false, code: "BUSY", remainingMs: 0 };
  if (current.cooldownUntil > now) {
    return { ok: false, code: "RATE_LIMITED", remainingMs: current.cooldownUntil - now };
  }
  return { ok: true, remainingMs: 0 };
}

function startTask(current, requestId, tabId, now) {
  const allowed = canStart(current, now);
  if (!allowed.ok) throw new Error(allowed.code);
  return { ...current, requestId, tabId, stage: "opening" };
}

function advanceTask(current, requestId, stage) {
  if (current.requestId !== requestId) throw new Error("TASK_MISMATCH");
  if (!["searching", "enriching"].includes(stage)) throw new Error("INVALID_STAGE");
  return { ...current, stage };
}

function completeTask(current, requestId) {
  if (current.requestId !== requestId) throw new Error("TASK_MISMATCH");
  return { ...current, requestId: null, tabId: null, stage: "idle" };
}

function failTask(current, code, now) {
  return {
    requestId: null,
    tabId: null,
    stage: "idle",
    cooldownUntil: code === "RATE_LIMITED" ? now + 3_600_000 : current.cooldownUntil
  };
}

function cancelTask(current, requestId) {
  if (current.requestId !== requestId) return current;
  return { ...current, requestId: null, tabId: null, stage: "idle" };
}
```

- [ ] **Step 4: Run state tests**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="exactly sixty minutes" tests/**/*.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add browser-extension/shared/task-state.js tests/xhs-extension-task-state.test.ts
git commit -m "feat: add xhs extension task state"
```

---

### Task 5: Implement fixed Xiaohongshu page actions

**Files:**
- Create: `browser-extension/xhs-content.js`
- Modify: `tests/xhs-extension-collector.test.ts`

- [ ] **Step 1: Extend the collector test for page-state failures**

Add assertions for `LOGIN_REQUIRED` and `CAPTCHA` before changing the content script.

- [ ] **Step 2: Run the new assertions and confirm the current detector behavior**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="security blocks" tests/**/*.test.ts
```

Expected: PASS only after `detectPageState` recognizes all three codes; if the new assertions fail, update only that pure detector first.

- [ ] **Step 3: Implement `xhs-content.js`**

Register one fixed `chrome.runtime.onMessage` listener. It accepts only:

```js
{ action: "xhs:search", query, limit, mediaType, dateRange, sortBy }
{ action: "xhs:detail", expectedTitle }
```

For `xhs:search`:

1. Wait up to 20 seconds for `document.body` and either a note card or a block marker.
2. Run `detectPageState(document.body.innerText)` and return the error immediately.
3. Open the filter panel by clicking the first visible element whose cleaned text equals `筛选`.
4. Select date, sort, and media labels using the existing mappings:

```js
const dateLabels = { "一天内": "一天内", "一周内": "一周内", "半年内": "半年内" };
const sortLabels = { "浏览量": "综合", "点赞量": "最多点赞", "评论量": "最多评论", "收藏量": "最多收藏" };
const mediaLabels = { "图文": "图文", "视频": "视频" };
```

5. Wait 1.6 seconds after filters.
6. Scroll by `Math.round(window.innerHeight * 0.9)` at most six times, waiting 900 ms per scroll, until `parseSearchCards` returns the requested count.
7. Return `{ ok: true, rows }`.

For `xhs:detail`, wait up to 10 seconds for a title or image, then return `parseDetail(document, expectedTitle)`. Never evaluate code received in a message and never read `document.cookie`.

- [ ] **Step 4: Perform a static safety check**

Run:

```powershell
rg -n "eval\\(|new Function|document\\.cookie|chrome\\.cookies|fetch\\(" browser-extension
```

Expected: no matches.

- [ ] **Step 5: Commit Task 5**

```powershell
git add browser-extension/xhs-content.js tests/xhs-extension-collector.test.ts browser-extension/shared/collector.js
git commit -m "feat: add fixed xhs browser actions"
```

---

### Task 6: Implement website bridge and visible-tab orchestration

**Files:**
- Create: `browser-extension/app-bridge.js`
- Create: `browser-extension/background.js`
- Modify: `tests/xhs-extension-protocol.test.ts`

- [ ] **Step 1: Add failing source-safety tests**

Read both scripts as text and assert:

- `app-bridge.js` checks `event.source === window`.
- `app-bridge.js` calls `XhsExtensionProtocol.isEnvelope`.
- `background.js` contains `chrome.tabs.create` with `active: true`.
- `background.js` contains constants `DETAIL_DELAY_MS = 4_000` and `QUERY_DELAY_MS = 15_000`.
- Neither file contains `eval(`, `new Function`, `chrome.cookies`, or `document.cookie`.

- [ ] **Step 2: Run the source-safety tests and verify they fail**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="bridge and background safety" tests/**/*.test.ts
```

Expected: FAIL because both scripts are absent.

- [ ] **Step 3: Implement the website content-script bridge**

`app-bridge.js` must:

- Open `chrome.runtime.connect({ name: "xhs-app-bridge" })` once.
- Accept only validated `page-to-extension` messages where `event.source === window` and `event.origin === location.origin`.
- Forward envelopes unchanged through the port.
- Forward only validated `extension-to-page` messages back with `window.postMessage(message, location.origin)`.
- On disconnect, post an `error` envelope for the active request with code `EXTENSION_DISCONNECTED`.
- Disconnect the port during `pagehide`.

- [ ] **Step 4: Implement the service worker**

At the top of `background.js`:

```js
importScripts("shared/protocol.js", "shared/collector.js", "shared/task-state.js");

const DETAIL_DELAY_MS = 4_000;
const QUERY_DELAY_MS = 15_000;
const TAB_LOAD_TIMEOUT_MS = 60_000;
let active = null;
```

Implement these exact orchestration rules:

1. `ping` returns `pong` with manifest version without starting a task.
2. `collect` validates the envelope and task, reads `cooldownUntil` from `chrome.storage.local`, and rejects `BUSY` or `RATE_LIMITED` before opening a tab.
3. Save minimal active state in `chrome.storage.session`.
4. Create one visible tab with `chrome.tabs.create({ url: searchUrl, active: true })`.
5. For each query, navigate that same tab to its search URL, wait for `status === "complete"`, and send the fixed `xhs:search` message.
6. For each returned row, wait `DETAIL_DELAY_MS`, navigate the same tab to the normalized detail URL, send `xhs:detail`, build a `Topic`, and emit `progress`.
7. Between queries wait `QUERY_DELAY_MS`.
8. On success, close the Xiaohongshu tab, reactivate the originating website tab, emit `result`, and clear session state.
9. On `LOGIN_REQUIRED`, `CAPTCHA`, or `RATE_LIMITED`, keep the Xiaohongshu tab visible and reactivate nothing. Persist a 60-minute cooldown only for `RATE_LIMITED`.
10. On timeout, page-structure failure, cancellation, or originating-tab closure, close the extension-created tab and clear state.
11. `chrome.tabs.onRemoved` cancels when either the origin tab or task tab disappears.
12. No failed page is automatically reloaded. A short retry loop is permitted only for `chrome.tabs.sendMessage` while a newly loaded content script is registering, capped at ten 500 ms attempts.

- [ ] **Step 5: Run protocol and source-safety tests**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="bridge and background safety|approved limits|all-url access" tests/**/*.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
git add browser-extension/app-bridge.js browser-extension/background.js tests/xhs-extension-protocol.test.ts
git commit -m "feat: orchestrate local xhs browser tasks"
```

---

### Task 7: Integrate the extension into the topic page

**Files:**
- Create: `lib/xhs-extension-topics.ts`
- Test: `tests/xhs-extension-topics.test.ts`
- Modify: `app/topics/page.tsx:3-55`
- Modify: `app/topics/page.tsx:166-320`
- Modify: `app/topics/page.tsx:387-468`
- Modify: `app/topics/page.tsx:579-705`

- [ ] **Step 1: Write failing topic merge tests**

Extract the existing merge behavior into:

```ts
export function mergeExtensionTopics(
  current: Topic[],
  incoming: Topic[],
  activeKeywords: string[],
  rejected: Topic[]
): Topic[]
```

Test that rejected URLs stay excluded, active-keyword rows are refreshed, other-keyword rows remain, and duplicate URLs appear once.

- [ ] **Step 2: Run the merge test and verify it fails**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="merges extension topics" tests/**/*.test.ts
```

Expected: FAIL because `lib/xhs-extension-topics.ts` is absent.

- [ ] **Step 3: Implement the pure merge helper**

Move only the existing URL-keyed merge rules out of `page.tsx`. Do not change `Topic` persistence keys or the approved/rejected/deleted state model.

- [ ] **Step 4: Replace server fetches with the extension client**

In `TopicsPage`:

- Import `useRef`, `createXhsExtensionClient`, and `mergeExtensionTopics`.
- Add `extensionStatus` with values `"checking" | "ready" | "missing" | "outdated"`.
- Create one client in `useEffect`, call `detect()`, and dispose it on unmount.
- Replace the per-keyword `fetch("/api/topics/opencli-xhs")` loop with one `client.collect` call containing all selected keywords.
- Generate `requestId` with `crypto.randomUUID()`.
- Use progress callbacks to set the existing feedback banner.
- Merge returned topics with `mergeExtensionTopics` and preserve all current localStorage effects.
- Change error text from `OpenCLI 抓取失败` to `本机浏览器抓取失败`.
- Disable collection unless status is `ready`.

Use this task construction:

```ts
const task: XhsCollectTask = {
  requestId: crypto.randomUUID(),
  queries: activeKeywords.slice(0, 2),
  limitPerQuery: Math.max(1, Math.min(5, requestedLimit)),
  mediaType: collectMediaType,
  dateRange: collectDateRange,
  sortBy: collectMethod,
  existingUrls: [...topicRows, ...deletedTopics, ...rejectedTopics].map(topicUrl).filter(Boolean)
};
```

- [ ] **Step 5: Add extension status and approved limits to the UI**

Show one status pill beside the existing “抓取” action:

- checking: `正在检测本机抓取扩展`
- ready: `本机抓取已连接`
- missing: `未安装本机抓取扩展`
- outdated: `抓取扩展版本过低`

The modal must reject more than two selected keywords and a per-keyword count above five with explicit Chinese text. Keep the user interaction to one website click after the modal confirmation; do not require clicking the extension icon.

- [ ] **Step 6: Stop routing extension media through the server**

Change `displayMediaUrl` to:

```ts
function displayMediaUrl(url?: string) {
  return url || "";
}
```

Keep existing video/image rendering otherwise unchanged. The remote media URL will be loaded by the user's browser.

- [ ] **Step 7: Run tests and build**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="merges extension topics|compatible local extension|streams progress" tests/**/*.test.ts
npm.cmd run build
```

Expected: selected tests PASS and Next.js build exits 0.

- [ ] **Step 8: Commit Task 7**

```powershell
git add lib/xhs-extension-topics.ts lib/xhs-extension-client.ts app/topics/page.tsx tests/xhs-extension-topics.test.ts
git commit -m "feat: collect xhs topics through local extension"
```

---

### Task 8: Disable every server-side Xiaohongshu access route

**Files:**
- Modify: `app/api/topics/opencli-xhs/route.ts`
- Modify: `app/api/topics/open-xhs-link/route.ts`
- Modify: `app/api/topics/media-proxy/route.ts`
- Test: `tests/xhs-server-routes-disabled.test.ts`

- [ ] **Step 1: Write failing route tests**

Import each handler and assert `410` without mocking `fetch` or OpenCLI:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { POST as collect } from "../app/api/topics/opencli-xhs/route";
import { POST as openLink } from "../app/api/topics/open-xhs-link/route";
import { GET as mediaProxy } from "../app/api/topics/media-proxy/route";

test("server xhs routes are permanently disabled", async () => {
  const collectResponse = await collect();
  const openResponse = await openLink();
  const mediaResponse = await mediaProxy();
  assert.equal(collectResponse.status, 410);
  assert.equal(openResponse.status, 410);
  assert.equal(mediaResponse.status, 410);
});
```

- [ ] **Step 2: Run the route test and verify it fails**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="permanently disabled" tests/**/*.test.ts
```

Expected: FAIL because the current handlers still execute server collection/proxy behavior.

- [ ] **Step 3: Replace all three handlers with explicit `410 Gone` responses**

Each route must have no OpenCLI import and no upstream `fetch`. Use:

```ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({
    ok: false,
    code: "LOCAL_EXTENSION_REQUIRED",
    message: "小红书抓取已迁移到用户本机浏览器扩展，服务器不再执行该操作。"
  }, { status: 410 });
}
```

Use `GET` instead of `POST` for `media-proxy`. Do not delete `lib/adapters/opencli-xiaohongshu.ts` in this task; it remains an implementation reference but has no production route caller.

- [ ] **Step 4: Verify routes and absence of page callers**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="permanently disabled" tests/**/*.test.ts
rg -n 'fetch\\("/api/topics/opencli-xhs"|/api/topics/media-proxy|open-xhs-link' app lib
```

Expected: route test PASS; `rg` reports only the disabled route files or no caller.

- [ ] **Step 5: Commit Task 8**

```powershell
git add app/api/topics/opencli-xhs/route.ts app/api/topics/open-xhs-link/route.ts app/api/topics/media-proxy/route.ts tests/xhs-server-routes-disabled.test.ts
git commit -m "security: disable server-side xhs access"
```

---

### Task 9: Package and document the internal extension

**Files:**
- Create: `scripts/package-xhs-browser-extension.ps1`
- Create: `docs/xhs-browser-extension-install.md`
- Modify: `tests/xhs-extension-protocol.test.ts`

- [ ] **Step 1: Add a failing manifest-generation test**

The test should call the packaging script with `https://studio.example.test`, expand the resulting zip into a temporary directory, and assert:

- `__APP_MATCH_PATTERN__` no longer appears.
- generated matches contain `https://studio.example.test/*`.
- the zip contains `background.js`, `app-bridge.js`, `xhs-content.js`, and all three shared scripts.
- generated permissions still omit `cookies`, `history`, and `<all_urls>`.

Skip only when `process.platform !== "win32"`.

- [ ] **Step 2: Run the package test and verify it fails**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="packages a scoped extension" tests/**/*.test.ts
```

Expected: FAIL because the PowerShell packager is absent.

- [ ] **Step 3: Implement the PowerShell packager**

The script accepts:

```powershell
param(
  [Parameter(Mandatory = $true)]
  [string]$AppOrigin,
  [string]$Version = "0.1.0"
)
```

It must:

1. Parse `AppOrigin` with `[Uri]` and require HTTPS, no path other than `/`, no query, and no fragment. Allow `http://127.0.0.1:3000` only for development packaging.
2. Resolve the repository root from `$PSScriptRoot\..`.
3. Create a staging directory under `exports\xhs-browser-extension-$Version`.
4. Before removing an existing staging directory or zip, resolve the absolute path and verify it starts with the repository's resolved `exports` directory.
5. Copy `background.js`, `app-bridge.js`, `xhs-content.js`, and `shared`.
6. Replace `__APP_MATCH_PATTERN__` with `$AppOrigin.TrimEnd('/') + '/*'` and replace the manifest version with `Version`.
7. Copy `docs\xhs-browser-extension-install.md` into the staging directory as `安装说明.md`.
8. Create `exports\xhs-browser-extension-$Version.zip` with `Compress-Archive`.
9. Print the absolute zip path and SHA-256 from `Get-FileHash`.

- [ ] **Step 4: Write the installation guide**

Include exact Chrome and Edge instructions:

1. Download and extract the zip.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable developer mode.
4. Choose “加载已解压的扩展” and select the extracted directory containing `manifest.json`.
5. Log in to Xiaohongshu in the same browser.
6. Reload the production website and confirm `本机抓取已连接`.
7. Start with one keyword and one result.
8. For `300013`, stop, keep the page open for diagnosis, and wait for the displayed 60-minute cooldown; do not reinstall or repeatedly retry.

Also document removal and upgrade: remove the old extension, extract the new zip, load the new directory, and reload the website.

- [ ] **Step 5: Run the package test and produce a development artifact**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="packages a scoped extension" tests/**/*.test.ts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-xhs-browser-extension.ps1 -AppOrigin "http://127.0.0.1:3000" -Version "0.1.0"
```

Expected: test PASS; `exports\xhs-browser-extension-0.1.0.zip` exists and the script prints its SHA-256.

- [ ] **Step 6: Commit Task 9**

The generated `exports` artifact is ignored and must not be committed.

```powershell
git add scripts/package-xhs-browser-extension.ps1 docs/xhs-browser-extension-install.md tests/xhs-extension-protocol.test.ts
git commit -m "docs: package local xhs browser extension"
```

---

### Task 10: Full automated and live-device verification

**Files:**
- Modify only files required to fix failures found by the checks below.
- Do not add unrelated refactors.

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
```

Expected: all tests PASS, TypeScript exits 0, Next.js build exits 0, and `git diff --check` emits nothing.

- [ ] **Step 2: Audit extension permissions and forbidden server/browser APIs**

Run:

```powershell
rg -n '"cookies"|"history"|<all_urls>|document\\.cookie|chrome\\.cookies|eval\\(|new Function' browser-extension
rg -n 'fetch\\("/api/topics/opencli-xhs"|/api/topics/media-proxy|openXiaohongshuInSharedBrowser' app lib
```

Expected: the first command has no matches; the second has no active website caller and only the dormant adapter definition if its function name remains.

- [ ] **Step 3: Package for the real production origin**

Copy the scheme and host from the deployed website address bar and run:

```powershell
$deploymentOrigin = Read-Host "粘贴部署网站的完整 Origin，例如 https://host.example"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-xhs-browser-extension.ps1 -AppOrigin $deploymentOrigin -Version "0.1.0"
```

The packager rejects paths and non-HTTPS production values. Record the printed zip path and SHA-256 in the handoff.

- [ ] **Step 4: Run a one-keyword live smoke test in Chrome**

Install the real-origin package, log in to Xiaohongshu, reload the website, and verify:

1. Status changes to `本机抓取已连接`.
2. One click starts one visible Xiaohongshu tab.
3. One keyword with one requested result completes.
4. The extension closes the task tab and returns focus to the website.
5. The topic appears in localStorage and survives reload.
6. Browser DevTools Network shows Xiaohongshu requests originating from the local browser, not the website API.

- [ ] **Step 5: Run isolation and error smoke tests**

Use Chrome and Edge on two computers:

1. Start different one-keyword jobs simultaneously.
2. Confirm each browser opens only its own task tab and receives only its own result.
3. Confirm the two local topic libraries remain different.
4. Temporarily log out on one browser; confirm `LOGIN_REQUIRED`, a retained Xiaohongshu tab, and no server fallback.
5. If `300013` occurs naturally, confirm immediate stop and the 60-minute cooldown. Do not deliberately generate repeated traffic to force the error.

- [ ] **Step 6: Inspect server logs during the live smoke test**

Search the deployment logs for `xiaohongshu.com`, `xhscdn`, `opencli-xhs`, and `media-proxy` during the test window.

Expected: no server-originated Xiaohongshu search, detail, or media request. Requests to the disabled routes, if any stale client calls them, return `410` and identify an old deployment or cached page that must be refreshed.

- [ ] **Step 7: Final scoped commit if verification required fixes**

If Steps 1–6 required code fixes, return to the task that owns the failed behavior, rerun that task's focused test, and use that task's explicit `git add` file list. Then run:

```powershell
git diff --check
git commit -m "fix: complete local xhs extension verification"
```

If no fixes were needed, do not create an empty commit.

## Completion evidence required

Do not claim the feature complete from automated tests alone. The final handoff must separately report:

- automated test count and result;
- TypeScript and Next.js build result;
- generated real-origin zip path and SHA-256;
- Chrome live smoke-test result;
- Edge/two-computer isolation result;
- server log evidence showing no Xiaohongshu traffic;
- any live checks that could not be completed and the exact reason.
