import assert from "node:assert/strict";
import test from "node:test";
import { readCosConfig, tencentCosS3ClientOptions } from "../lib/content-storage/cos";

test("builds the Tencent COS S3-compatible endpoint from environment variables", () => {
  const previous = { ...process.env };
  process.env.TENCENT_COS_BUCKET = "xshcp-1410143389";
  process.env.TENCENT_COS_REGION = "ap-singapore";
  process.env.TENCENT_COS_SECRET_ID = "secret-id";
  process.env.TENCENT_COS_SECRET_KEY = "secret-key";
  try {
    const config = readCosConfig();
    assert.deepEqual(config, {
      bucket: "xshcp-1410143389",
      region: "ap-singapore",
      endpoint: "https://cos.ap-singapore.myqcloud.com",
      accessKeyId: "secret-id",
      secretAccessKey: "secret-key"
    });
    const clientOptions = tencentCosS3ClientOptions(config);
    assert.equal(clientOptions.requestChecksumCalculation, "WHEN_REQUIRED");
    assert.equal(clientOptions.responseChecksumValidation, "WHEN_REQUIRED");
  } finally {
    process.env = previous;
  }
});

test("reports a missing COS variable without printing configured secrets", () => {
  const previous = { ...process.env };
  process.env.TENCENT_COS_BUCKET = "xshcp-1410143389";
  process.env.TENCENT_COS_REGION = "ap-singapore";
  process.env.TENCENT_COS_SECRET_ID = "must-not-leak";
  delete process.env.TENCENT_COS_SECRET_KEY;
  try {
    assert.throws(
      () => readCosConfig(),
      (error: unknown) => error instanceof Error
        && error.message.includes("TENCENT_COS_SECRET_KEY")
        && !error.message.includes("must-not-leak")
    );
  } finally {
    process.env = previous;
  }
});
