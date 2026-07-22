import assert from "node:assert/strict";
import test from "node:test";

import { generateImage } from "../lib/adapters/openai-image";

const PROVIDER_ENV = {
  GPT_IMAGE2_API_URL: "http://provider.test/openApi/generate",
  GPT_IMAGE2_QUERY_URL: "http://provider.test/openApi/queryResult",
  GPT_IMAGE2_PROJECT_CODE: "project-code",
  GPT_IMAGE2_ACCESS_KEY: "access-key",
  GPT_IMAGE2_SECRET_KEY: "secret-key",
  GPT_IMAGE2_MODEL_ID: "gpt-image2-low",
  GPT_IMAGE2_RESOLUTION: "1K",
  GPT_IMAGE2_POLL_INTERVAL_MS: "0",
  GPT_IMAGE2_POLL_MAX_ATTEMPTS: "3",
  IMAGE_MODEL_PROVIDER: "openapi"
} as const;

const ENV_KEYS = [
  ...Object.keys(PROVIDER_ENV),
  "OPENAI_IMAGE_API_KEY",
  "YUNWU_API_KEY",
  "YUNWU_IMAGE_URL",
  "YUNWU_IMAGE_EDIT_URL",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_IMAGE_FORMAT"
] as const;

async function withProvider(
  fetcher: typeof fetch,
  run: () => Promise<void>
) {
  const previousFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, PROVIDER_ENV);
  delete process.env.OPENAI_IMAGE_API_KEY;
  delete process.env.YUNWU_API_KEY;
  globalThis.fetch = fetcher;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of ENV_KEYS) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("sends the project OpenAPI request and preserves the public image result", async () => {
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;

  await withProvider(async (url, init) => {
    receivedUrl = String(url);
    receivedInit = init;
    return Response.json({
      sid: "request-1",
      sign: null,
      success: true,
      code: 0,
      msg: "成功",
      data: { images: [{ url: "https://img.test/cat.jpg" }] }
    });
  }, async () => {
    const result = await generateImage({ prompt: "橘猫", size: "3:4", count: 1 });

    assert.equal(receivedUrl, "http://provider.test/openApi/generate");
    assert.deepEqual(receivedInit?.headers, {
      Accept: "application/json",
      "Content-Type": "application/json",
      projectCode: "project-code",
      "X-Access-Key": "access-key",
      "X-Secret-Key": "secret-key"
    });
    const requestBody = JSON.parse(String(receivedInit?.body));
    assert.equal(requestBody.modelId, "gpt-image2-low");
    assert.equal(requestBody.abilityType, "IMAGE");
    assert.match(requestBody.prompt, /橘猫/);
    assert.deepEqual(requestBody.payload, {
      params: { resolution: "1K", scale: "3:4" }
    });
    assert.equal(result.provider, "Image 2.0");
    assert.ok("model" in result);
    assert.equal(result.model, "gpt-image2-low");
    assert.equal(result.images?.[0]?.url, "https://img.test/cat.jpg");
  });
});

test("treats an HTTP 200 provider rejection as an error", async () => {
  await withProvider(async () => Response.json({
    sid: null,
    sign: null,
    success: false,
    code: null,
    msg: "IP 不在白名单",
    data: null
  }), async () => {
    await assert.rejects(
      generateImage({ prompt: "橘猫", count: 1 }),
      /Image 2\.0 生成失败：IP 不在白名单/
    );
  });
});

test("sends reference images to the project OpenAPI resources field", async () => {
  let requestBody: Record<string, unknown> | undefined;
  await withProvider(async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      success: true,
      data: { images: [{ url: "https://img.test/edited.jpg" }] }
    });
  }, async () => {
    const result = await generateImage({
      prompt: "只换背景",
      sourceImageUrls: ["https://img.test/source.jpg"]
    });

    assert.deepEqual(requestBody?.payload, {
      resources: ["https://img.test/source.jpg"],
      params: { resolution: "1K", scale: "1:1" }
    });
    assert.ok("model" in result);
    assert.equal(result.images?.[0]?.url, "https://img.test/edited.jpg");
  });
});

test("retries the project OpenAPI three times after the first failure", async () => {
  let calls = 0;
  await withProvider(async () => {
    calls += 1;
    if (calls < 4) return Response.json({ success: false, msg: `失败 ${calls}` });
    return Response.json({
      success: true,
      data: { images: [{ url: "https://img.test/fourth-attempt.jpg" }] }
    });
  }, async () => {
    const result = await generateImage({ prompt: "橘猫", count: 1 });
    assert.equal(calls, 4);
    assert.ok("model" in result);
    assert.equal(result.images?.[0]?.url, "https://img.test/fourth-attempt.jpg");
  });
});

