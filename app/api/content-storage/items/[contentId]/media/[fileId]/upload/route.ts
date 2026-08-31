import type { NextRequest } from "next/server";
import {
  CONTENT_IMAGE_MAX_BYTES,
  CONTENT_IMAGE_TYPES,
  canonicalImageContentType,
  imageObjectKey,
  parseImageDescriptors
} from "@/lib/content-storage/contracts";
import { contentStorageRoute } from "@/lib/content-storage/route";
import { verifyUploadCapability } from "@/lib/content-storage/upload-capability";

export const runtime = "nodejs";

async function readImageBytes(request: NextRequest, expectedSize: number) {
  const declaredSize = request.headers.get("Content-Length");
  if (declaredSize !== null) {
    const size = Number(declaredSize);
    if (!Number.isInteger(size) || size < 0) throw new Error("图片大小无效");
    if (size > CONTENT_IMAGE_MAX_BYTES) throw new Error("单张图片不能超过 20 MB");
    if (size !== expectedSize) throw new Error("图片信息不一致");
  }

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedSize) {
        await reader.cancel();
        throw new Error("图片信息不一致");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ contentId: string; fileId: string }> }
) {
  return contentStorageRoute(request, async (ownerId, gateway) => {
    const { contentId, fileId } = await context.params;
    const descriptor = verifyUploadCapability(
      request.nextUrl.searchParams.get("token"),
      ownerId,
      contentId,
      fileId
    );
    const contentType = canonicalImageContentType(request.headers.get("Content-Type") ?? "");
    if (contentType !== canonicalImageContentType(descriptor.contentType)) throw new Error("图片信息不一致");
    const bytes = await readImageBytes(request, descriptor.size);
    parseImageDescriptors([{ contentType, size: bytes.byteLength }]);
    if (bytes.byteLength !== descriptor.size) throw new Error("图片信息不一致");
    const extension = CONTENT_IMAGE_TYPES.get(contentType);
    if (!extension || !fileId.endsWith(`.${extension}`)) throw new Error("图片类型与文件名不一致");
    const key = imageObjectKey(ownerId, contentId, fileId);
    await gateway.putObject(key, bytes, contentType);
    return { uploaded: true };
  });
}
