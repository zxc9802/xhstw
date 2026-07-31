export type KeywordLibraryState = {
  customKeywords: string[];
  hiddenKeywords: string[];
};

function uniqueNonEmpty(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function addKeywordValues(state: KeywordLibraryState, incoming: string[]): KeywordLibraryState {
  const added = uniqueNonEmpty(incoming);
  return {
    customKeywords: uniqueNonEmpty([...state.customKeywords, ...added]),
    hiddenKeywords: state.hiddenKeywords.filter((value) => !added.includes(value))
  };
}

export function removeKeywordValue(state: KeywordLibraryState, keyword: string): KeywordLibraryState {
  return {
    customKeywords: state.customKeywords.filter((value) => value !== keyword),
    hiddenKeywords: uniqueNonEmpty([...state.hiddenKeywords, keyword])
  };
}

export function withoutSelectedKeywords<T extends { tags: string[] }>(item: T): T {
  return { ...item, tags: [] };
}

export function reorderAssignedImages(
  assignments: Record<number, string[]>,
  workIndex: number,
  sourceUrl: string,
  targetUrl: string,
  placement: "before" | "after" = "before"
): Record<number, string[]> {
  const current = assignments[workIndex] ?? [];
  const sourceIndex = current.indexOf(sourceUrl);
  const targetIndex = current.indexOf(targetUrl);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return assignments;

  const reordered = [...current];
  reordered.splice(sourceIndex, 1);
  const targetIndexAfterRemoval = reordered.indexOf(targetUrl);
  reordered.splice(targetIndexAfterRemoval + (placement === "after" ? 1 : 0), 0, sourceUrl);
  return { ...assignments, [workIndex]: reordered };
}

export function prependAssignedImages(
  assignments: Record<number, string[]>,
  workIndex: number,
  imageUrls: string[]
): Record<number, string[]> {
  return {
    ...assignments,
    [workIndex]: uniqueNonEmpty([...imageUrls, ...(assignments[workIndex] ?? [])])
  };
}

export function removeAssignedImage(
  assignments: Record<number, string[]>,
  imageUrl: string
): Record<number, string[]> {
  return Object.fromEntries(
    Object.entries(assignments).map(([workIndex, imageUrls]) => [
      workIndex,
      imageUrls.filter((url) => url !== imageUrl)
    ])
  );
}

export function reorderImageUrls(
  imageUrls: string[],
  sourceUrl: string,
  targetUrl: string,
  placement: "before" | "after" = "before"
) {
  const sourceIndex = imageUrls.indexOf(sourceUrl);
  const targetIndex = imageUrls.indexOf(targetUrl);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return imageUrls;

  const reordered = [...imageUrls];
  reordered.splice(sourceIndex, 1);
  const targetIndexAfterRemoval = reordered.indexOf(targetUrl);
  reordered.splice(targetIndexAfterRemoval + (placement === "after" ? 1 : 0), 0, sourceUrl);
  return reordered;
}

export function selectExportTargets<T>(selected: T[], visible: T[]): T[] {
  return selected.length ? selected : visible;
}
