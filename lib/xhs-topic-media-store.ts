export const XHS_TOPIC_MEDIA_DB_NAME = "content-production-studio-xhs-topic-media";
const DB_VERSION = 1;
const MANIFESTS = "manifests";
const CHUNKS = "chunks";

export type MediaRole = "image" | "video" | "poster";

export interface MediaStart {
  assetKey: string;
  topicKey: string;
  mediaRole: MediaRole;
  sourceUrl: string;
}

export interface MediaChunk {
  assetKey: string;
  chunkIndex: number;
  data: string;
  byteLength: number;
}

export interface MediaComplete {
  assetKey: string;
  mimeType: string;
  byteLength: number;
  chunkCount: number;
}

interface Manifest extends MediaStart {
  mimeType: string;
  size: number;
  chunkCount: number;
  status: "complete";
  createdAt: string;
}

interface ChunkRecord {
  assetKey: string;
  chunkIndex: number;
  blob: Blob;
  byteLength: number;
}

export interface XhsTopicMediaStore {
  prepare(start: MediaStart): Promise<"ready" | "skip">;
  writeChunk(chunk: MediaChunk): Promise<void>;
  complete(complete: MediaComplete): Promise<Manifest>;
  abort(assetKey: string): Promise<void>;
  getBlob(assetKey: string): Promise<Blob | null>;
  deleteAssets(assetKeys: string[]): Promise<void>;
  cleanupIncomplete(): Promise<number>;
}

function decodeChunk(data: string, declaredLength: number) {
  const binary = atob(data);
  if (binary.length !== declaredLength) throw new Error("Media chunk byte length mismatch.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes]);
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(XHS_TOPIC_MEDIA_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MANIFESTS)) {
        database.createObjectStore(MANIFESTS, { keyPath: "assetKey" });
      }
      if (!database.objectStoreNames.contains(CHUNKS)) {
        const chunks = database.createObjectStore(CHUNKS, { keyPath: ["assetKey", "chunkIndex"] });
        chunks.createIndex("byAsset", "assetKey", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open XHS topic media database."));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function deleteChunkCursor(store: IDBObjectStore, assetKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.index("byAsset").openCursor(assetKey);
    request.onerror = () => reject(request.error ?? new Error("Unable to enumerate media chunks."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });
}

export function createXhsTopicMediaStore(factory: IDBFactory = indexedDB): XhsTopicMediaStore {
  const databasePromise = openDatabase(factory);
  const pending = new Map<string, MediaStart & { nextChunkIndex: number; byteLength: number }>();

  async function getManifest(assetKey: string) {
    const database = await databasePromise;
    const transaction = database.transaction(MANIFESTS, "readonly");
    return requestValue(transaction.objectStore(MANIFESTS).get(assetKey)) as Promise<Manifest | undefined>;
  }

  async function putManifest(manifest: Manifest) {
    const database = await databasePromise;
    const transaction = database.transaction(MANIFESTS, "readwrite");
    transaction.objectStore(MANIFESTS).put(manifest);
    await transactionDone(transaction);
  }

  async function putChunk(chunk: ChunkRecord) {
    const database = await databasePromise;
    const transaction = database.transaction(CHUNKS, "readwrite");
    transaction.objectStore(CHUNKS).put(chunk);
    await transactionDone(transaction);
  }

  async function getChunks(assetKey: string) {
    const database = await databasePromise;
    const transaction = database.transaction(CHUNKS, "readonly");
    return requestValue(transaction.objectStore(CHUNKS).index("byAsset").getAll(assetKey)) as Promise<ChunkRecord[]>;
  }

  async function getAllRecords<T>(storeName: string) {
    const database = await databasePromise;
    const transaction = database.transaction(storeName, "readonly");
    return requestValue(transaction.objectStore(storeName).getAll()) as Promise<T[]>;
  }

  async function deleteAssets(assetKeys: string[]) {
    if (!assetKeys.length) return;
    const database = await databasePromise;
    const transaction = database.transaction([MANIFESTS, CHUNKS], "readwrite");
    const manifests = transaction.objectStore(MANIFESTS);
    const chunks = transaction.objectStore(CHUNKS);
    for (const assetKey of Array.from(new Set(assetKeys))) {
      manifests.delete(assetKey);
      await deleteChunkCursor(chunks, assetKey);
      pending.delete(assetKey);
    }
    await transactionDone(transaction);
  }

  return {
    async prepare(start) {
      const existing = await getManifest(start.assetKey);
      if (existing?.status === "complete") return "skip";
      await deleteAssets([start.assetKey]);
      pending.set(start.assetKey, { ...start, nextChunkIndex: 0, byteLength: 0 });
      return "ready";
    },
    async writeChunk(chunk) {
      const state = pending.get(chunk.assetKey);
      if (!state || state.nextChunkIndex !== chunk.chunkIndex) throw new Error("Media chunk order mismatch.");
      const blob = decodeChunk(chunk.data, chunk.byteLength);
      await putChunk({ assetKey: chunk.assetKey, chunkIndex: chunk.chunkIndex, blob, byteLength: chunk.byteLength });
      state.nextChunkIndex += 1;
      state.byteLength += chunk.byteLength;
    },
    async complete(input) {
      const state = pending.get(input.assetKey);
      if (!state || state.nextChunkIndex !== input.chunkCount) throw new Error("Media chunk count mismatch.");
      if (state.byteLength !== input.byteLength) throw new Error("Media byte length mismatch.");
      const manifest: Manifest = {
        assetKey: input.assetKey,
        topicKey: state.topicKey,
        mediaRole: state.mediaRole,
        sourceUrl: state.sourceUrl,
        mimeType: input.mimeType,
        size: input.byteLength,
        chunkCount: input.chunkCount,
        status: "complete",
        createdAt: new Date().toISOString()
      };
      await putManifest(manifest);
      pending.delete(input.assetKey);
      return manifest;
    },
    async abort(assetKey) {
      await deleteAssets([assetKey]);
    },
    async getBlob(assetKey) {
      const manifest = await getManifest(assetKey);
      if (!manifest || manifest.status !== "complete") return null;
      const chunks = (await getChunks(assetKey)).sort((left, right) => left.chunkIndex - right.chunkIndex);
      if (chunks.length !== manifest.chunkCount) return null;
      let byteLength = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        if (chunks[index].chunkIndex !== index) return null;
        byteLength += chunks[index].byteLength;
      }
      if (byteLength !== manifest.size) return null;
      return new Blob(chunks.map((chunk) => chunk.blob), { type: manifest.mimeType });
    },
    deleteAssets,
    async cleanupIncomplete() {
      const manifests = await getAllRecords<Manifest>(MANIFESTS);
      const complete = new Set(manifests.filter((item) => item.status === "complete").map((item) => item.assetKey));
      const chunks = await getAllRecords<ChunkRecord>(CHUNKS);
      const abandoned = Array.from(new Set(chunks.map((item) => item.assetKey).filter((assetKey) => !complete.has(assetKey))));
      await deleteAssets(abandoned);
      return abandoned.length;
    }
  };
}
