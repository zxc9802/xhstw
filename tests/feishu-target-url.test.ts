import assert from "node:assert/strict";
import test from "node:test";
import { buildFeishuBaseUrl } from "../lib/adapters/feishu-target";

test("builds a Feishu Base URL for the table actually used by sync", () => {
  assert.equal(
    buildFeishuBaseUrl("app token", "table/id"),
    "https://feishu.cn/base/app%20token?table=table%2Fid"
  );
});
