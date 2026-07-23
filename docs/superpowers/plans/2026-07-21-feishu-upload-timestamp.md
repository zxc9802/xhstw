# Feishu Upload Timestamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write each material's current server-side upload time to the Feishu Base date field named `上传日期` and display it to the second.

**Architecture:** Capture one Unix millisecond timestamp at the start of each `POST /api/feishu/sync-content` request. A small exported pure function admits that value only when the live field map says `上传日期` is a Feishu date field (type 5), after which the existing record-field filter and create-record request remain unchanged. Update the live field formatter once through Feishu Open API; do not mutate schema during later uploads.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Node.js test runner through `tsx`, Feishu Bitable Open API, PowerShell.

---

### Task 1: Add the upload timestamp to created Feishu records

**Files:**
- Create: `tests/feishu-upload-date.test.ts`
- Create: `lib/utils/feishu-upload-date.ts`
- Modify: `app/api/feishu/sync-content/route.ts:114-161`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/feishu-upload-date.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { getFeishuUploadDateValue } from "../lib/utils/feishu-upload-date";

const uploadedAt = 1_784_633_845_678;

test("returns the exact upload timestamp for a Feishu date field", () => {
  const fields = new Map([["上传日期", 5]]);

  assert.equal(getFeishuUploadDateValue(fields, uploadedAt), uploadedAt);
});

test("omits the upload timestamp when the field is absent", () => {
  assert.equal(getFeishuUploadDateValue(new Map(), uploadedAt), "");
});

test("omits the upload timestamp when the field is not a date", () => {
  const fields = new Map([["上传日期", 1]]);

  assert.equal(getFeishuUploadDateValue(fields, uploadedAt), "");
});
```

- [ ] **Step 2: Run the target test and verify RED**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test tests\feishu-upload-date.test.ts
```

Expected: FAIL because `lib/utils/feishu-upload-date.ts` does not exist yet.

- [ ] **Step 3: Add the minimal production behavior**

Create `lib/utils/feishu-upload-date.ts`:

```ts
export function getFeishuUploadDateValue(fields: ReadonlyMap<string, number>, uploadedAt: number) {
  return fields.get("上传日期") === 5 ? uploadedAt : "";
}
```

Import the helper in `app/api/feishu/sync-content/route.ts`:

```ts
import { getFeishuUploadDateValue } from "@/lib/utils/feishu-upload-date";
```

At the beginning of the `try` block in `POST`, capture the timestamp once before the first `await`:

```ts
const uploadedAt = Date.now();
```

Add the matching candidate field without changing adjacent field mappings:

```ts
上传日期: getFeishuUploadDateValue(fields, uploadedAt),
```

Place it after `账号` and before the image fields. The existing `recordFields` filter removes the empty string when the field is missing or has the wrong type.

- [ ] **Step 4: Run the target test and verify GREEN**

Run:

