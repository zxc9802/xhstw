import type { Topic, TopicMedia } from "@/types/topic";

function topicKey(item: Topic) {
  const url = item.url ?? "";
  const noteId = url.match(/(?:explore|discovery\/item|search_result)\/([0-9a-f]{16,32})/i)?.[1];
  if (noteId) return `xhs:${noteId.toLowerCase()}`;
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return `url:${parsed.toString()}`;
    } catch {
      return `url:${url}`;
    }
  }
  return `id:${item.id}`;
}

export function mergeExtensionTopics(
  current: Topic[],
  incoming: Topic[],
  _activeKeywords: string[],
  rejected: Topic[]
): Topic[] {
  const rejectedKeys = new Set(rejected.map(topicKey));
  const retained = current.filter((item) => !rejectedKeys.has(topicKey(item)));
  const knownKeys = new Set(retained.map(topicKey));
  const added: Topic[] = [];
  for (const item of incoming) {
    const key = topicKey(item);
    if (rejectedKeys.has(key) || knownKeys.has(key)) continue;
    knownKeys.add(key);
    added.push(item);
  }

  return [...added, ...retained];
}

export function topicMediaAssetKeys(item: Topic) {
  return Array.from(new Set((item.media ?? []).flatMap((media) =>
    [media.localAssetKey, media.posterLocalAssetKey].filter((key): key is string => Boolean(key))
  )));
}

export function stripTopicLocalMedia(item: Topic): Topic {
  return {
    ...item,
    media: item.media?.map(({ localAssetKey: _local, posterLocalAssetKey: _poster, mimeType: _mime, size: _size, ...media }) => media)
  };
}

export function resolveTopicMedia(item: Topic, objectUrls: ReadonlyMap<string, string>): TopicMedia[] {
  return (item.media ?? []).map((media) => ({
    ...media,
    url: media.localAssetKey ? objectUrls.get(media.localAssetKey) ?? "" : media.url,
    posterUrl: media.posterLocalAssetKey ? objectUrls.get(media.posterLocalAssetKey) ?? "" : media.posterUrl
  }));
}
