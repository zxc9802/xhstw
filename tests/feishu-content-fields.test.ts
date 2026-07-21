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
