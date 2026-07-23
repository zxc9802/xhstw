# Xiaohongshu Extension Detail Click Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local Xiaohongshu extension click search cards, accept only meaningful detail content, skip individually unavailable notes, and package the verified fix as version `0.1.1`.

**Architecture:** Keep the existing one-visible-tab orchestration. The background worker requests up to five search candidates, while the Xiaohongshu content script locates a candidate by note ID, clicks it in the search page, waits for a visible detail dialog, parses only that dialog, closes it, and returns a typed result. The background worker backfills skipped candidates until it reaches the requested per-query limit, while login, CAPTCHA, and rate-limit states retain their current batch-stopping behavior.

**Tech Stack:** Manifest V3 extension JavaScript, Chrome tabs/runtime/storage APIs, TypeScript Node test runner through `tsx`, `linkedom` DOM fixtures, PowerShell packaging.

---

## File Map

- `browser-extension/shared/collector.js`: identify search-card links and visible detail roots; reject unavailable or structurally empty detail data.
- `browser-extension/xhs-content.js`: validate the target URL, click the matching search card, wait for the detail dialog, parse it, and close it.
- `browser-extension/background.js`: request candidate backfill, skip `NOTE_UNAVAILABLE`, and stop navigating directly to rewritten `/explore` URLs.
- `tests/fixtures/xhs-detail.html`: wrap the existing valid detail fixture in the same visible detail-root contract used in production.
- `tests/fixtures/xhs-detail-unavailable.html`: reproduce the exact unavailable-note page that was previously stored as a topic.
- `tests/fixtures/xhs-search-click-detail.html`: model two search cards plus a hidden detail dialog for click-flow tests.
- `tests/xhs-extension-collector.test.ts`: verify detail validity, unavailable detection, target-card lookup, click/close flow, and fixed message validation.
- `tests/xhs-extension-protocol.test.ts`: guard the background orchestration and the `0.1.1` package contents.
- `exports/xhs-browser-extension-0.1.1/` and `.zip`: generated, ignored delivery artifacts for the production origin.

### Task 1: Reject unavailable and empty detail documents

**Files:**
- Create: `tests/fixtures/xhs-detail-unavailable.html`
- Modify: `tests/fixtures/xhs-detail.html`
- Modify: `tests/xhs-extension-collector.test.ts`
- Modify: `browser-extension/shared/collector.js`

- [ ] **Step 1: Add the unavailable-note fixture**

```html
<!doctype html>
<html lang="zh-CN">
  <body>
    <div class="note-detail-mask" role="dialog">
      <div class="note-container">
        <h1 class="title">当前笔记暂时无法浏览</h1>
        <img src="https://ci.xiaohongshu.com/error-decoration.webp" alt="页面装饰">
        <button aria-label="关闭">关闭</button>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Write failing collector tests**

Wrap the existing `xhs-detail.html` body content in `<div class="note-detail-mask" role="dialog">...</div>`. Add `findDetailRoot` to the collector type, introduce this test helper, and pass its returned element to every valid-detail `parseDetail` call:

```ts
function validDetailRoot(html: string) {
  const page = parseHTML(`<div class="note-detail-mask" role="dialog">${html}</div>`).document;
  const root = collector.findDetailRoot(page);
  assert.ok(root);
  return root;
}
```

Then add these cases:

```ts
test("unavailable detail pages are skippable and never become topics", () => {
  const detailRoot = collector.findDetailRoot(fixture("xhs-detail-unavailable.html"));

  assert.ok(detailRoot);
  assert.deepEqual(collector.parseDetail(detailRoot, "搜索卡片标题"), {
    ok: false,
    code: "NOTE_UNAVAILABLE",
    message: "当前笔记暂时无法浏览"
  });
});

