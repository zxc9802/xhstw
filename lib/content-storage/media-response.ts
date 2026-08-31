import { canonicalImageContentType } from "./contracts";

export function storedMediaResponse(object: { bytes: Uint8Array; contentType: string }) {
  const contentType = canonicalImageContentType(object.contentType) || object.contentType || "application/octet-stream";
  return new Response(object.bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "Content-Length": String(object.bytes.byteLength),
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
