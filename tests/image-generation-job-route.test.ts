import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../app/api/image/generate/route";
import { GET } from "../app/api/image/generate/[jobId]/route";

function useMockImageProvider(t: TestContext) {
  const previous = process.env.IMAGE_MODEL_PROVIDER;
  process.env.IMAGE_MODEL_PROVIDER = "mock";
  t.after(() => {
    if (previous === undefined) delete process.env.IMAGE_MODEL_PROVIDER;
    else process.env.IMAGE_MODEL_PROVIDER = previous;
  });
}

test("POST returns 202 with a queued image generation job", async (t) => {
  useMockImageProvider(t);

  const response = await POST(new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "Image 2.0", prompt: "test", count: 1 })
  }));
  const payload = await response.json();

  assert.equal(response.status, 202);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.status, "queued");
  assert.match(payload.data.jobId, /^[0-9a-f-]{36}$/);
});

test("GET returns the completed image generation result", async (t) => {
  useMockImageProvider(t);
  const createResponse = await POST(new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "Image 2.0", prompt: "test", count: 1 })
  }));
  const created = await createResponse.json();

  let payload: { data?: { status?: string; result?: unknown } } = {};
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ jobId: created.data.jobId })
    });
    payload = await response.json();
    if (payload.data?.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.equal(payload.data?.status, "completed");
  assert.equal(Array.isArray((payload.data?.result as { images?: unknown })?.images), true);
});

test("GET returns 404 for an unknown image generation job", async () => {
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ jobId: "missing" })
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /重新生成/);
});