test("detail parsing requires meaningful content inside a visible detail root", () => {
  const page = parseHTML(`
    <main>
      <h1 class="title">导航标题</h1>
      <img src="https://ci.xiaohongshu.com/navigation.webp" alt="导航图片">
    </main>
  `).document;

  assert.equal(collector.findDetailRoot(page), null);
  assert.deepEqual(collector.parseDetail(page, "搜索卡片标题"), {
    ok: false,
    code: "PAGE_STRUCTURE_CHANGED",
    message: "未检测到有效的小红书详情内容"
  });
});
```

Update the existing malformed-document assertion so an empty document expects the same `PAGE_STRUCTURE_CHANGED` result instead of `ok: true`.

- [ ] **Step 3: Run the tests and verify the intended failures**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="unavailable detail|meaningful content|malformed documents" tests/xhs-extension-collector.test.ts
```

Expected: FAIL because `findDetailRoot` is not exported and `parseDetail` still accepts the unavailable and empty documents.

- [ ] **Step 4: Implement visible-root selection and detail validation**

Add these focused helpers to `browser-extension/shared/collector.js`:

```js
const DETAIL_ROOT_SELECTOR = ".note-detail-mask, [role='dialog'][class*='note'], [role='dialog'] .note-container";
const UNAVAILABLE_DETAIL_PATTERN = /当前笔记暂时无法浏览|笔记已删除|无权限查看|该内容无法查看|内容不存在/;

function findDetailRoot(document) {
  return queryAll(document, DETAIL_ROOT_SELECTOR).find((element) => !isHidden(element)) || null;
}

function unavailableDetailState(root) {
  for (const element of queryAll(root, "h1, .title, .error, .error-message, .note-error")) {
    const message = text(element);
    if (UNAVAILABLE_DETAIL_PATTERN.test(message)) {
      return { ok: false, code: "NOTE_UNAVAILABLE", message };
    }
  }
  return null;
}
```

Revise `parseDetail` so it:

```js
function parseDetail(root, expectedTitle) {
  const state = detectPageState(root);
  if (!state.ok) return state;
  const detailRoot = root && root.nodeType === 1 ? root : findDetailRoot(root);
  if (!detailRoot) {
    return { ok: false, code: "PAGE_STRUCTURE_CHANGED", message: "未检测到有效的小红书详情内容" };
  }
  const unavailable = unavailableDetailState(detailRoot);
  if (unavailable) return unavailable;

  const title = text(detailRoot, "h1.title, .note-title, .note-content .title, .title") || clean(expectedTitle);
  const content = text(detailRoot, ".note-content .desc, .desc, .content, #detail-desc");
  const author = text(detailRoot, ".author .username, .author-name, .user .name, .username, .author");
  const publishedAt = text(detailRoot, "time, .date, .published-at");
  const likes = text(detailRoot, ".like-wrapper .count, .likes, .like-count");
  const comments = text(detailRoot, ".chat-wrapper .count, .comments, .comment-count");
  const saves = text(detailRoot, ".collect-wrapper .count, .saves, .collect-count, .favorite-count");
  const media = parseMedia(detailRoot);

  if (!title || (!content && !author && !likes && !comments && !saves && !media.length)) {
    return { ok: false, code: "PAGE_STRUCTURE_CHANGED", message: "未检测到有效的小红书详情内容" };
  }
  return { ok: true, title, author, content, publishedAt, likes, comments, saves, tags: extractTags(content), media };
}
```

Export `findDetailRoot` with the existing collector API. Keep `buildTopic` unchanged so a confirmed detail may still fall back to its search-card cover.

- [ ] **Step 5: Run the collector tests**

Run:

```powershell
npx.cmd tsx --test tests/xhs-extension-collector.test.ts
```

Expected: all collector tests PASS, including unavailable-note and empty-detail rejection.

- [ ] **Step 6: Commit the collector behavior**

```powershell
git add -- browser-extension/shared/collector.js tests/fixtures/xhs-detail.html tests/fixtures/xhs-detail-unavailable.html tests/xhs-extension-collector.test.ts
git diff --cached --check
git commit -m "fix: reject invalid xhs detail pages"
```

### Task 2: Click the target search card and close its detail dialog

