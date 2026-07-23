import { randomUUID } from "node:crypto";

export const IMAGE_REFERENCE_TTL_MS = 30 * 60 * 1000;
export const MAX_IMAGE_REFERENCE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_REFERENCE_REQUEST_BYTES = 40 * 1024 * 1024;

type StoredImageReference = {
  token: string;
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  expiresAt: number;
};

const referenceGlobal = globalThis as typeof globalThis & {
  __imageReferences?: Map<string, StoredImageReference>;
};

const references = referenceGlobal.__imageReferences ?? new Map<string, StoredImageReference>();
referenceGlobal.__imageReferences = references;

export class ImageReferenceInputError extends Error {
  constructor(message: string, public readonly status: 400 | 413) {
    super(message);
    this.name = "ImageReferenceInputError";
  }
}

function cleanupExpiredReferences(now: number) {
  for (const [token, reference] of references) {
    if (reference.expiresAt <= now) references.delete(token);
  }
}

function normalizedPublicOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("unsafe");
    return parsed.origin;
  } catch {
    throw new ImageReferenceInputError("本地参考图需要可公开访问的 HTTPS 域名。", 400);
  }
}

function decodeDataImage(source: string) {
  const match = source.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) {
    throw new ImageReferenceInputError("本地参考图格式无效，仅支持 JPEG、PNG 和 WebP。", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  const canonical = bytes.toString("base64").replace(/=+$/, "");
  if (!bytes.length || canonical !== match[2].replace(/=+$/, "")) {
    throw new ImageReferenceInputError("本地参考图 base64 内容无效。", 400);
  }
  if (bytes.byteLength > MAX_IMAGE_REFERENCE_BYTES) {
    throw new ImageReferenceInputError("单张本地参考图不能超过 10 MB。", 413);
  }
  return {
    bytes: new Uint8Array(bytes),
    contentType: match[1] as StoredImageReference["contentType"]
  };
}

export function deleteImageReferences(tokens: string[]) {
  tokens.forEach((token) => references.delete(token));
}

export function publishImageReferences(sources: string[], origin: string, now = Date.now()) {
  cleanupExpiredReferences(now);
  const urls: string[] = [];
  const tokens: string[] = [];
  let totalBytes = 0;

  try {
    for (const source of sources) {
      if (/^https?:\/\//i.test(source)) {
        urls.push(source);
        continue;
      }
      if (!source.startsWith("data:image/")) {
        throw new ImageReferenceInputError("参考图必须是公网 URL 或本地图片数据。", 400);
      }

      const decoded = decodeDataImage(source);
      totalBytes += decoded.bytes.byteLength;
      if (totalBytes > MAX_IMAGE_REFERENCE_REQUEST_BYTES) {
        throw new ImageReferenceInputError("单次请求的本地参考图总大小不能超过 40 MB。", 413);
      }

      const publicOrigin = normalizedPublicOrigin(origin);
      const token = randomUUID();
      references.set(token, {
        token,
        ...decoded,
        expiresAt: now + IMAGE_REFERENCE_TTL_MS
      });
      tokens.push(token);
      urls.push(new URL(`/api/image/reference/${token}`, publicOrigin).toString());
    }
    return { urls, tokens };
  } catch (error) {
    deleteImageReferences(tokens);
    throw error;
  }
}

export function getImageReference(token: string, now = Date.now()) {
  cleanupExpiredReferences(now);
  const reference = references.get(token);
  return reference
    ? { ...reference, bytes: new Uint8Array(reference.bytes) }
    : undefined;
}
