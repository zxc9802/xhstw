import assert from "node:assert/strict";
import test from "node:test";
import { feishuSyncPlatformOptions, platforms } from "../lib/constants/platforms";

test("offers all supported Feishu sync platforms without expanding global platforms", () => {
  assert.deepEqual(feishuSyncPlatformOptions, ["小红书", "TikTok", "Instagram", "Facebook"]);
  assert.deepEqual(platforms, ["小红书"]);
});