**Files:**
- Create: `tests/fixtures/xhs-search-click-detail.html`
- Modify: `tests/xhs-extension-collector.test.ts`
- Modify: `browser-extension/shared/collector.js`
- Modify: `browser-extension/xhs-content.js`

- [ ] **Step 1: Add a search-and-dialog fixture**

```html
<!doctype html>
<html lang="zh-CN">
  <body>
    <section class="note-item">
      <a href="/search_result/6a59e17a000000001d00ca02?xsec_token=first"><span class="title">目标笔记</span></a>
    </section>
    <section class="note-item">
      <a href="/search_result/6a5b67b2000000000f039c00?xsec_token=second"><span class="title">其他笔记</span></a>
    </section>
    <div class="note-detail-mask" role="dialog" hidden>
      <div class="note-container">
        <h1 class="title">目标笔记</h1>
        <a class="author-name">测试作者</a>
        <div class="desc">真实详情正文 #防晒</div>
        <span class="like-wrapper"><span class="count">328</span></span>
        <img src="https://sns-webpic-qc.xhscdn.com/detail.webp" alt="正文图片">
        <button aria-label="关闭">关闭</button>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Write the failing click-flow test**

Extend the action type with `handleMessage`, then add a test that installs the fixture document on `globalThis`, makes the target link reveal the dialog, and makes the close button hide it:

```ts
test("detail actions click the matching search card, parse its dialog, and close it", async () => {
  const page = fixture("xhs-search-click-detail.html");
  const target = page.querySelector('a[href*="6a59e17a000000001d00ca02"]') as HTMLAnchorElement;
  const dialog = page.querySelector(".note-detail-mask") as HTMLElement;
  const close = page.querySelector('[aria-label="关闭"]') as HTMLButtonElement;
  let clicks = 0;
  target.addEventListener("click", (event) => {
    event.preventDefault();
    clicks += 1;
    dialog.hidden = false;
  });
  close.addEventListener("click", () => { dialog.hidden = true; });

  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  try {
    const response = await actions.handleMessage({
      action: "xhs:detail",
      expectedTitle: "目标笔记",
      targetUrl: "https://www.xiaohongshu.com/search_result/6a59e17a000000001d00ca02?xsec_token=first"
    });
    assert.equal(clicks, 1);
    assert.equal(response.ok, true);
    assert.equal(response.title, "目标笔记");
    assert.equal(dialog.hidden, true);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete (globalThis as { document?: Document }).document;
  }
});
```

Update the command-validation assertions so the two-key detail command is rejected and the exact three-key detail command with a Xiaohongshu note URL is accepted.

- [ ] **Step 3: Run the click-flow test and verify it fails**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="detail actions click|fixed commands" tests/xhs-extension-collector.test.ts
```

Expected: FAIL because `targetUrl` is not accepted and no search-card click occurs.

- [ ] **Step 4: Add target-link lookup to the collector**

Add and export this helper in `browser-extension/shared/collector.js`:

```js
function findSearchCardLink(document, targetUrl) {
  const targetId = noteId(targetUrl);
  if (!targetId) return null;
  for (const card of queryAll(document, "section.note-item, .note-item, [data-note-id]")) {
    for (const link of queryAll(card, 'a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/item/"], a[href*="/search_result/"]')) {
      if (noteId(attr(link, "href")) === targetId) return link;
    }
  }
  return null;
}
```

- [ ] **Step 5: Implement the fixed detail command**

In `browser-extension/xhs-content.js`:

```js
const DETAIL_KEYS = ["action", "expectedTitle", "targetUrl"];
const DETAIL_CLOSE_TIMEOUT_MS = 3_000;
```

Validate `targetUrl` by requiring `collector().noteId(message.targetUrl)` and an HTTPS Xiaohongshu hostname. Replace the old document-wide detail wait with this flow:

