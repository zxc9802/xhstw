export type PromptLibraryItem = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptLibraryInput = Pick<PromptLibraryItem, "name" | "content">;

export function normalizePromptLibraryInput(name: string, content: string): PromptLibraryInput | null {
  const normalizedContent = content.trim();
  if (!normalizedContent) return null;
  return { name: name.trim(), content: normalizedContent };
}

export function createPromptLibraryItem(input: PromptLibraryInput, id: string, now: string): PromptLibraryItem {
  return { id, ...input, createdAt: now, updatedAt: now };
}

export function updatePromptLibraryItem(
  items: PromptLibraryItem[],
  id: string,
  input: PromptLibraryInput,
  now: string
) {
  return items.map((item) => item.id === id ? { ...item, ...input, updatedAt: now } : item);
}

export function deletePromptLibraryItem(items: PromptLibraryItem[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function searchPromptLibrary(items: PromptLibraryItem[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((item) => `${item.name}\n${item.content}`.toLocaleLowerCase().includes(normalizedQuery));
}

export function sanitizePromptLibraryItems(value: unknown): PromptLibraryItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PromptLibraryItem => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<PromptLibraryItem>;
    return typeof candidate.id === "string"
      && typeof candidate.name === "string"
      && typeof candidate.content === "string"
      && Boolean(candidate.content.trim())
      && typeof candidate.createdAt === "string"
      && typeof candidate.updatedAt === "string";
  });
}
