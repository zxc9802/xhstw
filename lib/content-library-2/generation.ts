import { library2MediaUrl } from "./client";
import type { Library2Item } from "./contracts";

export function buildLibrary2GenerationHref(item: Pick<Library2Item, "id" | "title">) {
  const params = new URLSearchParams();
  params.set("tab", "image");
  params.set("prefill", "1");
  params.set("from", "library2");
  params.set("library2Id", item.id);
  if (item.title) params.set("title", item.title);
  return `/content?${params.toString()}`;
}

export function library2PrefillPayload(item: Library2Item) {
  const media = item.images.map((image, index) => ({
    type: "image" as const,
    url: library2MediaUrl(item.id, image.fileId),
    name: `${item.title || "爆款选题库2"} ${index + 1}`
  }));
  return {
    url: item.sourceUrl || `/content-library-2?item=${encodeURIComponent(item.id)}`,
    title: item.title || "爆款选题库2参考作品",
    copy: item.body,
    platform: item.platform,
    author: "爆款选题库2",
    likes: "-",
    fetchedAt: item.updatedAt.slice(0, 10),
    media
  };
}
