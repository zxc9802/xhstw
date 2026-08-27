import type { NextRequest } from "next/server";
import { getContentStorageGateway } from "@/lib/content-storage/cos";
import {
  LIBRARY2_LIVE_MAX_BYTES,
  library2LiveKey,
  validateLibrary2LiveFileId
} from "@/lib/content-library-2/contracts";
import { verifyLibrary2LiveUploadCapability } from "@/lib/content-library-2/upload-capability";

export const runtime = "nodejs";

function isMp4(bytes: Uint8Array) {
  if (bytes.byteLength < 12) return false;
  for (let offset = 4; offset <= Math.min(bytes.byteLength - 4, 28); offset += 1) {
    if (bytes[offset] === 0x66 && bytes[offset + 1] === 0x74
      && bytes[offset + 2] === 0x79 && bytes[offset + 3] === 0x70) return true;
  }
  return false;
}

async function readLiveBytes(request: NextRequest, expectedSize: number) {
  const declaredSize = request.headers.get("Content-Length");
  if (declaredSize !== null) {
    const size = Number(declaredSize);
    if (!Number.isInteger(size) || size <= 0) throw new Error("Live 视频大小无效");
    if (size > LIBRARY2_LIVE_MAX_BYTES) throw new Error("单个 Live 视频不能超过 100 MB");
    if (size !== expectedSize) throw new Error("Live 视频信息不一致");
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
      if (size > expectedSize || size > LIBRARY2_LIVE_MAX_BYTES) {
        await reader.cancel();
        throw new Error("Live 视频信息不一致");
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
    validateLibrary2LiveFileId(fileId);
    const descriptor = verifyLibrary2LiveUploadCapability(
      request.nextUrl.searchParams.get("token"),
      contentId,
      fileId
    );
    const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (contentType !== "video/mp4" || contentType !== descriptor.contentType) throw new Error("Live 视频信息不一致");
    const bytes = await readLiveBytes(request, descriptor.size);
    if (bytes.byteLength !== descriptor.size) throw new Error("Live 视频信息不一致");
    if (!isMp4(bytes)) throw new Error("Live 视频格式无效");
    const key = library2LiveKey(descriptor.ownerId, contentId, fileId);
    await getContentStorageGateway().putObject(key, bytes, "video/mp4");
    return Response.json({ ok: true, data: { uploaded: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live 视频上传失败";
    const status = /无效|超过|不一致|格式/.test(message) ? 400 : 502;
    return Response.json({ ok: false, message }, { status });
  }
}
