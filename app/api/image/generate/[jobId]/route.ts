import { createHmac, timingSafeEqual } from "node:crypto";
import { getImageGenerationJob } from "@/lib/adapters/image-generation-job-store";
import { ok } from "@/lib/utils/api";

export const runtime = "nodejs";

const IMAGE_PROXY_JOB_ID = "proxy";
const IMAGE_PROXY_TIMEOUT_MS = 60_000;

function imageProxySignature(source: string, secret: string) {
  return createHmac("sha256", secret).update(source).digest("base64url");
}

function publicRequestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  if (!forwardedHost || !/^(http|https)$/.test(forwardedProto || "")) return requestUrl.origin;
  try {
    return new URL(`${forwardedProto}://${forwardedHost}`).origin;
  } catch {
    return requestUrl.origin;
  }
}

function imageProxyUrl(request: Request, source: string, secret: string) {
  const url = new URL(`/api/image/generate/${IMAGE_PROXY_JOB_ID}`, publicRequestOrigin(request));
  url.searchParams.set("source", source);
  url.searchParams.set("signature", imageProxySignature(source, secret));
  return url.toString();
}

function verifiedImageSource(request: Request, secret: string) {
  const requestUrl = new URL(request.url);
  const source = requestUrl.searchParams.get("source") || "";
  const signature = requestUrl.searchParams.get("signature") || "";
  if (!source || !signature) return undefined;
  const expected = imageProxySignature(source, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return undefined;
  try {
    const sourceUrl = new URL(source);
    if (!/^https?:$/.test(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) return undefined;
    return sourceUrl.toString();
  } catch {
    return undefined;
  }
}

function imageContentType(response: Response, source: string) {
  const header = response.headers.get("Content-Type") || "";
  if (/^image\//i.test(header)) return header;
  const extension = new URL(source).pathname.toLowerCase().match(/\.(avif|gif|jpe?g|png|webp)$/)?.[1];
  if (!extension) return undefined;
  return ({
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
  } as Record<string, string>)[extension];
}

async function proxyImage(request: Request, secret: string) {
  const source = verifiedImageSource(request, secret);
  if (!source) return Response.json({ ok: false, message: "图片代理地址无效或已被篡改。" }, { status: 403 });
  try {
    const upstream = await fetch(source, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(IMAGE_PROXY_TIMEOUT_MS)
    });
    const contentType = imageContentType(upstream, source);
    if (!upstream.ok || !upstream.body || !contentType) {
      return Response.json({ ok: false, message: "服务商图片下载失败。" }, { status: 502 });
    }
    const headers = new Headers({
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff"
    });
    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return Response.json({ ok: false, message: "服务商图片连接失败。" }, { status: 502 });
  }
}

function proxiedImageResult(request: Request, result: unknown, secret: string) {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (record.provider !== "Image 2.0" || !Array.isArray(record.images)) return result;
  return {
    ...record,
    images: record.images.map((image) => {
      if (!image || typeof image !== "object") return image;
      const item = image as Record<string, unknown>;
      if (typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) return image;
      return { ...item, url: imageProxyUrl(request, item.url, secret) };
    })
  };
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const secret = process.env.GPT_IMAGE2_SECRET_KEY || "";
  if (jobId === IMAGE_PROXY_JOB_ID) {
    if (!secret) return Response.json({ ok: false, message: "图片代理未配置。" }, { status: 503 });
    return proxyImage(request, secret);
  }
  const job = getImageGenerationJob(jobId);
  if (!job) {
    return Response.json(
      { ok: false, message: "图片生成任务不存在或已失效，可能是服务已重启，请重新生成。" },
      { status: 404 }
    );
  }
  if (job.status !== "completed" || !secret) return ok(job);
  return ok({ ...job, result: proxiedImageResult(request, job.result, secret) });
}
