import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../app/api/image/generate/route";
import { GET } from "../app/api/image/generate/[jobId]/route";
import { GET as GET_TEMP_ASSET } from "../app/temp-assets/[filename]/route";
import { GET as GET_RESULT } from "../app/api/image/result/[token]/route";
import { extractGeneratedImageUrls } from "../lib/utils/image-generation-job-client";
import {
  getImageGenerationResult,
  IMAGE_GENERATION_RESULT_DOWNLOAD_CONCURRENCY,
  IMAGE_GENERATION_RESULT_DOWNLOAD_MAX_ATTEMPTS,
  IMAGE_GENERATION_RESULT_DOWNLOAD_TIMEOUT_MS,
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
  const keys = [...Object.keys(IMAGE2_ENV), "YUNWU_API_KEY", "PUBLIC_BASE_URL"];
  const previous: Record<string, string | undefined> = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, IMAGE2_ENV);
  delete process.env.YUNWU_API_KEY;
  delete process.env.PUBLIC_BASE_URL;
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

function useOpenluxProvider(t: TestContext) {
  const values = {
    OPENLUX_API_KEY: "test-openlux-key",
    OPENLUX_IMAGE_URL: "https://openlux.test/v1/images/generations",
    OPENLUX_IMAGE_EDIT_URL: "https://openlux.test/v1/images/edits",
    OPENLUX_IMAGE_MODEL: "gpt-image-2-c"
  } as const;
  const keys = Object.keys(values);
  const previous: Record<string, string | undefined> = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function useApiyiProvider(t: TestContext) {
  const values = {
    APIYI_IMAGE_API_KEY: "test-apiyi-key",
    APIYI_IMAGE_URL: "https://apiyi.test/v1/images/generations",
    APIYI_IMAGE_EDIT_URL: "https://apiyi.test/v1/images/edits",
    APIYI_IMAGE_MODEL: "gpt-image-2-vip"
  } as const;
  const keys = Object.keys(values);
  const previous: Record<string, string | undefined> = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function useNanobananaNewProvider(t: TestContext) {
  const values = {
    IMAGE_AGGREGATION_API_BASE_URL: "https://aggregation.test",
    IMAGE_AGGREGATION_PROJECT_CODE: "project-code",
    IMAGE_AGGREGATION_ACCESS_KEY: "access-key",
    IMAGE_AGGREGATION_SECRET_KEY: "secret-key",
    NANOBANANA_NEW_MODEL_ID: "gemini-3.1-flash-image-preview",
    NANOBANANA_NEW_POLL_INTERVAL_MS: "0",
    NANOBANANA_NEW_POLL_MAX_ATTEMPTS: "2"
  } as const;
  const keys = [...Object.keys(values), "PUBLIC_BASE_URL"];
  const previous: Record<string, string | undefined> = Object.fromEntries(
    keys.map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, values);
  delete process.env.PUBLIC_BASE_URL;
  t.after(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const TEMP_ASSET_URL = /^https:\/\/[^/]+\/temp-assets\/\d+-[0-9a-f-]{36}\.png\?exp=\d+&sig=[A-Za-z0-9_-]+$/;

function tempAssetFilename(url: string) {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
}

async function fetchTempAsset(url: string) {
  return GET_TEMP_ASSET(new Request(url), {
    params: Promise.resolve({ filename: tempAssetFilename(url) })
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

test("uses the requested generated-image download policy", () => {
  assert.equal(IMAGE_GENERATION_RESULT_DOWNLOAD_TIMEOUT_MS, 2 * 60 * 1000);
  assert.equal(IMAGE_GENERATION_RESULT_DOWNLOAD_MAX_ATTEMPTS, 3);
  assert.equal(IMAGE_GENERATION_RESULT_DOWNLOAD_CONCURRENCY, 2);
});

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
  assert.match(imageUrl, /^\/api\/image\/result\/[0-9a-f-]{36}$/);
  assert.deepEqual(extractGeneratedImageUrls(completed.result), [imageUrl]);
  const token = imageUrl.split("/").pop() || "";
  const imageResponse = await GET_RESULT(new Request(`https://app.test${imageUrl}`), {
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

test("retries a transient image download and completes on the third attempt", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let downloadAttempts = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === IMAGE2_ENV.GPT_IMAGE2_API_URL) {
      return Response.json({
        success: true,
        data: { images: [{ url: "https://img.test/transient.jpg" }] }
      });
    }
    if (String(url) === "https://img.test/transient.jpg") {
      downloadAttempts += 1;
      if (downloadAttempts < 3) {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { "Content-Type": "image/jpeg" }
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
  const completed = await waitForJob(created.data.jobId);

  assert.equal(completed.status, "completed");
  assert.equal(downloadAttempts, 3);
  assert.equal(
    (completed.result as { images?: unknown[] })?.images?.length,
    1
  );
});

test("keeps successfully cached images when one provider image remains unavailable", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let providerRequests = 0;
  let failedDownloadAttempts = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === IMAGE2_ENV.GPT_IMAGE2_API_URL) {
      providerRequests += 1;
      return Response.json({
        success: true,
        data: {
          images: [{
            url: providerRequests === 1
              ? "https://img.test/available.jpg"
              : "https://img.test/unavailable-partial.jpg"
          }]
        }
      });
    }
    if (String(url) === "https://img.test/available.jpg") {
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { "Content-Type": "image/jpeg" }
      });
    }
    if (String(url) === "https://img.test/unavailable-partial.jpg") {
      failedDownloadAttempts += 1;
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
    body: JSON.stringify({ provider: "Image 2.0", prompt: "test", count: 2 })
  }));
  const created = await response.json();
  const completed = await waitForJob(created.data.jobId);
  const result = completed.result as { images?: unknown[]; warnings?: string[] };

  assert.equal(completed.status, "completed");
  assert.equal(result.images?.length, 1);
  assert.equal(failedDownloadAttempts, 3);
  assert.match(result.warnings?.[0] || "", /1 张成品图片后台下载失败，已保留其余 1 张/);
});

test("downloads generated images with a maximum concurrency of two", async (t) => {
  useImage2Provider(t);
  const previousFetch = globalThis.fetch;
  let providerRequests = 0;
  let activeDownloads = 0;
  let maximumActiveDownloads = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === IMAGE2_ENV.GPT_IMAGE2_API_URL) {
      providerRequests += 1;
      return Response.json({
        success: true,
        data: { images: [{ url: `https://img.test/concurrency-${providerRequests}.jpg` }] }
      });
    }
    if (/^https:\/\/img\.test\/concurrency-\d+\.jpg$/.test(String(url))) {
      activeDownloads += 1;
      maximumActiveDownloads = Math.max(maximumActiveDownloads, activeDownloads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeDownloads -= 1;
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { "Content-Type": "image/jpeg" }
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
    body: JSON.stringify({ provider: "Image 2.0", prompt: "test", count: 3 })
  }));
  const created = await response.json();
  const completed = await waitForJob(created.data.jobId);

  assert.equal(completed.status, "completed");
  assert.equal((completed.result as { images?: unknown[] })?.images?.length, 3);
  assert.equal(maximumActiveDownloads, 2);
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
  let temporaryUrl = "";
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://img.test/generated.jpg") {
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { "Content-Type": "image/jpeg" }
      });
    }
    requestBody = JSON.parse(String(init?.body)) as {
      payload: { resources: string[] };
    };
    temporaryUrl = requestBody.payload.resources[0];
    const reference = await fetchTempAsset(temporaryUrl);
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
    /^\/api\/image\/result\/[0-9a-f-]{36}$/
  );
  assert.match(requestBody!.payload.resources[0], TEMP_ASSET_URL);
  assert.match(requestBody!.payload.resources[0], /^https:\/\/xhstw\.qycm\.top\//);
  assert.equal(requestBody!.payload.resources[1], "https://img.test/existing.jpg");

  const cleaned = await fetchTempAsset(temporaryUrl);
  assert.equal(cleaned.status, 404);
});

