import { readSignedTempAsset, sanitizeTempAssetName } from "@/lib/adapters/image-reference-store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ filename: string }> }
) {
  const { filename } = await context.params;
  const url = new URL(request.url);
  const expiresAt = Number(url.searchParams.get("exp") || 0);
  const signature = url.searchParams.get("sig") || "";
  const asset = readSignedTempAsset(sanitizeTempAssetName(filename), expiresAt, signature);

  if (!asset.ok) {
    return new Response(asset.message, { status: asset.status });
  }

  return new Response(asset.bytes, {
    headers: {
      "Cache-Control": `private, max-age=${Math.max(60, Math.floor((asset.expiresAt - Date.now()) / 1000))}`,
      "Content-Type": asset.contentType,
      "X-Content-Type-Options": "nosniff"
    }
  });
}
