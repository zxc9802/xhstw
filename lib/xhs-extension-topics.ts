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
  activeKeywords: string[],
  rejected: Topic[]
): Topic[] {
  const rejectedKeys = new Set(rejected.map(topicKey));
  const incomingByKey = new Map<string, Topic>();
  for (const item of incoming) {
    const key = topicKey(item);
    if (!rejectedKeys.has(key)) incomingByKey.set(key, item);
  }

  const active = new Set(activeKeywords);
  const retained = current.filter((item) => !active.has(item.keyword ?? "") && !rejectedKeys.has(topicKey(item)));
  const mergedRetained = retained.map((item) => {
    const key = topicKey(item);
    const replacement = incomingByKey.get(key);
    if (!replacement) return item;
    incomingByKey.delete(key);
    return { ...item, ...replacement };
  });

  return [...incomingByKey.values(), ...mergedRetained];
}