test("routes nanobanan新 through the aggregation API and cleans temporary references", async (t) => {
  useNanobananaNewProvider(t);
  const previousFetch = globalThis.fetch;
  let submitBody: {
    modelId: string;
    abilityType: string;
    payload: { resources: string[] };
  } | undefined;
  let temporaryUrl = "";
  let queryCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/openApi/generate")) {
      submitBody = JSON.parse(String(init?.body)) as typeof submitBody;
      temporaryUrl = submitBody!.payload.resources[0];
      const reference = await fetchTempAsset(temporaryUrl);
      assert.equal(reference.status, 200);
      return Response.json({ success: true, data: { taskId: "nano-new-task" } });
    }
    if (String(url) === "https://aggregation.test/openApi/queryResult") {
      queryCalls += 1;
      return Response.json({
        success: true,
        data: {
          taskId: "nano-new-task",
          status: 2,
          images: [{ url: "https://img.test/nanobanana-new.jpg" }]
        }
      });
    }
    assert.equal(String(url), "https://img.test/nanobanana-new.jpg");
    return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { "Content-Type": "image/jpeg" }
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
      provider: "nanobanan新",
      prompt: "只替换背景",
      size: "9:16",
      sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo="]
    })
  }));
  const created = await response.json();
  const job = await waitForJob(created.data.jobId);

  assert.equal(job.status, "completed");
  assert.equal(submitBody?.modelId, "gemini-3.1-flash-image-preview");
  assert.equal(submitBody?.abilityType, "IMAGE");
  assert.match(submitBody!.payload.resources[0], TEMP_ASSET_URL);
  assert.match(submitBody!.payload.resources[0], /^https:\/\/xhstw\.qycm\.top\//);
  assert.equal(queryCalls, 1);

  const cleaned = await fetchTempAsset(temporaryUrl);
  assert.equal(cleaned.status, 404);
});

