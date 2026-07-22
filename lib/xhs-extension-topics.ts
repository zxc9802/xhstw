import type { Topic } from "@/types/topic";

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
