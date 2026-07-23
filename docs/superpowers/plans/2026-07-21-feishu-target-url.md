# 飞书同步目标链接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让飞书同步后的页面跳转始终指向本次实际写入的 Base 和数据表。

**Architecture:** 服务端以最终解析出的 `appToken/tableId` 生成目标 URL 并返回。前端不再维护独立目标配置，只消费同步接口返回的 URL。

**Tech Stack:** Next.js 15、TypeScript、Node test runner、tsx

---

### Task 1: 服务端返回真实飞书目标 URL

**Files:**
- Modify: `app/api/feishu/sync-content/route.ts`
- Create: `lib/adapters/feishu-target.ts`
- Create: `tests/feishu-target-url.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildFeishuBaseUrl } from "../lib/adapters/feishu-target";

test("builds a Feishu Base URL for the table actually used by sync", () => {
  assert.equal(
    buildFeishuBaseUrl("app token", "table/id"),
    "https://feishu.cn/base/app%20token?table=table%2Fid"
  );
});
```

- [ ] **Step 2: 运行测试并确认因为函数不存在而失败**

Run: `npm.cmd test -- tests/feishu-target-url.test.ts`

Expected: FAIL，提示没有导出的 `buildFeishuBaseUrl`。

- [ ] **Step 3: 添加最小实现并返回 URL**

```ts
export function buildFeishuBaseUrl(appToken: string, tableId: string) {
  return `https://feishu.cn/base/${encodeURIComponent(appToken)}?table=${encodeURIComponent(tableId)}`;
}
```

在成功响应中增加 `baseUrl: buildFeishuBaseUrl(appToken, tableId)`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm.cmd test -- tests/feishu-target-url.test.ts`

Expected: PASS。

### Task 2: 前端只打开接口返回的 URL

**Files:**
- Modify: `app/content-library/page.tsx`

- [ ] **Step 1: 删除固定链接并读取 `data.data.baseUrl`**

让 `syncContentToFeishu` 返回 `baseUrl`；单条同步直接打开它，批量同步保存循环返回的 URL 并在全部完成后打开。

- [ ] **Step 2: 检查固定 Token 已消失**

Run: `rg -n "FIwCbNZxAaKdgUsqTaTcYp1cnPf|const FEISHU_BASE_URL" app`

Expected: 无输出。

- [ ] **Step 3: 运行完整验证**

Run: `npm.cmd test`

Expected: 全部测试通过。

Run: `npm.cmd run build`

Expected: 构建退出码为 0。