test("routes gpt-image-2-c through OpenLux and keeps local reference data for edits", async (t) => {
  useOpenluxProvider(t);
  const previousFetch = globalThis.fetch;
  let editForm: FormData | undefined;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://img.test/openlux-edit.jpg") {
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { "Content-Type": "image/jpeg" }
      });
    }
    assert.equal(String(url), "https://openlux.test/v1/images/edits");
    editForm = init?.body as FormData;
    return Response.json({ data: [{ url: "https://img.test/openlux-edit.jpg" }] });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "gpt-image-2-c",
      prompt: "只换背景",
      size: "3:4",
      sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo="]
    })
  }));
  const created = await response.json();
  assert.equal(response.status, 202);
  const job = await waitForJob(created.data.jobId);

  assert.equal(job.status, "completed");
  assert.equal(editForm?.get("model"), "gpt-image-2-c");
  assert.equal(editForm?.getAll("image").length, 1);
});

test("routes gpt-image2-vip through APIYI and keeps local references for edits", async (t) => {
  useApiyiProvider(t);
  const previousFetch = globalThis.fetch;
  let editForm: FormData | undefined;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://apiyi.test/v1/images/edits");
    editForm = init?.body as FormData;
    return Response.json({ data: [{ b64_json: "YWJj" }] });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "gpt-image2-vip",
      prompt: "只换背景",
      size: "3:4",
      sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo="]
    })
  }));
  const created = await response.json();
  assert.equal(response.status, 202);
  const job = await waitForJob(created.data.jobId);
  assert.equal(job.status, "completed");
  assert.equal(editForm?.get("model"), "gpt-image-2-vip");
  assert.equal(editForm?.getAll("image").length, 1);
});

test("rejects private remote references before APIYI edits", async (t) => {
  useApiyiProvider(t);
  const response = await POST(new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "gpt-image2-vip",
      prompt: "只换背景",
      sourceImageUrls: ["http://127.0.0.1/internal-image.png"]
    })
  }));
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.match(payload.message, /gpt-image2-vip 参考图仅支持公开 HTTPS/);
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
  let temporaryUrl = "";
  let fetchCalls = 0;
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      payload: { resources: string[] };
    };
    temporaryUrl = body.payload.resources[0];
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
  const cleaned = await fetchTempAsset(temporaryUrl);
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
