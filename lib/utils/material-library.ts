export type AssetKind = "image" | "video" | "file" | "folder";

export type LibraryAsset = {
  id: string;
  name: string;
  type: AssetKind;
  source: string;
  createdAt: string;
  storeKey?: string;
  url?: string;
  size?: number;
  note?: string;
  folderPath?: string;
  coverAssetId?: string;
  children?: LibraryAsset[];
};

export const MATERIAL_STORAGE_KEY = "content-production-studio-xhs.material-library";
export const ASSET_DB_NAME = "content-production-studio-assets";
export const ASSET_STORE_NAME = "assets";

export function createLibraryAsset(input: Partial<LibraryAsset> & { name: string; type: AssetKind; source: string }): LibraryAsset {
  return {
    id: input.id ?? `asset_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: input.name,
    type: input.type,
    source: input.source,
    createdAt: input.createdAt ?? new Date().toISOString(),
    storeKey: input.storeKey,
    url: input.url,
    size: input.size,
    note: input.note,
    folderPath: input.folderPath,
    coverAssetId: input.coverAssetId,
    children: input.children
  };
}

export function createFolderAsset(input: { name: string; source: string; children?: LibraryAsset[]; note?: string }): LibraryAsset {
  return createLibraryAsset({
    name: input.name,
    type: "folder",
    source: input.source,
    note: input.note,
    children: input.children ?? []
  });
}

export function readMaterialLibrary(): LibraryAsset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MATERIAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) as LibraryAsset[] : [];
  } catch {
    return [];
  }
}

export function writeMaterialLibrary(items: LibraryAsset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MATERIAL_STORAGE_KEY, JSON.stringify(items));
}

export function appendMaterialLibrary(items: LibraryAsset[]) {
  if (typeof window === "undefined") return;
  const existing = readMaterialLibrary();
  const merged = [...items, ...existing.filter((item) => !items.some((next) => next.id === item.id))];
  writeMaterialLibrary(merged.map(stripRuntimeAssetUrl));
}

export function stripRuntimeAssetUrl<T extends { url?: string; storeKey?: string; children?: T[] }>(asset: T): T {
  const next = { ...asset };
  if (next.storeKey && next.url?.startsWith("blob:")) {
    delete next.url;
  }
  if (next.children) {
    next.children = next.children.map((child) => stripRuntimeAssetUrl(child));
  }
  return next;
}

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putAssetBlob(key: string, blob: Blob) {
  if (typeof indexedDB === "undefined") return;
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).put(blob, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function getAssetBlob(key: string): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openAssetDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readonly");
    const request = transaction.objectStore(ASSET_STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

export async function deleteAssetBlob(key: string) {
  if (typeof indexedDB === "undefined") return;
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function deleteAssetBlobsRecursively(asset: LibraryAsset) {
  if (asset.storeKey) await deleteAssetBlob(asset.storeKey);
  for (const child of asset.children ?? []) {
    await deleteAssetBlobsRecursively(child);
  }
}

export function countAssetChildren(asset: LibraryAsset): number {
  if (!asset.children?.length) return 0;
  return asset.children.reduce((sum, child) => sum + 1 + countAssetChildren(child), 0);
}
