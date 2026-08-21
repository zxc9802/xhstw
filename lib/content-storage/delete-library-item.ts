import {
  deleteLegacyContentItem,
  parseLegacyContentItems,
  type ContentLibraryItem
} from "./library-items";

type DeleteTarget = Pick<ContentLibraryItem, "source" | "id" | "legacySourceId">;

type DeleteStorageDependencies = {
  deleteCosContent: (contentId: string) => Promise<void>;
  getLegacyContent: () => string | null;
  setLegacyContent: (value: string) => void;
  deleteLegacyImage: (url: string) => Promise<void>;
};

export async function deleteContentLibraryStorage(
  item: DeleteTarget,
  dependencies: DeleteStorageDependencies
) {
  const legacyId = item.source === "browser" ? item.id : item.legacySourceId;

  if (item.source === "cos") await dependencies.deleteCosContent(item.id);

  const raw = legacyId ? dependencies.getLegacyContent() : null;
  const legacyExists = Boolean(legacyId) && (
    item.source === "browser"
    || parseLegacyContentItems(raw).some((candidate) => candidate.id === legacyId)
  );
  const legacyDeletion = legacyExists
    ? deleteLegacyContentItem(raw, legacyId as string)
    : undefined;

  if (!legacyDeletion || !legacyId) {
    return { legacyId: undefined, browserCleanupFailed: false };
  }
  dependencies.setLegacyContent(legacyDeletion.serialized);
  const cleanupResults = await Promise.allSettled(
    legacyDeletion.imageRefs.map((url) => dependencies.deleteLegacyImage(url))
  );
  return {
    legacyId,
    browserCleanupFailed: cleanupResults.some((result) => result.status === "rejected")
  };
}
