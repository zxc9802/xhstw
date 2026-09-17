import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { generateFalImage } from "../lib/adapters/fal-image";
import { generateWithGptImage25 } from "../lib/adapters/gpt-image25";
import { POST } from "../app/api/image/generate/route";
import { GET } from "../app/api/image/generate/[jobId]/route";

const base = "https://queue.fal.run/openai/gpt-image-2.5";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function useFal(t: TestContext, fetcher: typeof fetch) {
  const env = { FAL_KEY: "test-fal-key", MIXTOKEN_API_KEY: "", IMAGE_MODEL_PROVIDER: "mock" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.mock.method(globalThis, "fetch", fetcher);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function queued(id = "fal-test") {
  return { request_id: id, status: "IN_QUEUE", status_url: `${base}/requests/${id}/status`, response_url: `${base}/requests/${id}` };
}

test("fal edit completes its queue with high quality and caches the image through the existing job route", async (t) => {
  let polls = 0;
  let submitted = 0;
  useFal(t, async (url, init) => {
    const address = String(url);
    if (address === "https://v3.fal.media/result.png") {
      assert.equal(new Headers(init?.headers).has("Authorization"), false);
      return new Response(png, { headers: { "Content-Type": "image/png" } });
    }
    assert.equal(new Headers(init?.headers).get("Authorization"), "Key test-fal-key");
    if (init?.method === "POST") {
      submitted++;
      assert.equal(address, `${base}/sunburst/edit`);
      const input = JSON.parse(String(init.body));
      assert.equal(input.prompt, "把背景改成黄色");
      assert.equal(input.quality, "high");
      assert.equal(input.num_images, 1);
      assert.equal(input.output_format, "png");
      assert.equal(input.image_size, "portrait_4_3");
      assert.match(input.image_urls[0], /^https:\/\/app.test\/temp-assets\//);
      assert.equal(input.image_urls[1], "https://img.test/reference.png");
      return Response.json(queued());
    }
    if (address.endsWith("/status")) return Response.json({ status: ++polls === 1 ? "IN_PROGRESS" : "COMPLETED" });
    assert.equal(address, queued().response_url);
    return Response.json({ images: [{ url: "https://v3.fal.media/result.png" }] });
  });
  const response = await POST(new Request("https://app.test/api/image/generate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gpt-image-2.5", prompt: "把背景改成黄色", size: "3:4", sourceImageUrls: ["data:image/png;base64,iVBORw0KGgo=", "https://img.test/reference.png"] })
  }));
  assert.equal(response.status, 202);
  const { data: created } = await response.json();
  let job;
  for (let attempt = 0; attempt < 150; attempt++) {
    const status = await GET(new Request("https://app.test"), { params: Promise.resolve({ jobId: created.jobId }) });
    job = (await status.json()).data;
    if (job.status === "completed" || job.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(job.status, "completed", job.error);
  assert.equal(submitted, 1);
  assert.equal(polls, 2);
  assert.equal(job.result.model, "openai/gpt-image-2.5/sunburst/edit");
  assert.equal(job.result.images[0].requestId, "fal-test");
  assert.match(job.result.images[0].url, /^\/api\/image\/result\//);
});

test("fal text-to-image works without a Mixtoken key and always requests high quality", async (t) => {
  useFal(t, async (url, init) => {
    if (init?.method === "POST") {
      assert.equal(String(url), `${base}/sunburst/text-to-image`);
      assert.deepEqual(JSON.parse(String(init.body)), { prompt: "红苹果", quality: "high", num_images: 1, output_format: "png", image_size: "square_hd" });
      return Response.json(queued());
    }
    return Response.json(String(url).endsWith("/status") ? { status: "COMPLETED" } : { images: [{ url: "https://v3.fal.media/apple.png" }] });
  });
  const result = await generateWithGptImage25({ prompt: "红苹果" });
  assert.equal(result.model, "openai/gpt-image-2.5/sunburst/text-to-image");
  assert.equal(result.images.length, 1);
});

test("only the failed image falls back to Mixtoken, preserving the successful fal image", async (t) => {
  let falCalls = 0;
  let mixtokenCalls = 0;
  useFal(t, async (url, init) => {
    const address = String(url);
    if (address.startsWith("https://api.mixtoken.ai/")) {
      mixtokenCalls++;
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-mixtoken-key");
      assert.equal(JSON.parse(String(init?.body)).model, "gpt-image-2.5-sunburst");
      return Response.json({ data: [{ b64_json: "iVBORw0KGgo=" }] });
    }
    if (init?.method === "POST") return ++falCalls === 1 ? Response.json(queued()) : Response.json({ detail: "fal unavailable" }, { status: 503 });
    return Response.json(address.endsWith("/status") ? { status: "COMPLETED" } : { images: [{ url: "https://v3.fal.media/apple.png" }] });
  });
  process.env.MIXTOKEN_API_KEY = "test-mixtoken-key";
  const result = await generateWithGptImage25({ prompt: "红苹果", count: 2 });
  assert.equal(falCalls, 2);
  assert.equal(mixtokenCalls, 1);
  assert.equal(result.images[0].model, "openai/gpt-image-2.5/sunburst/text-to-image");
  assert.equal(result.images[1].model, "gpt-image-2.5-sunburst");
  assert.match(result.warnings?.[0] || "", /fal unavailable/);
});

test("failed completed jobs report the upstream error and request ID with the key redacted", async (t) => {
  useFal(t, async (_url, init) => Response.json(init?.method === "POST" ? queued() : { status: "COMPLETED", error: "failed test-fal-key" }));
  await assert.rejects(generateFalImage({ prompt: "红苹果", sourceImageUrls: [] }), (error: Error) => {
    assert.match(error.message, /failed \[redacted\]/);
    assert.match(error.message, /fal-test/);
    assert.doesNotMatch(error.message, /test-fal-key/);
    return true;
  });
});

test("queue URLs cannot send the fal credential to another host", async (t) => {
  let calls = 0;
  useFal(t, async () => {
    calls++;
    return Response.json({ ...queued(), status_url: "https://untrusted.test/status" });
  });
  await assert.rejects(generateFalImage({ prompt: "红苹果", sourceImageUrls: [] }), /无效的任务查询地址/);
  assert.equal(calls, 1);
});

test("fal rejects a completed response with no image", async (t) => {
  useFal(t, async (url, init) => Response.json(init?.method === "POST" ? queued() : String(url).endsWith("/status") ? { status: "COMPLETED" } : { images: [] }));
  await assert.rejects(generateFalImage({ prompt: "红苹果", sourceImageUrls: [] }), /未返回图片/);
});

test("fal errors retain HTTP status and validation details", async (t) => {
  useFal(t, async () => Response.json({ detail: [{ msg: "invalid image size" }] }, { status: 422 }));
  await assert.rejects(generateFalImage({ prompt: "红苹果", sourceImageUrls: [] }), /HTTP 422.*invalid image size/);
});

test("fal polling has a total deadline and does not resubmit the job", async (t) => {
  let now = 0;
  let calls = 0;
  t.mock.method(Date, "now", () => now);
  useFal(t, async () => {
    calls++;
    now = 6 * 60 * 1000 + 1;
    return Response.json(queued());
  });
  await assert.rejects(generateFalImage({ prompt: "红苹果", sourceImageUrls: [] }), /等待超时.*fal-test/);
  assert.equal(calls, 1);
});
