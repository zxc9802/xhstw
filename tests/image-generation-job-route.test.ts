import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../app/api/image/generate/route";
import { GET } from "../app/api/image/generate/[jobId]/route";
import { GET as GET_REFERENCE } from "../app/api/image/reference/[token]/route";
import { GET as GET_RESULT } from "../app/api/image/result/[token]/route";
import {
  getImageGenerationResult,
  IMAGE_GENERATION_RESULT_TTL_MS
} from "../lib/adapters/image-generation-result-store";

function useMockImageProvider(t: TestContext) {
  const previous = process.env.IMAGE_MODEL_PROVIDER;
  process.env.IMAGE_MODEL_PROVIDER = "mock";
  t.after(() => {
    if (previous === undefined) delete process.env.IMAGE_MODEL_PROVIDER;
    else process.env.IMAGE_MODEL_PROVIDER = previous;
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
      return payload.data as { status: string; error?: string; result?: unknown };
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("job did not finish");
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

test("keeps the job processing until provider images are cached locally", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let imageDownloadStarted = false;
  let resolveImageDownload: ((response: Response) => void) | undefined;
  globalThis.fetch = async (url) => {
    if (String(url) === IMAGE2_ENV.GPT_IMAGE2_API_URL) {
      return Response.json({
        success: true,
        data: { images: [{ url: "https://img.test/generated.jpg" }] }
      });
    }
    if (String(url) === "https://img.test/generated.jpg") {
      imageDownloadStarted = true;
      return new Promise<Response>((resolve) => {
        resolveImageDownload = resolve;
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "Image 2.0", prompt: "test", count: 1 })
  }));
  const created = await response.json();

  for (let attempt = 0; attempt < 20 && !imageDownloadStarted; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const processingResponse = await GET(new Request("https://app.test"), {
    params: Promise.resolve({ jobId: created.data.jobId })
  });
  const processingPayload = await processingResponse.json();

  assert.equal(imageDownloadStarted, true);
  assert.equal(processingPayload.data.status, "processing");

  resolveImageDownload!(new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
    headers: { "Content-Type": "image/jpeg" }
  }));
  const completed = await waitForJob(created.data.jobId);
  const imageUrl = String(
    ((completed.result as { images?: Array<{ url?: unknown }> })?.images?.[0]?.url) || ""
  );

  assert.equal(completed.status, "completed");
  assert.match(imageUrl, /^https:\/\/app\.test\/api\/image\/result\/[0-9a-f-]{36}$/);
  const token = new URL(imageUrl).pathname.split("/").pop() || "";
  const imageResponse = await GET_RESULT(new Request(imageUrl), {
    params: Promise.resolve({ token })
  });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("Content-Type"), "image/jpeg");
  assert.equal(imageResponse.headers.get("Content-Length"), "4");
  assert.deepEqual(
    [...new Uint8Array(await imageResponse.arrayBuffer())],
    [0xff, 0xd8, 0xff, 0xd9]
  );
  assert.equal(
    getImageGenerationResult(token, Date.now() + IMAGE_GENERATION_RESULT_TTL_MS + 1),
    undefined
  );
});

test("records a provider image download error before completing the job", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === IMAGE2_ENV.GPT_IMAGE2_API_URL) {
      return Response.json({
        success: true,
        data: { images: [{ url: "https://img.test/unavailable.jpg" }] }
      });
    }
    if (String(url) === "https://img.test/unavailable.jpg") {
      return new Response(null, { status: 524 });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "Image 2.0", prompt: "test", count: 1 })
  }));
  const created = await response.json();
  const failed = await waitForJob(created.data.jobId);

  assert.equal(failed.status, "failed");
  assert.equal(failed.result, undefined);
  assert.match(failed.error || "", /成品图片后台下载失败：HTTP 524/);
});

test("returns 404 when a cached result image is unknown", async () => {
  const response = await GET_RESULT(new Request("https://app.test/api/image/result/missing"), {
    params: Promise.resolve({ token: "missing" })
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /不存在或已过期/);
});

test("publishes local Image 2.0 references and preserves public URLs in resources", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let requestBody: {
    payload: { resources: string[] };
  } | undefined;
  let temporaryToken = "";
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://img.test/generated.jpg") {
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { "Content-Type": "image/jpeg" }
      });
    }
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
    String(((job.result as { images?: Array<{ url?: unknown }> })?.images?.[0]?.url) || ""),
    /^https:\/\/xhstw\.qycm\.top\/api\/image\/result\/[0-9a-f-]{36}$/
  );
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
    if (String(url) === "https://img.test/yunwu-edit.jpg") {
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { "Content-Type": "image/jpeg" }
      });
    }
    assert.equal(String(url), "https://yunwu.test/v1/images/edits");
    editForm = init?.body as FormData;
    return Response.json({ data: [{ url: "https://img.test/yunwu-edit.jpg" }] });
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
