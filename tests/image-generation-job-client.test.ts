import assert from "node:assert/strict";
import test from "node:test";
import { pollImageGenerationJob } from "@/lib/image-generation-job-client";

test("polls until the local image job completes", async () => {
  const statuses = [
    { id: "job-1", status: "queued" as const },
    { id: "job-1", status: "processing" as const },
    { id: "job-1", status: "completed" as const, result: { images: [{ url: "https://example.test/image.png" }] } }
  ];
  const waits: number[] = [];

  const job = await pollImageGenerationJob(
    "job-1",
    async () => statuses.shift()!,
    async (milliseconds) => {
      waits.push(milliseconds);
    }
  );

  assert.equal(job.status, "completed");
  assert.deepEqual(waits, [3000, 3000]);
});

test("stops polling when the local image job fails", async () => {
  await assert.rejects(
    () => pollImageGenerationJob("job-1", async () => ({ id: "job-1", status: "failed", error: "provider timed out" })),
    /provider timed out/
  );
});
