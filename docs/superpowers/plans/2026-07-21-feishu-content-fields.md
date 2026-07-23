# Feishu Content Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让线上成品内容同步识别飞书表的 `标题` 和 `图片或视频` 字段，并把浏览器本地成品的标题与图片附件写入同一条飞书记录。

**Architecture:** 前端继续把 IndexedDB 中的 `cps-image://` 图片转换为 Data URL 并调用现有同步接口。新增一个无副作用的飞书字段解析器，服务端用它选择实际存在的标题字段和类型为 17 的附件字段；媒体上传和创建记录仍沿用现有飞书 API。

**Tech Stack:** Next.js 15 Route Handlers, TypeScript, Feishu Open API, Node.js built-in test runner, `tsx`

---

## File structure

- Create `lib/adapters/feishu-content-fields.ts`: 只负责从飞书字段表中选择受支持的标题和附件字段。
- Create `tests/feishu-content-fields.test.ts`: 覆盖线上字段名、旧字段别名和附件类型检查。
- Modify `app/api/feishu/sync-content/route.ts`: 使用解析结果触发图片上传并动态写入标题、附件字段。
- Create `tests/feishu-sync-content-route.test.ts`: 用假的飞书 HTTP 响应验证完整路由数据流，不写入真实飞书。

### Task 1: Add Feishu field-name resolution

**Files:**
- Create: `tests/feishu-content-fields.test.ts`
- Create: `lib/adapters/feishu-content-fields.ts`

- [ ] **Step 1: Write the failing field-resolution tests**

Create `tests/feishu-content-fields.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveFeishuContentFieldNames } from "../lib/adapters/feishu-content-fields";

test("matches the live Feishu title and attachment fields", () => {
  const fields = new Map<string, number>([
    ["平台", 3],
    ["标题", 1],
    ["内容正文", 1],
    ["图片或视频", 17]
  ]);

  assert.deepEqual(resolveFeishuContentFieldNames(fields), {
    titleFieldName: "标题",
    attachmentFieldName: "图片或视频"
  });
});

test("keeps the original content-title and image aliases", () => {
  const fields = new Map<string, number>([
    ["内容标题", 1],
    ["图片", 17]
  ]);

  assert.deepEqual(resolveFeishuContentFieldNames(fields), {
    titleFieldName: "内容标题",
    attachmentFieldName: "图片"
  });
});

test("keeps the original platform-image alias", () => {
  const fields = new Map<string, number>([["平台图片", 17]]);

  assert.equal(resolveFeishuContentFieldNames(fields).attachmentFieldName, "平台图片");
});

test("does not use a non-attachment field for media tokens", () => {
  const fields = new Map<string, number>([["图片或视频", 1]]);

  assert.equal(resolveFeishuContentFieldNames(fields).attachmentFieldName, undefined);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/feishu-content-fields.test.ts
```

Expected: FAIL because `lib/adapters/feishu-content-fields.ts` does not exist.

- [ ] **Step 3: Implement the minimal field resolver**

Create `lib/adapters/feishu-content-fields.ts`:

```ts
export type FeishuFieldMap = ReadonlyMap<string, number>;

const TITLE_FIELD_NAMES = ["标题", "内容标题"] as const;
const ATTACHMENT_FIELD_NAMES = ["图片或视频", "图片", "平台图片"] as const;
const ATTACHMENT_FIELD_TYPE = 17;

function firstMatchingField(
  fields: FeishuFieldMap,
  names: readonly string[],
  requiredType?: number
) {
  return names.find((name) => fields.has(name)
    && (requiredType === undefined || fields.get(name) === requiredType));
}

export function resolveFeishuContentFieldNames(fields: FeishuFieldMap) {
  return {
    titleFieldName: firstMatchingField(fields, TITLE_FIELD_NAMES),
    attachmentFieldName: firstMatchingField(fields, ATTACHMENT_FIELD_NAMES, ATTACHMENT_FIELD_TYPE)
  };
}
```

- [ ] **Step 4: Run the targeted test to verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/feishu-content-fields.test.ts
```

Expected: PASS, 4 tests and 0 failures.

- [ ] **Step 5: Commit the field resolver**

```powershell
git add -- lib/adapters/feishu-content-fields.ts tests/feishu-content-fields.test.ts
git commit -m "fix: resolve Feishu content fields"
```

### Task 2: Write title and uploaded media to the live field names

**Files:**
- Create: `tests/feishu-sync-content-route.test.ts`
- Modify: `app/api/feishu/sync-content/route.ts`

- [ ] **Step 1: Write the failing route test**

Create `tests/feishu-sync-content-route.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the route test to verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/feishu-sync-content-route.test.ts
```

Expected: FAIL because `mediaUploadCalls` is 0 and the created record lacks `标题` and `图片或视频`.

- [ ] **Step 3: Integrate the resolver into the route**

In `app/api/feishu/sync-content/route.ts`, add the import:

```ts
import { resolveFeishuContentFieldNames } from "@/lib/adapters/feishu-content-fields";
```

Remove the local `FeishuFieldMap` type and the `isAttachmentField` function. After loading `fields`, resolve the live names:

```ts
const fields = await getFieldNames(appToken, tableId, token);
const { titleFieldName, attachmentFieldName } = resolveFeishuContentFieldNames(fields);
const imageText = (payload.images ?? []).filter(Boolean).join("\n");
const tagText = (payload.tags ?? []).map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" ");
const uploadWarnings: string[] = [];
let attachmentValues: Array<{ file_token: string }> = [];

