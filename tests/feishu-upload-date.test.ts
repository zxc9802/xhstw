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
