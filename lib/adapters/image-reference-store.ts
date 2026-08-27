import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const IMAGE_REFERENCE_TTL_MS = 30 * 60 * 1000;
export const MAX_IMAGE_REFERENCE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_REFERENCE_REQUEST_BYTES = 40 * 1024 * 1024;

type StoredImageReference = {
  token: string;
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  expiresAt: number;
};

type StoredImageMeta = {
  contentType: StoredImageReference["contentType"];
  expiresAt: number;
};

export class ImageReferenceInputError extends Error {
  constructor(message: string, public readonly status: 400 | 413) {
    super(message);
    this.name = "ImageReferenceInputError";
  }
}

export function imageReferenceRoot() {
  const configured = process.env.IMAGE_REFERENCE_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "outputs", "image-references");
}

function ensureRoot() {
  mkdirSync(imageReferenceRoot(), { recursive: true });
}

function extensionFor(contentType: StoredImageReference["contentType"]) {
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  return ".png";
}

export function sanitizeTempAssetName(value: string) {
  const normalized = path.basename(String(value || "").trim());
  if (!normalized || normalized === "." || normalized === "..") return "";
  return normalized;
}

function tempAssetSigningSecret() {
  const candidates = [
    process.env.TEMP_ASSET_SIGNING_SECRET,
    process.env.APP_SESSION_SECRET
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("TEMP_ASSET_SIGNING_SECRET is required in production when temp asset URLs are enabled.");
  }
  return "dev-temp-asset-signing-secret";
}

function signTempAsset(filename: string, expiresAt: number) {
  return createHmac("sha256", tempAssetSigningSecret())
    .update(`${filename}:${expiresAt}`)
    .digest("base64url");
}

function verifyTempAssetSignature(filename: string, expiresAt: number, signature: string) {
  const expected = Buffer.from(signTempAsset(filename, expiresAt), "utf8");
  const provided = Buffer.from(signature, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function isLikelyPublicBaseUrl(origin: string) {
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return false;
    if (/^10\./.test(hostname)) return false;
    if (/^192\.168\./.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizedPublicOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("unsafe");
    if (!isLikelyPublicBaseUrl(parsed.origin)) throw new Error("private");
    return parsed.origin;
  } catch {
    throw new ImageReferenceInputError("本地参考图需要可公开访问的 HTTPS 域名。", 400);
  }
}

function resolvePublishOrigin(origin: string) {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return normalizedPublicOrigin(configured || origin);
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

function filePath(filename: string) {
  const safe = sanitizeTempAssetName(filename);
  if (!safe) throw new ImageReferenceInputError("参考图文件名无效。", 400);
  const root = path.resolve(imageReferenceRoot());
  const full = path.resolve(root, safe);
  if (path.dirname(full) !== root) {
    throw new ImageReferenceInputError("参考图文件名无效。", 400);
  }
  return full;
}

function metaPath(filename: string) {
  return `${filePath(filename)}.meta.json`;
}

function readMeta(filename: string): StoredImageMeta | undefined {
  try {
    const meta = JSON.parse(readFileSync(metaPath(filename), "utf8")) as StoredImageMeta;
    if (
      (meta.contentType === "image/jpeg" || meta.contentType === "image/png" || meta.contentType === "image/webp")
      && Number.isFinite(meta.expiresAt)
    ) {
      return meta;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function cleanupExpiredReferences(now: number) {
  try {
    ensureRoot();
    for (const name of readdirSync(imageReferenceRoot())) {
      if (name.endsWith(".meta.json")) continue;
      const meta = readMeta(name);
      if (!meta || meta.expiresAt <= now) deleteImageReferences([name]);
    }
  } catch {
    // The directory may not exist yet.
  }
}

export function deleteImageReferences(tokens: string[]) {
  for (const token of tokens) {
    const safe = sanitizeTempAssetName(token);
    if (!safe) continue;
    try {
      const full = filePath(safe);
      try {
        unlinkSync(full);
      } catch {
        // already gone
      }
      try {
        unlinkSync(`${full}.meta.json`);
      } catch {
        // already gone
      }
    } catch {
      // invalid filename
    }
  }
}

function buildTempAssetUrl(origin: string, filename: string, expiresAt: number) {
  const url = new URL(`/temp-assets/${encodeURIComponent(filename)}`, origin);
  url.searchParams.set("exp", String(expiresAt));
  url.searchParams.set("sig", signTempAsset(filename, expiresAt));
  return url.toString();
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

      const publicOrigin = resolvePublishOrigin(origin);
      const filename = `${now}-${randomUUID()}${extensionFor(decoded.contentType)}`;
      const expiresAt = now + IMAGE_REFERENCE_TTL_MS;
      ensureRoot();
      writeFileSync(filePath(filename), decoded.bytes);
      writeFileSync(metaPath(filename), JSON.stringify({
        contentType: decoded.contentType,
        expiresAt
      } satisfies StoredImageMeta));
      tokens.push(filename);
      urls.push(buildTempAssetUrl(publicOrigin, filename, expiresAt));
    }
    return { urls, tokens };
  } catch (error) {
    deleteImageReferences(tokens);
    throw error;
  }
}

export function getImageReference(token: string, now = Date.now()) {
  cleanupExpiredReferences(now);
  const filename = sanitizeTempAssetName(token);
  if (!filename) return undefined;
  const meta = readMeta(filename);
  if (!meta || meta.expiresAt <= now) {
    if (filename) deleteImageReferences([filename]);
    return undefined;
  }
  try {
    return {
      token: filename,
      bytes: new Uint8Array(readFileSync(filePath(filename))),
      contentType: meta.contentType,
      expiresAt: meta.expiresAt
    };
  } catch {
    return undefined;
  }
}

export function readSignedTempAsset(
  filename: string,
  expiresAt: number,
  signature: string,
  now = Date.now()
) {
  const safe = sanitizeTempAssetName(filename);
  if (!safe || !Number.isFinite(expiresAt) || expiresAt <= 0 || !signature) {
    return { ok: false as const, status: 400 as const, message: "Missing temp asset signature." };
  }
  if (expiresAt <= now) {
    return { ok: false as const, status: 410 as const, message: "Temp asset URL has expired." };
  }
  if (!verifyTempAssetSignature(safe, expiresAt, signature)) {
    return { ok: false as const, status: 403 as const, message: "Invalid temp asset signature." };
  }
  try {
    const bytes = new Uint8Array(readFileSync(filePath(safe)));
    const meta = readMeta(safe);
    return {
      ok: true as const,
      bytes,
      contentType: meta?.contentType || "image/png",
      expiresAt
    };
  } catch {
    return { ok: false as const, status: 404 as const, message: "Temp asset not found." };
  }
}
