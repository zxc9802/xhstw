import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../app/api/image/generate/route";
import { GET } from "../app/api/image/generate/[jobId]/route";
import { createImageGenerationJob, runImageGenerationJob } from "../lib/adapters/image-generation-job-store";

function useMockImageProvider(t: TestContext) {
  const previous = process.env.IMAGE_MODEL_PROVIDER;
  process.env.IMAGE_MODEL_PROVIDER = "mock";
  t.after(() => {
    if (previous === undefined) delete process.env.IMAGE_MODEL_PROVIDER;
    else process.env.IMAGE_MODEL_PROVIDER = previous;
  });
}

function useImageProxySecret(t: TestContext) {
  const previous = process.env.GPT_IMAGE2_SECRET_KEY;
  process.env.GPT_IMAGE2_SECRET_KEY = "image-proxy-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.GPT_IMAGE2_SECRET_KEY;
    else process.env.GPT_IMAGE2_SECRET_KEY = previous;
  });
}

async function createImage2ProxyUrl(origin = "https://app.test", headers?: HeadersInit) {
  const job = createImageGenerationJob();
  await runImageGenerationJob(job.id, async () => ({
    provider: "Image 2.0",
    images: [{ url: "http://provider.test/generated/cat.jpg" }]
  }));
  const response = await GET(new Request(`${origin}/api/image/generate/${job.id}`, { headers }), {
    params: Promise.resolve({ jobId: job.id })
  });
  const payload = await response.json();
  return String(payload.data.result.images[0].url);
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

test("GET rewrites Image 2.0 results to a signed same-origin image URL", async (t) => {
  useImageProxySecret(t);
  const imageUrl = new URL(await createImage2ProxyUrl());

  assert.equal(imageUrl.origin, "https://app.test");
  assert.equal(imageUrl.pathname, "/api/image/generate/proxy");
  assert.equal(imageUrl.searchParams.get("source"), "http://provider.test/generated/cat.jpg");
  assert.match(imageUrl.searchParams.get("signature") || "", /^[A-Za-z0-9_-]{43}$/);
});

test("GET uses the forwarded public origin instead of Zeabur's internal listener", async (t) => {
  useImageProxySecret(t);
  const imageUrl = new URL(await createImage2ProxyUrl("https://0.0.0.0:3000", {
    "X-Forwarded-Host": "xhstw.qycm.top",
    "X-Forwarded-Proto": "https"
  }));

  assert.equal(imageUrl.origin, "https://xhstw.qycm.top");
  assert.equal(imageUrl.pathname, "/api/image/generate/proxy");
});

test("proxy GET streams a correctly signed provider image", async (t) => {
  useImageProxySecret(t);
  const proxyUrl = await createImage2ProxyUrl();
  const previousFetch = globalThis.fetch;
  let fetchedUrl = "";
  globalThis.fetch = async (input) => {
    fetchedUrl = String(input);
    return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { "Content-Type": "image/jpeg" }
    });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await GET(new Request(proxyUrl), {
    params: Promise.resolve({ jobId: "proxy" })
  });

  assert.equal(response.status, 200);
  assert.equal(fetchedUrl, "http://provider.test/generated/cat.jpg");
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0xff, 0xd8, 0xff, 0xd9]);
});

test("proxy GET rejects a tampered provider URL", async (t) => {
  useImageProxySecret(t);
  const proxyUrl = new URL(await createImage2ProxyUrl());
  proxyUrl.searchParams.set("source", "http://provider.test/generated/other.jpg");
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response();
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await GET(new Request(proxyUrl), {
    params: Promise.resolve({ jobId: "proxy" })
  });

  assert.equal(response.status, 403);
  assert.equal(fetchCalls, 0);
});
