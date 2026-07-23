import assert from "node:assert/strict";
import test from "node:test";
import { POST as collect } from "../app/api/topics/opencli-xhs/route";
import { POST as openLink } from "../app/api/topics/open-xhs-link/route";
import { GET as mediaProxy } from "../app/api/topics/media-proxy/route";

test("server xhs routes are permanently disabled", async () => {
  const [collectResponse, openResponse, mediaResponse] = await Promise.all([
    collect(),
    openLink(),
    mediaProxy()
  ]);

  for (const response of [collectResponse, openResponse, mediaResponse]) {
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "LOCAL_EXTENSION_REQUIRED",
      message: "小红书抓取已迁移到用户本机浏览器扩展，服务器不再执行该操作。"
    });
  }
});