```js
function closeDetail(rootElement) {
  const button = rootElement.querySelector("button[aria-label='关闭'], [aria-label='关闭'], .close-circle, .close");
  if (!button || !isVisible(button)) throw new Error("DETAIL_CLOSE_FAILED");
  button.click();
}

async function detail(message) {
  const link = collector().findSearchCardLink(root.document, message.targetUrl);
  if (!link || !isVisible(link)) {
    return { ok: false, code: "PAGE_STRUCTURE_CHANGED", message: "未找到对应的小红书搜索卡片" };
  }
  link.click();
  await waitUntil(() => {
    if (!documentState().ok) return true;
    return Boolean(collector().findDetailRoot(root.document));
  }, DETAIL_TIMEOUT_MS);

  const state = documentState();
  if (!state.ok) return state;
  const detailRoot = collector().findDetailRoot(root.document);
  if (!detailRoot) return { ok: false, code: "PAGE_STRUCTURE_CHANGED", message: "未检测到小红书详情弹层" };
  const response = collector().parseDetail(detailRoot, message.expectedTitle);
  closeDetail(detailRoot);
  await waitUntil(() => !collector().findDetailRoot(root.document), DETAIL_CLOSE_TIMEOUT_MS);
  return response;
}
```

Keep login, CAPTCHA, and rate-limit returns before `closeDetail` so the task tab remains visible for manual handling.

- [ ] **Step 6: Run the click-flow and collector suites**

Run:

```powershell
npx.cmd tsx --test tests/xhs-extension-collector.test.ts
```

Expected: all tests PASS; the target receives exactly one click, the other card receives none, and the dialog is hidden before the response resolves.

- [ ] **Step 7: Commit the content-script flow**

```powershell
git add -- browser-extension/shared/collector.js browser-extension/xhs-content.js tests/fixtures/xhs-search-click-detail.html tests/xhs-extension-collector.test.ts
git diff --cached --check
git commit -m "fix: click xhs search cards for detail"
```

### Task 3: Backfill skipped candidates without direct detail navigation

**Files:**
- Modify: `tests/xhs-extension-protocol.test.ts`
- Modify: `browser-extension/background.js`

- [ ] **Step 1: Write failing orchestration guards**

Extend `bridge and background use validated messages and visible fixed-tab orchestration` with:

```ts
assert.doesNotMatch(background, /navigate\(context,\s*detailUrl\)/);
assert.match(background, /action:\s*["']xhs:detail["'][\s\S]*targetUrl:\s*row\.url/);
assert.match(background, /SKIPPABLE_DETAIL_CODES\s*=\s*new Set\(\[["']NOTE_UNAVAILABLE["']\]\)/);
assert.match(background, /SEARCH_CANDIDATE_LIMIT\s*=\s*5/);
assert.match(background, /limit:\s*SEARCH_CANDIDATE_LIMIT/);
assert.match(background, /capturedForQuery/);
assert.match(background, /skippedUnavailable/);
```

- [ ] **Step 2: Run the orchestration test and verify it fails**

Run:

```powershell
npx.cmd tsx --test --test-name-pattern="bridge and background" tests/xhs-extension-protocol.test.ts
```

Expected: FAIL because the background still navigates to `detailUrl`, requests only the requested result count, and has no skippable-detail branch.

- [ ] **Step 3: Implement candidate backfill and skip handling**

In `browser-extension/background.js`:

```js
const SEARCH_CANDIDATE_LIMIT = 5;
const SKIPPABLE_DETAIL_CODES = new Set(["NOTE_UNAVAILABLE"]);
```

Track `let skippedUnavailable = 0;`. Send `limit: SEARCH_CANDIDATE_LIMIT` to `xhs:search`, initialize `let capturedForQuery = 0;` for every keyword, and stop that row loop when `capturedForQuery >= task.limitPerQuery`.

Replace direct detail navigation with:

