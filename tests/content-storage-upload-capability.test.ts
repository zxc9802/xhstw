import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_UPLOAD_INTENT_TTL_MS } from "../lib/content-storage/contracts";
import {
  createUploadCapability,
  verifyUploadCapability
} from "../lib/content-storage/upload-capability";

process.env.APP_SESSION_SECRET = "content-storage-capability-test";

const target = {
  ownerId: "member-a",
  contentId: "20260821T060000000Z-111111112222",
  fileId: "001-aaaaaaaabbbb.png"
};

test("upload capability is bound to the member, object path and declared image", () => {
  const token = createUploadCapability(
    target.ownerId,
    target.contentId,
    target.fileId,
    { contentType: "image/png", size: 4 },
    1_000
  );

  assert.deepEqual(
    verifyUploadCapability(token, target.ownerId, target.contentId, target.fileId, 1_001),
    { contentType: "image/png", size: 4 }
  );
  assert.throws(
    () => verifyUploadCapability(token, "member-b", target.contentId, target.fileId, 1_001),
    /上传令牌无效/
  );
  assert.throws(
    () => verifyUploadCapability(token, target.ownerId, target.contentId, "002-aaaaaaaabbbb.png", 1_001),
    /上传令牌无效/
  );
});

test("upload capability expires after ten minutes", () => {
  const token = createUploadCapability(
    target.ownerId,
    target.contentId,
    target.fileId,
    { contentType: "image/png", size: 4 },
    1_000
  );

  assert.throws(
    () => verifyUploadCapability(
      token,
      target.ownerId,
      target.contentId,
      target.fileId,
      1_000 + CONTENT_UPLOAD_INTENT_TTL_MS
    ),
    /上传令牌无效/
  );
});