test("falls back to Yunwu generation after four project OpenAPI failures", async () => {
  let primaryCalls = 0;
  let yunwuInit: RequestInit | undefined;

  await withProvider(async (url, init) => {
    if (String(url) === "http://provider.test/openApi/generate") {
      primaryCalls += 1;
      return Response.json({ success: false, msg: "当前接口失败" });
    }
    assert.equal(String(url), "https://yunwu.test/v1/images/generations");
    yunwuInit = init;
    return Response.json({ data: [{ url: "https://img.test/yunwu.jpg" }] });
  }, async () => {
    process.env.YUNWU_API_KEY = "test-yunwu-key";
    process.env.YUNWU_IMAGE_URL = "https://yunwu.test/v1/images/generations";
    const result = await generateImage({ prompt: "橘猫", size: "3:4", count: 1 });

    assert.equal(primaryCalls, 4);
    assert.equal((yunwuInit?.headers as Record<string, string>).Authorization, "Bearer test-yunwu-key");
    const yunwuBody = JSON.parse(String(yunwuInit?.body));
    assert.equal(yunwuBody.model, "gpt-image-2");
    assert.match(yunwuBody.prompt, /橘猫/);
    assert.equal(yunwuBody.n, 1);
    assert.equal(yunwuBody.size, "1024x1536");
    assert.equal(yunwuBody.quality, "high");
    assert.equal(yunwuBody.format, "jpeg");
    assert.ok("model" in result);
    assert.equal(result.images?.[0]?.url, "https://img.test/yunwu.jpg");
    assert.equal(result.images?.[0]?.provider, "Image 2.0 (Yunwu fallback)");
  });
});

test("falls back to Yunwu edits after four project OpenAPI image-edit failures", async () => {
  let primaryCalls = 0;
  let editForm: FormData | undefined;

  await withProvider(async (url, init) => {
    if (String(url) === "http://provider.test/openApi/generate") {
      primaryCalls += 1;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.payload.resources, ["data:image/png;base64,aGVsbG8="]);
      return Response.json({ success: false, msg: "当前图生图失败" });
    }
    assert.equal(String(url), "https://yunwu.test/v1/images/edits");
    editForm = init?.body as FormData;
    return Response.json({ data: [{ url: "https://img.test/yunwu-edit.jpg" }] });
  }, async () => {
    process.env.YUNWU_API_KEY = "test-yunwu-key";
    process.env.YUNWU_IMAGE_URL = "https://yunwu.test/v1/images/generations";
    process.env.YUNWU_IMAGE_EDIT_URL = "https://yunwu.test/v1/images/edits";

    const result = await generateImage({
      prompt: "背景不变，只换人物",
      sourceImageUrls: ["data:image/png;base64,aGVsbG8="],
      count: 1
    });

    assert.equal(primaryCalls, 4);
    assert.equal(editForm?.get("model"), "gpt-image-2");
    assert.match(String(editForm?.get("prompt")), /背景不变，只换人物/);
    assert.equal(editForm?.get("n"), "1");
    assert.equal(editForm?.get("size"), "1024x1024");
    assert.equal(editForm?.getAll("image").length, 1);
    assert.ok("model" in result);
    assert.equal(result.images?.[0]?.url, "https://img.test/yunwu-edit.jpg");
    assert.equal(result.images?.[0]?.provider, "Image 2.0 (Yunwu fallback)");
  });
});

test("treats an empty aggregate response as a failed attempt", async () => {
  let calls = 0;
  await withProvider(async () => {
    calls += 1;
    if (calls < 4) return Response.json({ success: true, data: {} });
    return Response.json({
      success: true,
      data: { images: [{ url: "https://img.test/recovered.jpg" }] }
    });
  }, async () => {
    const result = await generateImage({ prompt: "橘猫", count: 1 });
    assert.equal(calls, 4);
    assert.ok("model" in result);
    assert.equal(result.images?.[0]?.url, "https://img.test/recovered.jpg");
  });
});

