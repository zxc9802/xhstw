# Feishu Attachment Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name Feishu image attachments `1`, `2`, `3`, `4` without extensions and preserve the user's selection order from left to right in the attachment cell.

**Architecture:** Keep the existing frontend and request payload unchanged because `images` already preserves the saved user-selection order. Change only the Feishu sync route: derive an extensionless numeric filename from each request-array index, upload images serially, and append successful tokens in that same loop order.

**Tech Stack:** Next.js route handlers, TypeScript, Node.js test runner through `tsx`

---

### Task 1: Use extensionless numeric filenames

**Files:**
- Modify: `tests/feishu-sync-content-route.test.ts`
- Modify: `app/api/feishu/sync-content/route.ts:68-89`

- [x] **Step 1: Write the failing filename test**

Append this test to `tests/feishu-sync-content-route.test.ts`:

```ts
test("names selected images 1 through 4 without extensions", async (t) => {
  installFeishuEnv(t);
  const originalFetch = globalThis.fetch;
  const uploadedFileNames: string[] = [];
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
      uploadedFileNames.push(fileName);
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
      images: Array.from({ length: 4 }, () => "data:image/png;base64,AA==")
    })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(uploadedFileNames, ["1", "2", "3", "4"]);
  assert.deepEqual(recordFields?.图片或视频, [
    { file_token: "file-token-1" },
    { file_token: "file-token-2" },
    { file_token: "file-token-3" },
    { file_token: "file-token-4" }
  ]);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test --test-name-pattern "names selected images" tests\feishu-sync-content-route.test.ts
```

Expected: FAIL because the current filenames are `content-image-1.png` through `content-image-4.png`.

- [x] **Step 3: Implement the minimal filename change**

In both return branches of `imageToBlob`, replace the existing filename expression with:

```ts
fileName: String(index + 1)
```

Keep the Blob MIME type unchanged and do not add an extension.

- [x] **Step 4: Run the filename test to verify it passes**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test --test-name-pattern "names selected images" tests\feishu-sync-content-route.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit the filename behavior**

```powershell
git add -- app/api/feishu/sync-content/route.ts tests/feishu-sync-content-route.test.ts
git commit -m "fix: use numeric Feishu attachment names"
```

### Task 2: Upload serially and preserve attachment order

**Files:**
- Modify: `tests/feishu-sync-content-route.test.ts`
- Modify: `app/api/feishu/sync-content/route.ts:133-146`

- [x] **Step 1: Write the failing serial-upload test**

Append this test to `tests/feishu-sync-content-route.test.ts`:

```ts
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
    { file_token: "file-token-1" },
    { file_token: "file-token-2" },
    { file_token: "file-token-3" },
    { file_token: "file-token-4" }
  ]);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test --test-name-pattern "one at a time" tests\feishu-sync-content-route.test.ts
```

Expected: FAIL with `maxActiveUploads` equal to `4` because the route currently uses `Promise.all`.

- [x] **Step 3: Implement serial upload and ordered token collection**

Replace the `Promise.all` upload block with:

```ts
if (attachmentFieldName && payload.images?.length) {
  for (const [index, url] of payload.images.slice(0, 9).entries()) {
    try {
      const fileToken = await uploadImageToFeishu(url, index, appToken, token);
      attachmentValues.push({ file_token: fileToken });
    } catch (error) {
      uploadWarnings.push(error instanceof Error ? error.message : "图片上传飞书失败");
    }
  }
}
```

Do not change field matching, the nine-image limit, partial-failure warnings, or all-images-failed behavior.

- [x] **Step 4: Run the route tests and full suite**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test tests\feishu-sync-content-route.test.ts
npm.cmd test
```

Expected: all route tests and the complete suite PASS.

- [x] **Step 5: Run production build and diff checks**

Run:

```powershell
npm.cmd run build
git diff --check
git status --short
```

Expected: build succeeds, diff check is clean, and only the planned route, test, and plan files are changed.

- [x] **Step 6: Commit ordered upload behavior and plan**

```powershell
git add -- app/api/feishu/sync-content/route.ts tests/feishu-sync-content-route.test.ts docs/superpowers/plans/2026-07-21-feishu-attachment-order.md
git commit -m "fix: preserve Feishu attachment upload order"
```

### Task 3: Preserve extensionless names with the Base file upload point

**Files:**
- Modify: `tests/feishu-sync-content-route.test.ts`
- Modify: `app/api/feishu/sync-content/route.ts:94`

- [x] **Step 1: Add a failing upload-point assertion**

In the existing `names selected images 1 through 4 without extensions` test, collect `parent_type` from every upload form and assert:

```ts
assert.deepEqual(uploadParentTypes, [
  "bitable_file",
  "bitable_file",
  "bitable_file",
  "bitable_file"
]);
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test --test-name-pattern "names selected images" tests\feishu-sync-content-route.test.ts
```

Expected: FAIL because the route currently submits `bitable_image`.

- [x] **Step 3: Make the minimal production change**

Change only the upload-point value:

```ts
form.append("parent_type", "bitable_file");
```

- [x] **Step 4: Verify GREEN and the full project**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test --test-name-pattern "names selected images" tests\feishu-sync-content-route.test.ts
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: the focused test, full suite, and production build pass; the diff check produces no output.

- [x] **Step 5: Commit and push the approved fix**

```powershell
git add -- app/api/feishu/sync-content/route.ts tests/feishu-sync-content-route.test.ts docs/superpowers/specs/2026-07-21-feishu-attachment-order-design.md docs/superpowers/plans/2026-07-21-feishu-attachment-order.md
git commit -m "fix: upload Feishu images as files"
git push origin HEAD:main
```

### Task 4: Restore the Base image upload point

**Files:**
- Modify: `tests/feishu-sync-content-route.test.ts`
- Modify: `app/api/feishu/sync-content/route.ts:94`

- [x] **Step 1: Change the upload-point expectation first**

Keep the existing numeric filename assertions. Change the four expected parent types to:

```ts
assert.deepEqual(uploadParentTypes, [
  "bitable_image",
  "bitable_image",
  "bitable_image",
  "bitable_image"
]);
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test --test-name-pattern "names selected images" tests\feishu-sync-content-route.test.ts
```

Expected: FAIL because the route currently submits `bitable_file`.

- [x] **Step 3: Restore the image upload point**

Change only the upload-point value:

```ts
form.append("parent_type", "bitable_image");
```

- [x] **Step 4: Verify the focused test, full suite, build, and diff**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test --test-name-pattern "names selected images" tests\feishu-sync-content-route.test.ts
npm.cmd test
npm.cmd run build
git diff --check
```

Expected: the focused test, full suite, and production build pass; the diff check produces no output.

- [x] **Step 5: Commit and push to remote main**

```powershell
git add -- app/api/feishu/sync-content/route.ts tests/feishu-sync-content-route.test.ts docs/superpowers/specs/2026-07-21-feishu-attachment-order-design.md docs/superpowers/plans/2026-07-21-feishu-attachment-order.md
git commit -m "fix: restore Feishu image uploads"
git push origin HEAD:main
```
