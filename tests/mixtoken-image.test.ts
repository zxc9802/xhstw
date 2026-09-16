import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../app/api/image/generate/route";
import { GET } from "../app/api/image/generate/[jobId]/route";

function useMixtoken(t: TestContext, fetcher: typeof fetch) {
  const values = {
    IMAGE_MODEL_PROVIDER: "mock",
    MIXTOKEN_API_KEY: "test-mixtoken-key",
    MIXTOKEN_IMAGE_URL: "https://mixtoken.test/v1/images/generations",
    MIXTOKEN_IMAGE_EDIT_URL: "https://mixtoken.test/v1/images/edits",
    MIXTOKEN_IMAGE_MODEL: "gpt-image-2.5-sunburst",
    MIXTOKEN_IMAGE_FALLBACK_MODEL: "gpt-image-2.5"
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, values);
  globalThis.fetch = fetcher;
  t.after(() => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function requestImage(input: Record<string, unknown> = {}) {
  return POST(new Request("https://app.test/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gpt-image-2.5", prompt: "白底红苹果", ...input })
  }));
}

async function generate(input: Record<string, unknown> = {}) {
  const response = await requestImage(input);
  assert.equal(response.status, 202);
  const created = await response.json();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await GET(new Request("https://app.test"), {
      params: Promise.resolve({ jobId: created.data.jobId })
    });
    const { data } = await response.json();
    if (data.status === "completed" || data.status === "failed") return data;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("image job did not finish");
}

test("routes gpt-image-2.5 to Mixtoken with its own credentials and returns generated images", async (t) => {
  const requests: Record<string, unknown>[] = [];
  useMixtoken(t, async (url, init) => {
    assert.equal(String(url), "https://mixtoken.test/v1/images/generations");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-mixtoken-key");
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
  });

  const job = await generate({ size: "3:4", count: 2 });
  assert.equal(job.status, "completed");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {
    model: "gpt-image-2.5-sunburst", prompt: "白底红苹果", size: "1024x1536", n: 1, response_format: "b64_json"
  });
  assert.equal(job.result.provider, "gpt-image-2.5");
  assert.equal(job.result.model, "gpt-image-2.5-sunburst");
  assert.equal(job.result.images.length, 2);
  assert.equal(job.result.images[0].url, "data:image/png;base64,iVBORw0KGgo=");
});

test("sends local references directly to Mixtoken edits even with the OpenAPI default", async (t) => {
  let form: FormData | undefined;
  useMixtoken(t, async (url, init) => {
    assert.equal(String(url), "https://mixtoken.test/v1/images/edits");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-mixtoken-key");
    form = init?.body as FormData;
    return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
  });
  process.env.IMAGE_MODEL_PROVIDER = "openapi";

  const job = await generate({
    size: "1:1",
    sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo=", "data:image/webp;base64,UklGRg=="]
  });
  assert.equal(job.status, "completed");
  assert.equal(form?.get("model"), "gpt-image-2.5-sunburst");
  assert.equal(form?.get("size"), "1024x1024");
  assert.equal(form?.get("n"), "1");
  assert.deepEqual(form?.getAll("image").map((file) => (file as File).type), ["image/png", "image/webp"]);
});

test("caches Mixtoken URL results for the existing image job client", async (t) => {
  useMixtoken(t, async (url) => {
    if (String(url) === "https://img.test/result.png") {
      return new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { "Content-Type": "image/png" }
      });
    }
    assert.equal(String(url), "https://mixtoken.test/v1/images/generations");
    return Response.json({ data: [{ url: "https://img.test/result.png" }] });
  });
  const job = await generate();
  assert.equal(job.status, "completed");
  assert.equal(job.result.provider, "gpt-image-2.5");
  assert.match(job.result.images[0].url, /^\/api\/image\/result\/[0-9a-f-]{36}$/);
});

test("rejects private remote references before contacting Mixtoken", async (t) => {
  useMixtoken(t, async () => { throw new Error("provider must not be called"); });
  const response = await requestImage({ sourceImageUrls: ["http://127.0.0.1/image.png"] });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /gpt-image-2.5 参考图仅支持公开 HTTPS/);
});

test("reports a missing Mixtoken key without falling back to another model", async (t) => {
  useMixtoken(t, async () => { throw new Error("provider must not be called"); });
  delete process.env.MIXTOKEN_API_KEY;
  const job = await generate();
  assert.equal(job.status, "failed");
  assert.match(job.error, /gpt-image-2.5 配置缺失：MIXTOKEN_API_KEY/);
});

test("surfaces a Mixtoken rejection and rejects empty successful responses", async (t) => {
  useMixtoken(t, async () => Response.json({ error: { message: "quota exceeded" } }, { status: 429 }));
  const rejected = await generate();
  assert.equal(rejected.status, "failed");
  assert.match(rejected.error, /gpt-image-2.5 生成失败：quota exceeded/);
  globalThis.fetch = async () => Response.json({ data: [] });
  const empty = await generate();
  assert.equal(empty.status, "failed");
  assert.match(empty.error, /未返回图片/);
});

test("retries Sunburst and stops immediately when it succeeds", async (t) => {
  const models: string[] = [];
  useMixtoken(t, async (_url, init) => {
    models.push(JSON.parse(String(init?.body)).model);
    if (models.length < 3) throw new Error("temporary connection failure");
    return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
  });
  const job = await generate();
  assert.equal(job.status, "completed");
  assert.deepEqual(models, Array(3).fill("gpt-image-2.5-sunburst"));
  assert.equal(job.result.images[0].model, "gpt-image-2.5-sunburst");
});

test("uses gpt-image-2.5 only after the first Sunburst attempt and three retries fail", async (t) => {
  const models: string[] = [];
  useMixtoken(t, async (_url, init) => {
    const model = JSON.parse(String(init?.body)).model;
    models.push(model);
    return model === "gpt-image-2.5-sunburst"
      ? Response.json({ error: { message: "sunburst unavailable" } }, { status: 503 })
      : Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
  });
  const job = await generate();
  assert.equal(job.status, "completed");
  assert.deepEqual(models, [...Array(4).fill("gpt-image-2.5-sunburst"), "gpt-image-2.5"]);
  assert.equal(job.result.model, "gpt-image-2.5");
  assert.equal(job.result.images[0].model, "gpt-image-2.5");
});

test("keeps reference images in every retry and fallback edit request", async (t) => {
  const models: string[] = [];
  useMixtoken(t, async (url, init) => {
    assert.equal(String(url), "https://mixtoken.test/v1/images/edits");
    const form = init?.body as FormData;
    models.push(String(form.get("model")));
    assert.equal((form.get("image") as File).type, "image/png");
    assert.equal(form.get("prompt"), "白底红苹果");
    return models.length <= 4
      ? Response.json({ data: [] })
      : Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
  });
  const job = await generate({ sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo="] });
  assert.equal(job.status, "completed");
  assert.deepEqual(models, [...Array(4).fill("gpt-image-2.5-sunburst"), "gpt-image-2.5"]);
});

test("reports both model errors when retries and fallback are exhausted", async (t) => {
  const models: string[] = [];
  useMixtoken(t, async (_url, init) => {
    const model = JSON.parse(String(init?.body)).model;
    models.push(model);
    return Response.json({ error: { message: `${model} unavailable` } }, { status: 503 });
  });
  const job = await generate();
  assert.equal(job.status, "failed");
  assert.deepEqual(models, [...Array(4).fill("gpt-image-2.5-sunburst"), "gpt-image-2.5"]);
  assert.match(job.error, /sunburst unavailable/);
  assert.match(job.error, /gpt-image-2.5 unavailable/);
});