```powershell
.\node_modules\.bin\tsx.cmd --test tests\feishu-upload-date.test.ts
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Verify the repository tests and production build**

Run:

```powershell
npm.cmd test
npm.cmd run build
```

Expected: all tests pass and the Next.js production build exits with code 0.

- [ ] **Step 6: Commit the tested code change**

```powershell
git add -- app/api/feishu/sync-content/route.ts lib/utils/feishu-upload-date.ts tests/feishu-upload-date.test.ts docs/superpowers/plans/2026-07-21-feishu-upload-timestamp.md
git diff --cached --check
git commit -m "feat: record Feishu material upload time"
```

### Task 2: Show seconds in the live Feishu date field

**Files:**
- Modify externally: Feishu Base field `上传日期`

- [ ] **Step 1: Read and validate the live field before mutation**

Run this from the worktree. It reads credentials from `.env.local`, resolves the configured table, and refuses to continue unless `上传日期` is still a date field:

```powershell
$taskEnv = @{}
Get-Content -LiteralPath '.env.local' -Encoding utf8 | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') {
    $taskEnv[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
  }
}
$taskAppId = $taskEnv['FEISHU_APP_ID']
$taskAppSecret = $taskEnv['FEISHU_APP_SECRET']
$taskBaseUrl = $taskEnv['FEISHU_BASE_URL']
$taskAppToken = $taskEnv['FEISHU_APP_TOKEN']
$taskTableId = $taskEnv['FEISHU_TABLE_ID']
if (-not $taskAppToken -and $taskBaseUrl -match '/base/([^/?#]+)') { $taskAppToken = $matches[1] }
if (-not $taskAppId -or -not $taskAppSecret -or -not $taskAppToken) { throw 'Missing Feishu configuration' }
$taskAuthBody = @{ app_id = $taskAppId; app_secret = $taskAppSecret } | ConvertTo-Json
$taskAuth = Invoke-RestMethod -Method Post -Uri 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' -ContentType 'application/json' -Body $taskAuthBody
$taskHeaders = @{ Authorization = "Bearer $($taskAuth.tenant_access_token)" }
if (-not $taskTableId) {
  $taskTables = Invoke-RestMethod -Method Get -Uri "https://open.feishu.cn/open-apis/bitable/v1/apps/$taskAppToken/tables" -Headers $taskHeaders
  $taskTableId = $taskTables.data.items[0].table_id
}
$taskFieldsUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$taskAppToken/tables/$taskTableId/fields?page_size=100"
$taskFields = Invoke-RestMethod -Method Get -Uri $taskFieldsUri -Headers $taskHeaders
$taskUploadField = $taskFields.data.items | Where-Object { $_.field_name -eq '上传日期' }
if (-not $taskUploadField) { throw 'Field 上传日期 was not found' }
if ($taskUploadField.type -ne 5) { throw 'Field 上传日期 is not a date field' }
$taskUploadField | Select-Object field_id,field_name,type,property
```

Expected before update: type `5`, with `property.date_formatter` equal to `yyyy/MM/dd`.

- [ ] **Step 2: Update only the date formatter**

Continue in the same PowerShell session so the validated IDs and access token are reused:

```powershell
$taskFieldUri = "https://open.feishu.cn/open-apis/bitable/v1/apps/$taskAppToken/tables/$taskTableId/fields/$($taskUploadField.field_id)"
$taskUpdateBody = @{
  field_name = '上传日期'
  type = 5
  property = @{
    auto_fill = $false
    date_formatter = 'yyyy/MM/dd HH:mm:ss'
  }
} | ConvertTo-Json -Depth 5
$taskUpdate = Invoke-RestMethod -Method Put -Uri $taskFieldUri -Headers $taskHeaders -ContentType 'application/json; charset=utf-8' -Body $taskUpdateBody
if ($taskUpdate.code -ne 0) { throw "Feishu field update failed: $($taskUpdate.msg)" }
```

Expected: Feishu returns code `0` and keeps the field name and type unchanged.

- [ ] **Step 3: Re-read the field and verify the display format**

```powershell
$taskFieldsAfter = Invoke-RestMethod -Method Get -Uri $taskFieldsUri -Headers $taskHeaders
$taskUploadFieldAfter = $taskFieldsAfter.data.items | Where-Object { $_.field_name -eq '上传日期' }
if ($taskUploadFieldAfter.type -ne 5) { throw 'Field type changed unexpectedly' }
if ($taskUploadFieldAfter.property.date_formatter -ne 'yyyy/MM/dd HH:mm:ss') { throw 'Date formatter was not updated' }
$taskUploadFieldAfter | Select-Object field_name,type,property
```

Expected: type `5` and `property.date_formatter` equal to `yyyy/MM/dd HH:mm:ss`.

### Task 3: Final verification and handoff

**Files:**
- Verify: `app/api/feishu/sync-content/route.ts`
- Verify: `lib/utils/feishu-upload-date.ts`
- Verify: `tests/feishu-upload-date.test.ts`

- [ ] **Step 1: Run fresh verification**

```powershell
git diff --check
npm.cmd test
npm.cmd run build
git status --short
```

Expected: no whitespace errors, all tests pass, build exits 0, and the worktree contains no uncommitted production/test changes.

- [ ] **Step 2: Review the committed diff against the design**

```powershell
git show --stat --oneline HEAD
git show --format=fuller -- app/api/feishu/sync-content/route.ts lib/utils/feishu-upload-date.ts tests/feishu-upload-date.test.ts
```

Confirm all changed production lines trace directly to timestamp capture, field-type validation, or the test. Do not include unrelated dependency upgrades or formatter changes in source code.

- [ ] **Step 3: Report evidence boundaries**

Report separately:

1. code tests and build results;
2. live Feishu field formatter verification;
3. whether a deployed application and a fresh real material upload were exercised. If deployment and real upload were not requested or performed, state that explicitly.
