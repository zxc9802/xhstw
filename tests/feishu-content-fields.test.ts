import assert from "node:assert/strict";
import test from "node:test";
import { resolveFeishuContentFieldNames, resolveFeishuTagFieldValue } from "../lib/adapters/feishu-content-fields";

test("matches the current Feishu content fields", () => {
  const fields = new Map<string, number>([
    ["上传日期", 5],
    ["创作内容", 17],
    ["标题", 1],
    ["正文标签", 1]
  ]);

  assert.deepEqual(resolveFeishuContentFieldNames(fields), {
    titleFieldName: "标题",
    attachmentFieldName: "创作内容",
    tagFieldName: "正文标签"
  });
});

test("keeps the original content-title and image aliases", () => {
  const fields = new Map<string, number>([
    ["内容标题", 1],
    ["图片", 17]
  ]);

  assert.deepEqual(resolveFeishuContentFieldNames(fields), {
    titleFieldName: "内容标题",
    attachmentFieldName: "图片",
    tagFieldName: undefined
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

test("matches common keyword aliases without changing other fields", () => {
  const fields = new Map<string, number>([
    ["标题", 1],
    ["关键词", 4]
  ]);

  assert.deepEqual(resolveFeishuContentFieldNames(fields), {
    titleFieldName: "标题",
    attachmentFieldName: undefined,
    tagFieldName: "关键词"
  });
  assert.deepEqual(resolveFeishuTagFieldValue(fields, "关键词", ["#防晒", " 通勤 "]), ["防晒", "通勤"]);
});

test("keeps text tag fields in the existing hashtag format", () => {
  const fields = new Map<string, number>([["小红书tag", 1]]);

  assert.equal(resolveFeishuTagFieldValue(fields, "小红书tag", ["防晒", "#通勤"]), "#防晒 #通勤");
});
