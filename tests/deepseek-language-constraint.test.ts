import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

function deepSeekResponse(content: unknown) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

test("a no-Chinese prompt retries once and only returns compliant copy", async (t: TestContext) => {
  const previous = {
    COPY_MODEL_PROVIDER: process.env.COPY_MODEL_PROVIDER,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY
  };
  process.env.COPY_MODEL_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<{ messages?: Array<{ content?: string }>; temperature?: number }> = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }>; temperature?: number };
    requestBodies.push(body);
    if (requestBodies.length === 1) {
      return deepSeekResponse({
        copies: [{ id: "A1", style: "Diary", summary: "仍有中文", body: "This draft still has 中文." }]
      });
    }
    return deepSeekResponse({
      copies: [{ id: "A1", style: "Diary", summary: "An honest daily note.", body: "A natural first-person product diary." }]
    });
  }) as typeof fetch;

  const { generateCopiesWithDeepSeek } = await import("../lib/adapters/deepseek");
  const result = await generateCopiesWithDeepSeek({
    prompt: "仿写出来的不要中文",
    reference: { title: "参考标题", copy: "参考正文", platform: "小红书" }
  });

  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[0].messages?.map((message) => message.content).join("\n") ?? "", /不得包含任何中文/);
  assert.ok((requestBodies[1].temperature ?? 1) < (requestBodies[0].temperature ?? 0));
  assert.equal(result.provider, "deepseek");
  assert.equal(/[\u3400-\u9fff]/u.test(result.copies[0].body), false);
});
