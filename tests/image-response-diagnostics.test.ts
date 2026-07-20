import assert from "node:assert/strict";
import test from "node:test";
import { summarizeImageProviderResponse } from "../lib/adapters/image-response-diagnostics";

test("redacts image payloads and credential-shaped fields without losing job metadata", () => {
  const result = summarizeImageProviderResponse({
    task_id: "job_123",
    status: "processing",
    authorization: "Bearer should-not-appear",
    image: "data:image/jpeg;base64,ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    b64_json: "A".repeat(300),
    nested: { api_key: "secret", output: "x".repeat(300) }
  });

  assert.deepEqual(result, {
    task_id: "job_123",
    status: "processing",
    authorization: "[redacted]",
    image: { type: "data-url", length: 49 },
    b64_json: { type: "image-data", length: 300 },
    nested: { api_key: "[redacted]", output: { type: "string", length: 300, preview: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" } }
  });
});
