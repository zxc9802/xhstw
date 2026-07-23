export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function loadVersionedState<T>(storage: StorageLike, key: string, version: number, fallback: T): T {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "null") as { version?: number; data?: T } | null;
    return parsed?.version === version && parsed.data !== undefined ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function saveVersionedState<T>(storage: StorageLike, key: string, version: number, data: T) {
  try {
    storage.setItem(key, JSON.stringify({ version, data }));
    return true;
  } catch {
    return false;
  }
}
