import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../app/api/image/generate/route";
import { GET } from "../app/api/image/generate/[jobId]/route";
import { GET as GET_REFERENCE } from "../app/api/image/reference/[token]/route";
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

const IMAGE2_ENV = {
  IMAGE_MODEL_PROVIDER: "openapi",
  GPT_IMAGE2_API_URL: "https://provider.test/openApi/generate",
  GPT_IMAGE2_QUERY_URL: "https://provider.test/openApi/queryResult",
  GPT_IMAGE2_PROJECT_CODE: "project-code",
  GPT_IMAGE2_ACCESS_KEY: "access-key",
  GPT_IMAGE2_SECRET_KEY: "secret-key",
  GPT_IMAGE2_MODEL_ID: "gpt-image2-low",
  GPT_IMAGE2_POLL_INTERVAL_MS: "0",
  GPT_IMAGE2_POLL_MAX_ATTEMPTS: "2"
} as const;

function useImage2Provider(t: TestContext) {
  const keys = [...Object.keys(IMAGE2_ENV), "YUNWU_API_KEY"];
  const previous: Record<string, string | undefined> = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, IMAGE2_ENV);
  delete process.env.YUNWU_API_KEY;
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function useYunwuProvider(t: TestContext) {
  const keys = [
    "IMAGE_MODEL_PROVIDER",
    "YUNWU_API_KEY",
    "YUNWU_IMAGE_URL",
    "YUNWU_IMAGE_EDIT_URL",
    "GPT_IMAGE2_PROJECT_CODE",
    "GPT_IMAGE2_ACCESS_KEY",
    "GPT_IMAGE2_SECRET_KEY"
  ];
  const previous: Record<string, string | undefined> = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  process.env.IMAGE_MODEL_PROVIDER = "yunwu";
  process.env.YUNWU_API_KEY = "test-yunwu-key";
  process.env.YUNWU_IMAGE_URL = "https://yunwu.test/v1/images/generations";
  process.env.YUNWU_IMAGE_EDIT_URL = "https://yunwu.test/v1/images/edits";
  delete process.env.GPT_IMAGE2_PROJECT_CODE;
  delete process.env.GPT_IMAGE2_ACCESS_KEY;
  delete process.env.GPT_IMAGE2_SECRET_KEY;
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function waitForJob(jobId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await GET(new Request("https://app.test"), {
      params: Promise.resolve({ jobId })
    });
    const payload = await response.json();
    if (payload.data?.status === "completed" || payload.data?.status === "failed") {
      return payload.data as { status: string; error?: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("job did not finish");
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

test("publishes local Image 2.0 references and preserves public URLs in resources", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let requestBody: {
    payload: { resources: string[] };
  } | undefined;
  let temporaryToken = "";
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as {
      payload: { resources: string[] };
    };
    const temporaryUrl = new URL(requestBody.payload.resources[0]);
    temporaryToken = temporaryUrl.pathname.split("/").pop() || "";
    const reference = await GET_REFERENCE(new Request(temporaryUrl), {
      params: Promise.resolve({ token: temporaryToken })
    });
    assert.equal(reference.status, 200);
    assert.deepEqual(
      [...new Uint8Array(await reference.arrayBuffer())],
      [137, 80, 78, 71, 13, 10, 26, 10]
    );
    return Response.json({
      success: true,
      data: { images: [{ url: "https://img.test/generated.jpg" }] }
    });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://0.0.0.0:3000/api/image/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-Host": "xhstw.qycm.top",
      "X-Forwarded-Proto": "https"
    },
    body: JSON.stringify({
      provider: "Image 2.0",
      prompt: "只换背景",
      count: 1,
      sourceImageUrls: [
        "data:image/png;base64,iVBORw0KGgo=",
        "https://img.test/existing.jpg"
      ]
    })
  }));
  const created = await response.json();
  const job = await waitForJob(created.data.jobId);

  assert.equal(job.status, "completed");
  assert.match(
    requestBody!.payload.resources[0],
    /^https:\/\/xhstw\.qycm\.top\/api\/image\/reference\/[0-9a-f-]{36}$/
  );
  assert.equal(requestBody!.payload.resources[1], "https://img.test/existing.jpg");

  const cleaned = await GET_REFERENCE(new Request("https://xhstw.qycm.top"), {
    params: Promise.resolve({ token: temporaryToken })
  });
  assert.equal(cleaned.status, 404);
});

test("keeps local reference data available to direct Yunwu edits", async (t) => {
  useYunwuProvider(t);
  const previousFetch = globalThis.fetch;
  let editForm: FormData | undefined;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://yunwu.test/v1/images/edits");
    editForm = init?.body as FormData;
    return Response.json({ data: [{ url: "https://img.test/yunwu-edit.jpg" }] });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "Image 2.0",
      prompt: "只换背景",
      sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo="]
    })
  }));
  const created = await response.json();
  assert.equal(response.status, 202);
  const job = await waitForJob(created.data.jobId);

  assert.equal(job.status, "completed");
  assert.equal(editForm?.getAll("image").length, 1);
});

test("rejects private remote reference URLs before direct Yunwu edits", async (t) => {
  useYunwuProvider(t);
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({ data: [{ url: "https://img.test/yunwu-edit.jpg" }] });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "Image 2.0",
      prompt: "只换背景",
      sourceImageUrls: ["http://127.0.0.1/internal-image.png"]
    })
  }));
  const payload = await response.json();
  if (response.status === 202) await waitForJob(payload.data.jobId);

  assert.equal(response.status, 400);
  assert.equal(fetchCalls, 0);
});

test("rejects IPv6-mapped loopback reference URLs before direct Yunwu edits", async (t) => {
  useYunwuProvider(t);
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({ data: [{ url: "https://img.test/yunwu-edit.jpg" }] });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "Image 2.0",
      prompt: "只换背景",
      sourceImageUrls: ["https://[::ffff:127.0.0.1]/internal-image.png"]
    })
  }));

  assert.equal(response.status, 400);
  assert.equal(fetchCalls, 0);
});

test("cleans temporary references when Image 2.0 generation fails", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let temporaryToken = "";
  let fetchCalls = 0;
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      payload: { resources: string[] };
    };
    temporaryToken = new URL(body.payload.resources[0]).pathname.split("/").pop() || "";
    return Response.json({ success: false, msg: "渠道失败" });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "Image 2.0",
      prompt: "只换背景",
      sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo="]
    })
  }));
  const created = await response.json();
  const job = await waitForJob(created.data.jobId);

  assert.equal(job.status, "failed");
  assert.equal(fetchCalls, 4);
  const cleaned = await GET_REFERENCE(new Request("https://app.test"), {
    params: Promise.resolve({ token: temporaryToken })
  });
  assert.equal(cleaned.status, 404);
});

test("rejects invalid local references before creating an image job", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response();
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "Image 2.0",
      sourceImageUrls: ["data:image/png;base64,***"]
    })
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(fetchCalls, 0);
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
