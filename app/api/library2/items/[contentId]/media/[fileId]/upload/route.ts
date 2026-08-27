import type { NextRequest } from "next/server";
import { CONTENT_IMAGE_MAX_BYTES, CONTENT_IMAGE_TYPES, parseImageDescriptors } from "@/lib/content-storage/contracts";
import { getContentStorageGateway } from "@/lib/content-storage/cos";
import { library2ImageKey, library2ContentTypeExtension } from "@/lib/content-library-2/contracts";
import { verifyLibrary2UploadCapability } from "@/lib/content-library-2/upload-capability";

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
  try {
    const { contentId, fileId } = await context.params;
    const descriptor = verifyLibrary2UploadCapability(
      request.nextUrl.searchParams.get("token"),
      contentId,
      fileId
    );
    if (descriptor.mediaKind !== "image") throw new Error("上传令牌无效");
    const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() ?? "";
    if (contentType !== descriptor.contentType) throw new Error("图片信息不一致");
    const bytes = await readImageBytes(request, descriptor.size);
    parseImageDescriptors([{ contentType, size: bytes.byteLength }]);
    if (bytes.byteLength !== descriptor.size) throw new Error("图片信息不一致");
    const extension = CONTENT_IMAGE_TYPES.get(contentType);
    if (!extension || !fileId.endsWith(`.${extension}`)) throw new Error("图片类型与文件名不一致");
    library2ContentTypeExtension(contentType);
    const key = library2ImageKey(descriptor.ownerId, contentId, fileId);
    await getContentStorageGateway().putObject(key, bytes, contentType);
    return Response.json({ ok: true, data: { uploaded: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片上传失败";
    const status = /无效|不支持|超过|不一致/.test(message) ? 400 : 502;
    return Response.json({ ok: false, message }, { status });
  }
}
