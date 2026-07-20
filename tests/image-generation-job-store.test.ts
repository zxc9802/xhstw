import assert from "node:assert/strict";
import test from "node:test";
import {
  createImageGenerationJob,
  getImageGenerationJob,
  runImageGenerationJob,
  shouldQueueImageGeneration
} from "@/lib/adapters/image-generation-job-store";
import { IMAGE_PROVIDER_TIMEOUT_MS } from "@/lib/adapters/openai-image";
import { NANO_BANANA_REQUEST_TIMEOUT_MS } from "@/lib/adapters/nano-banana";

test("uses a five-minute deadline for each Image 2.0 provider request", () => {
  assert.equal(IMAGE_PROVIDER_TIMEOUT_MS, 5 * 60 * 1000);
});

test("uses a five-minute deadline for each Nano Banana provider request", () => {
  assert.equal(NANO_BANANA_REQUEST_TIMEOUT_MS, 5 * 60 * 1000);
});

test("completes a queued image job with its generated result", async () => {
  const job = createImageGenerationJob({ prompt: "test image" });

  await runImageGenerationJob(job.id, async () => ({
    images: [{ url: "https://example.test/generated.png" }]
  }));

  assert.deepEqual(getImageGenerationJob(job.id), {
    id: job.id,
    status: "completed",
    result: { images: [{ url: "https://example.test/generated.png" }] },
    error: undefined
  });
});

test("records an image job failure for polling", async () => {
  const job = createImageGenerationJob({ prompt: "test failure" });

  await runImageGenerationJob(job.id, async () => {
    throw new Error("provider timed out");
  });

  assert.deepEqual(getImageGenerationJob(job.id), {
    id: job.id,
    status: "failed",
    result: undefined,
    error: "provider timed out"
  });
});

test("queues Image 2.0 and Nano Banana requests with reference images", () => {
  assert.equal(shouldQueueImageGeneration({ provider: "Image 2.0", sourceImageUrls: ["data:image/png;base64,AA=="] }), true);
  assert.equal(shouldQueueImageGeneration({ provider: "Image 2.0", sourceImageUrls: [] }), false);
  assert.equal(shouldQueueImageGeneration({ provider: "Nano Banana 2", sourceImageUrls: ["data:image/png;base64,AA=="] }), true);
  assert.equal(shouldQueueImageGeneration({ provider: "Nano Banana 2", sourceImageUrls: [] }), false);
});
