import { canonicalImageContentType } from "./contracts";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function storedMediaResponse(object: { bytes: Uint8Array; contentType: string }) {
  const contentType = canonicalImageContentType(object.contentType) || object.contentType || "application/octet-stream";
  return new Response(toArrayBuffer(object.bytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "Content-Length": String(object.bytes.byteLength),
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
