import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { requestTikTokRewrite, requestTikTokVideoJson } from "../lib/tiktok/rewrite";
import { getTikTokCapabilities } from "../lib/tiktok/provider";

function configure(t: TestContext) {
  const keys = ["TIKTOK_REWRITE_API_KEY", "TIKTOK_REWRITE_URL", "TIKTOK_REWRITE_MODEL", "DEEPSEEK_API_KEY", "COPY_MODEL_PROVIDER"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.TIKTOK_REWRITE_API_KEY = "test-rewrite-secret";
  delete process.env.TIKTOK_REWRITE_URL;
  delete process.env.TIKTOK_REWRITE_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.COPY_MODEL_PROVIDER = "mock";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test("TikTok uses the selected OpenLux model independently from the existing copy provider", async t => {
  configure(t);
  let requested = false;
  const result = await requestTikTokRewrite([{ role: "user", content: "reference" }], (async (url, init) => {
    requested = true;
    assert.equal(String(url), "https://api.openlux.ai/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-rewrite-secret");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gemini-3.8-flash");
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.ok(init?.signal);
    return Response.json({ choices: [{ message: { content: "```json\n{\"done\":true}\n```" } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
  }) as typeof fetch);
  assert.equal(requested, true);
  assert.deepEqual(result, { done: true });
  assert.equal(getTikTokCapabilities().production, true);
  assert.equal(getTikTokCapabilities().productionModel, "gemini-3.8-flash");
});

test("missing configuration and upstream failures never return mock content or leak the key", async t => {
  configure(t);
  const messages = [{ role: "user" as const, content: "reference" }];
  for (const payload of [{ choices: [] }, { choices: [{ message: { content: "[]" } }] }, { choices: [{ message: { content: "not json" } }] }]) {
    await assert.rejects(requestTikTokRewrite(messages, (async () => Response.json(payload)) as typeof fetch), /内容|JSON|对象/);
  }
  await assert.rejects(requestTikTokRewrite(messages, (async () => Response.json({ error: { message: "test-rewrite-secret" } }, { status: 401 })) as typeof fetch), error => {
    assert.match(String(error), /401/);
    assert.doesNotMatch(String(error), /test-rewrite-secret/);
    return true;
  });
  await assert.rejects(requestTikTokRewrite(messages, (async () => { throw new Error("test-rewrite-secret"); }) as typeof fetch), /连接失败|超时/);
  delete process.env.TIKTOK_REWRITE_API_KEY;
  assert.equal(getTikTokCapabilities().production, false);
  await assert.rejects(requestTikTokRewrite(messages), /TIKTOK_REWRITE_API_KEY/);
});

test("whole-video input uses the verified compatible media format rather than the ignored video_url field", async t => {
  configure(t);
  await requestTikTokVideoJson("Observe the actual original video", Buffer.from("video").toString("base64"), 17.2, (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const parts = body.messages[1].content;
    assert.equal(parts[1].type, "image_url");
    assert.match(parts[1].image_url.url, /^data:video\/mp4;base64,/);
    assert.doesNotMatch(JSON.stringify(body), /"video_url"/);
    assert.equal(body.model, "gemini-3.8-flash");
    return Response.json({ choices: [{ message: { content: '{"media":true}' } }] });
  }) as typeof fetch);
});