if (payload.images?.length && !attachmentFieldName) {
  uploadWarnings.push("飞书表中未找到附件字段：图片或视频、图片、平台图片");
}

if (attachmentFieldName && payload.images?.length) {
  const uploaded = await Promise.all((payload.images ?? []).slice(0, 9).map(async (url, index) => {
    try {
      return await uploadImageToFeishu(url, index, appToken, token);
    } catch (error) {
      uploadWarnings.push(error instanceof Error ? error.message : "图片上传飞书失败");
      return "";
    }
  }));
  attachmentValues = uploaded.filter(Boolean).map((fileToken) => ({ file_token: fileToken }));
}
```

Replace `candidateFields` with this dynamic version:

```ts
const candidateFields: Record<string, unknown> = {
  平台: payload.platform ?? "",
  账号名称: payload.accountName ?? "",
  账号: payload.accountName ?? "",
  图片: imageText,
  平台图片: imageText,
  图片链接: imageText,
  平台图片链接: imageText,
  内容正文: payload.body ?? "",
  小红书tag: tagText
};
if (titleFieldName) candidateFields[titleFieldName] = payload.title ?? "";
if (attachmentFieldName && attachmentValues.length) {
  candidateFields[attachmentFieldName] = attachmentValues;
}
```

Update the no-match error so it names both live and legacy aliases:

```ts
throw new Error("飞书表中未匹配到字段：平台、账号名称、图片或视频、标题、内容正文、小红书tag");
```

- [ ] **Step 4: Run the route and resolver tests to verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/feishu-content-fields.test.ts tests/feishu-sync-content-route.test.ts
```

Expected: PASS, 5 tests and 0 failures.

- [ ] **Step 5: Commit the route integration**

```powershell
git add -- app/api/feishu/sync-content/route.ts tests/feishu-sync-content-route.test.ts
git commit -m "fix: sync Feishu titles and attachments"
```

### Task 3: Fail clearly when every requested image upload fails

**Files:**
- Modify: `tests/feishu-sync-content-route.test.ts`
- Modify: `app/api/feishu/sync-content/route.ts`

- [ ] **Step 1: Append the failing all-images-rejected test**

Append to `tests/feishu-sync-content-route.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the route test to verify RED**

Run:

```powershell
npm.cmd exec -- tsx --test tests/feishu-sync-content-route.test.ts
```

Expected: FAIL because the current route returns 200 and creates a text-only record after all image uploads fail.

- [ ] **Step 3: Stop record creation when all uploads fail**

In `app/api/feishu/sync-content/route.ts`, immediately after `attachmentValues` is built, add:

```ts
if (attachmentFieldName && payload.images?.length && !attachmentValues.length) {
  throw new Error(uploadWarnings[0] ?? "图片上传飞书失败");
}
```

This keeps the existing partial-success behavior: one or more successful `file_token` values still create the record, and failed images remain in `warnings`.

- [ ] **Step 4: Run the route test to verify GREEN**

Run:

```powershell
npm.cmd exec -- tsx --test tests/feishu-sync-content-route.test.ts
```

Expected: PASS, 2 tests and 0 failures.

- [ ] **Step 5: Commit the failure handling**

```powershell
git add -- app/api/feishu/sync-content/route.ts tests/feishu-sync-content-route.test.ts
git commit -m "fix: report failed Feishu image uploads"
```

### Task 4: Verify the complete change

**Files:**
- Verify only; no production files should change.

- [ ] **Step 1: Run the targeted tests**

```powershell
npm.cmd exec -- tsx --test tests/feishu-content-fields.test.ts tests/feishu-sync-content-route.test.ts
```

Expected: PASS, 6 tests and 0 failures.

- [ ] **Step 2: Run the complete test suite**

```powershell
npm.cmd test
```

Expected: all tests pass with 0 failures.

- [ ] **Step 3: Run the production build**

```powershell
npm.cmd run build
```

Expected: Next.js build completes successfully with exit code 0.

- [ ] **Step 4: Check scope and repository state**

```powershell
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
git status --short --branch
```

Expected: no whitespace errors; changes are limited to the design/plan documents, field resolver, Feishu sync route, and their tests; the worktree is clean.

- [ ] **Step 5: Record the live verification boundary**

After deployment, use one real browser-stored image post from “成品内容库” and click “同步到飞书”. Acceptance requires the newly created Feishu record to show both `标题` and at least one attachment in `图片或视频`. Do not claim this live acceptance from unit tests or a local build alone.
