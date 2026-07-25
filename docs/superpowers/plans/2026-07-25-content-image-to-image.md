# 图文生产自动图生图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让图文生产中已解析的小红书图片自动作为对应规划页的参考图，并让配置为 Yunwu 时的 Image 2.0 直接使用 GPT Image 2 图生图接口。

**Architecture:** 页面将解析图片按顺序写入 `planSourceMap`，只填充没有手动参考图的规划页。服务端在 `IMAGE_MODEL_PROVIDER=yunwu` 时根据是否存在 `sourceImageUrls` 直接选择 Yunwu generations 或 edits；其他首发与兜底路径不变。

**Tech Stack:** Next.js、TypeScript、Node test runner、tsx。

---

### Task 1: 图文页自动绑定解析图片

**Files:**
- Modify: `app/content/page.tsx`
- Test: `tests/content-production-contract.test.ts`

- [x] Write a failing contract test for `autoAssignReferenceImagesToPlans` and its protection of populated `planSourceMap` pages.
- [x] Run `npm.cmd exec -- tsx --test tests/content-production-contract.test.ts` and verify the new assertion fails.
- [x] Implement a focused helper that creates one page per parsed image and assigns references by page number only when that page has no manual reference image; invoke it after successful link parsing.
- [x] Re-run the same contract test and verify it passes.

### Task 2: Yunwu direct Image 2.0 routing

**Files:**
- Modify: `lib/adapters/openai-image.ts`
- Test: `tests/openapi-image.test.ts`

- [x] Write failing tests proving `IMAGE_MODEL_PROVIDER=yunwu` sends a reference-image request to `/images/edits` and a no-reference request to `/images/generations` without project OpenAPI credentials.
- [x] Run `npm.cmd exec -- tsx --test tests/openapi-image.test.ts` and verify the tests fail because the adapter currently returns mock images first.
- [x] Add the smallest direct-Yunwu branch and reuse the existing image result format without modifying the primary OpenAPI or fallback behavior.
- [x] Keep direct Yunwu local reference data local to the server and reject private remote reference URLs before a server-side fetch.
- [x] Re-run the OpenAPI image test file and verify it passes.

### Task 3: Regression verification

**Files:**
- Test: `tests/content-production-contract.test.ts`
- Test: `tests/openapi-image.test.ts`
- Test: `tests/image-generation-job-route.test.ts`
- Test: `tests/image-reference-store.test.ts`

- [x] Run `npm.cmd exec -- tsx --test tests/content-production-contract.test.ts tests/openapi-image.test.ts tests/image-generation-job-route.test.ts tests/image-reference-store.test.ts tests/xhs-reference-media.test.ts`.
- [x] Run `npm.cmd test` and inspect the exit code and failure count.
