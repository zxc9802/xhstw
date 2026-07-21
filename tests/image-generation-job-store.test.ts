import assert from "node:assert/strict";
import test from "node:test";
import {
  createImageGenerationJob,
  getImageGenerationJob,
  IMAGE_GENERATION_JOB_TTL_MS,
  runImageGenerationJob
} from "../lib/adapters/image-generation-job-store";

test("runs an image generation job to completion", async () => {
  const job = createImageGenerationJob();

  await runImageGenerationJob(job.id, async () => ({
    images: ["data:image/png;base64,abc"]
  }));

  const completedJob = getImageGenerationJob(job.id);
  assert.equal(completedJob?.id, job.id);
  assert.equal(completedJob?.status, "completed");
  assert.equal(completedJob?.createdAt, job.createdAt);
  assert.equal(typeof completedJob?.updatedAt, "number");
  assert.deepEqual(completedJob?.result, { images: ["data:image/png;base64,abc"] });
});

test("records an image generation error without rejecting", async () => {
  const job = createImageGenerationJob();

  await runImageGenerationJob(job.id, async () => {
    throw new Error("provider failed");
  });

  const failedJob = getImageGenerationJob(job.id);
  assert.equal(failedJob?.status, "failed");
  assert.equal(failedJob?.error, "provider failed");
  assert.equal(failedJob?.result, undefined);
});

test("expires terminal jobs after thirty minutes", async () => {
  const job = createImageGenerationJob();
  await runImageGenerationJob(job.id, async () => ({ images: [] }));
  const completedJob = getImageGenerationJob(job.id);

  assert.ok(completedJob);
  assert.equal(
    getImageGenerationJob(job.id, completedJob.updatedAt + IMAGE_GENERATION_JOB_TTL_MS + 1),
    undefined
  );
});