```js
await wait(context, DETAIL_DELAY_MS);
context.state = taskState.advanceTask(context.state, context.requestId, "enriching");
await persist(context);
const rawDetailResponse = await sendToTaskTab(context, {
  action: "xhs:detail",
  expectedTitle: typeof row.title === "string" ? row.title.slice(0, 2_048) : "",
  targetUrl: row.url
});
if (rawDetailResponse && rawDetailResponse.ok === false && SKIPPABLE_DETAIL_CODES.has(rawDetailResponse.code)) {
  skippedUnavailable += 1;
  continue;
}
const detailResponse = pageResult(rawDetailResponse, "detail");
const topic = collector.buildTopic(row, detailResponse, new Date());
topics.push(topic);
capturedForQuery += 1;
seen.add(key);
```

Return the existing result envelope shape with a more accurate message:

```js
const skippedMessage = skippedUnavailable ? `，跳过 ${skippedUnavailable} 条不可浏览内容` : "";
post(context, "result", { topics, message: `本机浏览器已抓取 ${topics.length} 条${skippedMessage}` });
```

Do not add a new result payload field because the page-extension protocol intentionally requires the exact `{ topics, message }` shape.

- [ ] **Step 4: Run the protocol suite**

Run:

```powershell
npx.cmd tsx --test tests/xhs-extension-protocol.test.ts
```

Expected: all protocol and packaging-contract tests PASS, with no direct detail navigation pattern remaining.

- [ ] **Step 5: Commit the background orchestration**

```powershell
git add -- browser-extension/background.js tests/xhs-extension-protocol.test.ts
git diff --cached --check
git commit -m "fix: backfill skipped xhs details"
```

### Task 4: Verify and package version 0.1.1

**Files:**
- Generated: `exports/xhs-browser-extension-0.1.1/`
- Generated: `exports/xhs-browser-extension-0.1.1.zip`

- [ ] **Step 1: Run the complete automated test suite**

```powershell
npm.cmd test
```

Expected: all 91 baseline tests plus the new regression tests PASS with zero failures.

- [ ] **Step 2: Run the production build**

```powershell
npm.cmd run build
```

Expected: Next.js production build exits with code 0.

- [ ] **Step 3: Build the production-scoped extension package**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-xhs-browser-extension.ps1 -AppOrigin "https://xhstw.qycm.top" -Version "0.1.1"
```

Expected: the command prints the absolute ZIP path and SHA256 hash for `exports/xhs-browser-extension-0.1.1.zip`.

- [ ] **Step 4: Inspect the generated manifest and archive**

```powershell
Get-Content -Raw -Encoding UTF8 -LiteralPath 'exports\xhs-browser-extension-0.1.1\manifest.json'
tar -tf 'exports\xhs-browser-extension-0.1.1.zip'
```

Expected: manifest version is `0.1.1`; app access is limited to `https://xhstw.qycm.top/*`; Xiaohongshu access is limited to `https://www.xiaohongshu.com/*`; the ZIP root contains `manifest.json`, the three top-level scripts, `shared/`, and `安装说明.md`.

- [ ] **Step 5: Perform the live browser acceptance run**

In Chrome or Edge:

1. Remove or disable `0.1.0`.
2. Load the unpacked `exports/xhs-browser-extension-0.1.1` directory.
3. Refresh `https://xhstw.qycm.top/topics` and confirm `本机抓取已连接`.
4. Select one keyword and one result, then click `抓取` once.
5. Confirm the visible Xiaohongshu tab opens the search page, clicks a result, displays its detail dialog, returns a real title plus at least one meaningful detail field, closes the dialog, and returns to the production site.
6. Confirm no new topic titled `当前笔记暂时无法浏览` is stored.

Expected: one valid topic is returned, or an unavailable first candidate is skipped and a later valid candidate is returned; login, CAPTCHA, and rate-limit pages remain visible and stop the batch.

- [ ] **Step 6: Record final repository evidence**

```powershell
git status --short
git log -4 --oneline
Get-FileHash -Algorithm SHA256 -LiteralPath 'exports\xhs-browser-extension-0.1.1.zip'
```

Expected: tracked worktree is clean, the three focused implementation commits follow the design/plan commits, and the package hash matches the packaging command output.