test("reports both provider failures when Yunwu fallback also fails", async () => {
  let calls = 0;
  await withProvider(async (url) => {
    calls += 1;
    if (String(url) === "http://provider.test/openApi/generate") {
      return Response.json({ success: false, msg: "当前接口拒绝" });
    }
    return Response.json({ error: { message: "Yunwu 拒绝" } }, { status: 500 });
  }, async () => {
    process.env.YUNWU_API_KEY = "test-yunwu-key";
    process.env.YUNWU_IMAGE_URL = "https://yunwu.test/v1/images/generations";
    await assert.rejects(
      generateImage({ prompt: "橘猫", count: 1 }),
      /当前接口重试 3 次后仍失败.*当前接口拒绝.*Yunwu 兜底失败.*Yunwu 拒绝/
    );
    assert.equal(calls, 5);
  });
});

test("makes exactly one request per image and parses bounded URL and base64 fields", async () => {
  let calls = 0;
  await withProvider(async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json({
        sid: "not-an-image-url",
        sign: "not-an-image-url",
        success: true,
        code: 0,
        msg: "成功",
        data: { result: { imageUrl: "https://img.test/first.jpg" } }
      });
    }
    return Response.json({
      sid: "still-not-an-image-url",
      sign: null,
      success: true,
      code: 0,
      msg: "成功",
      data: { output: { base64: "YWJj" } }
    });
  }, async () => {
    const result = await generateImage({ prompt: "橘猫", count: 2 });

    assert.equal(calls, 2);
    assert.ok("model" in result);
    assert.deepEqual(
      result.images?.map((image) => image.url),
      ["https://img.test/first.jpg", "data:image/jpeg;base64,YWJj"]
    );
  });
});

test("polls an asynchronous image task until the provider returns its resource URL", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  await withProvider(async (url, init) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>
    });
    if (requests.length === 1) {
      return Response.json({
        sid: null,
        sign: null,
        success: true,
        code: null,
        msg: "操作成功！",
        data: {
          modelId: null,
          abilityType: null,
          success: true,
          message: "SUCCESS",
          result: {
            taskId: "867660636440154112",
            content: null,
            resourceUrls: null,
            metadata: null
          }
        }
      });
    }
    if (requests.length === 2) {
      return Response.json({
        success: true,
        data: {
          result: {
            taskId: "867660636440154112",
            status: 1,
            message: "处理中"
          }
        }
      });
    }
    return Response.json({
      success: true,
      data: {
        result: {
          taskId: "867660636440154112",
          status: 2,
          message: "https://img.test/async-result.jpg"
        }
      }
    });
  }, async () => {
    const result = await generateImage({ prompt: "橘猫", count: 1 });

    assert.ok("model" in result);
    assert.equal(result.images?.[0]?.url, "https://img.test/async-result.jpg");
    assert.deepEqual(requests.map((request) => request.url), [
      "http://provider.test/openApi/generate",
      "http://provider.test/openApi/queryResult",
      "http://provider.test/openApi/queryResult"
    ]);
    assert.deepEqual(requests[1].body, {
      taskId: "867660636440154112",
      abilityType: "IMAGE"
    });
    assert.deepEqual(requests[2].body, requests[1].body);
  });
});

test("surfaces the provider message when an asynchronous image task fails", async () => {
  let generateCalls = 0;
  let queryCalls = 0;
  await withProvider(async (url) => {
    if (String(url).endsWith("/generate")) {
      generateCalls += 1;
      return Response.json({
        success: true,
        data: {
          result: {
            taskId: `failed-task-${generateCalls}`,
            content: null,
            resourceUrls: null
          }
        }
      });
    }
    queryCalls += 1;
    return Response.json({
      success: true,
      data: {
        result: {
          taskId: `failed-task-${queryCalls}`,
          status: 3,
          message: "内容审核未通过"
        }
      }
    });
  }, async () => {
    await assert.rejects(
      generateImage({ prompt: "橘猫", count: 1 }),
      /Image 2\.0 生成失败：内容审核未通过/
    );
    assert.equal(generateCalls, 4);
    assert.equal(queryCalls, 4);
  });
});

test("stops polling after the configured number of pending responses", async () => {
  let generateCalls = 0;
  let queryCalls = 0;
  await withProvider(async (url) => {
    if (String(url).endsWith("/generate")) {
      generateCalls += 1;
      return Response.json({
        success: true,
        data: {
          result: {
            taskId: `slow-task-${generateCalls}`,
            content: null,
            resourceUrls: null
          }
        }
      });
    }
    queryCalls += 1;
    return Response.json({
      success: true,
      data: { result: { taskId: "slow-task", status: 1, message: "处理中" } }
    });
  }, async () => {
    await assert.rejects(
      generateImage({ prompt: "橘猫", count: 1 }),
      /Image 2\.0 生成超时：任务 slow-task-4/
    );
    assert.equal(generateCalls, 4);
    assert.equal(queryCalls, 12);
  });
});
