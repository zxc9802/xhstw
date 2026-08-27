import { createHmac, timingSafeEqual } from "node:crypto";
import { CONTENT_UPLOAD_INTENT_TTL_MS, parseImageDescriptors, type ImageDescriptor } from "@/lib/content-storage/contracts";
import { parseLibrary2LiveDescriptors, type Library2LiveDescriptor } from "./contracts";

type CapabilityPayload = {
  version: 1;
  kind: "library2-upload";
  mediaKind: "image" | "live";
  ownerId: string;
  contentType: string;
  size: number;
  expiresAt: number;
};

function secret() {
  const value = process.env.APP_SESSION_SECRET?.trim();
  if (!value) throw new Error("上传令牌配置无效");
  return value;
}

function signature(payload: string, contentId: string, fileId: string) {
  return createHmac("sha256", secret())
    .update(JSON.stringify([payload, contentId, fileId]))
    .digest("base64url");
}

export function createLibrary2UploadCapability(
  ownerId: string,
  contentId: string,
  fileId: string,
  descriptor: ImageDescriptor,
  now = Date.now()
) {
  const [image] = parseImageDescriptors([descriptor]);
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    kind: "library2-upload",
    mediaKind: "image",
    ownerId,
    contentType: image.contentType,
    size: image.size,
    expiresAt: now + CONTENT_UPLOAD_INTENT_TTL_MS
  } satisfies CapabilityPayload)).toString("base64url");
  return `${payload}.${signature(payload, contentId, fileId)}`;
}

export function createLibrary2LiveUploadCapability(
  ownerId: string,
  contentId: string,
  fileId: string,
  descriptor: Library2LiveDescriptor,
  now = Date.now()
) {
  const [live] = parseLibrary2LiveDescriptors([{ ...descriptor, order: 0 }]);
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    kind: "library2-upload",
    mediaKind: "live",
    ownerId,
    contentType: live.contentType,
    size: live.size,
    expiresAt: now + CONTENT_UPLOAD_INTENT_TTL_MS
  } satisfies CapabilityPayload)).toString("base64url");
  return `${payload}.${signature(payload, contentId, fileId)}`;
}

export function verifyLibrary2UploadCapability(
  token: string | null,
  contentId: string,
  fileId: string,
  now = Date.now()
): (ImageDescriptor & { ownerId: string; mediaKind: "image" }) | (Pick<Library2LiveDescriptor, "contentType" | "size"> & { ownerId: string; mediaKind: "live" }) {
  try {
    if (!token) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error();
    const [payload, actualSignature] = parts;
    const expectedSignature = signature(payload, contentId, fileId);
    const actualBytes = Buffer.from(actualSignature);
    const expectedBytes = Buffer.from(expectedSignature);
    if (actualBytes.byteLength !== expectedBytes.byteLength || !timingSafeEqual(actualBytes, expectedBytes)) {
      throw new Error();
    }
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<CapabilityPayload>;
    if (
      value.version !== 1
      || value.kind !== "library2-upload"
      || (value.mediaKind !== "image" && value.mediaKind !== "live")
      || typeof value.ownerId !== "string"
      || !value.ownerId.trim()
      || !Number.isInteger(value.expiresAt)
      || (value.expiresAt as number) <= now
    ) {
      throw new Error();
    }
    if (value.mediaKind === "image") {
      const [image] = parseImageDescriptors([{ contentType: value.contentType, size: value.size }]);
      return { ...image, ownerId: value.ownerId, mediaKind: "image" };
    }
    const [live] = parseLibrary2LiveDescriptors([{
      order: 0,
      coverIndex: 0,
      contentType: value.contentType,
      size: value.size
    }]);
    return { contentType: live.contentType, size: live.size, ownerId: value.ownerId, mediaKind: "live" };
  } catch {
    throw new Error("上传令牌无效");
  }
}

export function verifyLibrary2LiveUploadCapability(
  token: string | null,
  contentId: string,
  fileId: string,
  now = Date.now()
) {
  const descriptor = verifyLibrary2UploadCapability(token, contentId, fileId, now);
  if (descriptor.mediaKind !== "live") throw new Error("上传令牌无效");
  return descriptor;
}
