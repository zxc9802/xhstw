type ImageFetch = (url: string) => Promise<Response>;

async function embedRemoteImage(url: string, fetchImage: ImageFetch) {
  if (!/^https?:\/\//i.test(url)) return url;

  const response = await fetchImage(url);
  if (!response.ok) throw new Error(`Generated image download failed: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "";
  if (!contentType.startsWith("image/")) throw new Error("Generated image download returned non-image content");

  const bytes = Buffer.from(await response.arrayBuffer()).toString("base64");
  return `data:${contentType};base64,${bytes}`;
}

export async function materializeGeneratedImagePayload(result: unknown, fetchImage: ImageFetch = fetch) {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (!Array.isArray(record.images)) return result;

  const images = await Promise.all(record.images.map(async (image) => {
    if (typeof image === "string") return embedRemoteImage(image, fetchImage);
    if (!image || typeof image !== "object") return image;
    const imageRecord = image as Record<string, unknown>;
    if (typeof imageRecord.url !== "string") return image;
    return { ...imageRecord, url: await embedRemoteImage(imageRecord.url, fetchImage) };
  }));

  return { ...record, images };
}
