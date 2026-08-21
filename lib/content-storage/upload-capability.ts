import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CONTENT_UPLOAD_INTENT_TTL_MS,
  parseImageDescriptors,
  type ImageDescriptor
} from "./contracts";

type CapabilityPayload = ImageDescriptor & {
  version: 1;
  expiresAt: number;
};

function secret() {
  const value = process.env.APP_SESSION_SECRET?.trim();
  if (!value) throw new Error("上传令牌配置无效");
  return value;
}

function signature(payload: string, ownerId: string, contentId: string, fileId: string) {
  return createHmac("sha256", secret())
    .update(JSON.stringify([payload, ownerId, contentId, fileId]))
    .digest("base64url");
}

export function createUploadCapability(
  ownerId: string,
  contentId: string,
  fileId: string,
  descriptor: ImageDescriptor,
  now = Date.now()
) {
  const [image] = parseImageDescriptors([descriptor]);
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    contentType: image.contentType,
    size: image.size,
    expiresAt: now + CONTENT_UPLOAD_INTENT_TTL_MS
  } satisfies CapabilityPayload)).toString("base64url");
  return `${payload}.${signature(payload, ownerId, contentId, fileId)}`;
}

export function verifyUploadCapability(
  token: string | null,
  ownerId: string,
  contentId: string,
  fileId: string,
  now = Date.now()
): ImageDescriptor {
  try {
    if (!token) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error();
    const [payload, actualSignature] = parts;
    const expectedSignature = signature(payload, ownerId, contentId, fileId);
    const actualBytes = Buffer.from(actualSignature);
    const expectedBytes = Buffer.from(expectedSignature);
    if (actualBytes.byteLength !== expectedBytes.byteLength || !timingSafeEqual(actualBytes, expectedBytes)) {
      throw new Error();
    }
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<CapabilityPayload>;
    if (value.version !== 1 || !Number.isInteger(value.expiresAt) || (value.expiresAt as number) <= now) {
      throw new Error();
    }
    const [image] = parseImageDescriptors([{ contentType: value.contentType, size: value.size }]);
    return image;
  } catch {
    throw new Error("上传令牌无效");
  }
}
