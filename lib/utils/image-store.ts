"use client";

const DB_NAME = "content-production-studio-image-store";
const DB_VERSION = 1;
const STORE_NAME = "images";
export const IMAGE_STORE_PREFIX = "cps-image://";

type StoredImage = {
  id: string;
  blob: Blob;
  createdAt: string;
};

function openImageDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putStoredImage(image: StoredImage) {
  const db = await openImageDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(image);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

async function getStoredImage(id: string) {
  const db = await openImageDb();
  return new Promise<StoredImage | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as StoredImage | undefined);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

function makeImageKey(scope: string, index: number) {
  return `${scope}_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isStoredImageRef(url: string) {
  return url.startsWith(IMAGE_STORE_PREFIX);
}

export async function persistImageRefs(urls: string[], scope: string) {
  const refs: string[] = [];
  for (const [index, url] of urls.entries()) {
    if (!url || isStoredImageRef(url) || /^https?:\/\//i.test(url)) {
      refs.push(url);
      continue;
    }
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const id = makeImageKey(scope, index);
      await putStoredImage({ id, blob, createdAt: new Date().toISOString() });
      refs.push(`${IMAGE_STORE_PREFIX}${id}`);
    } catch {
      refs.push(url);
    }
  }
  return refs;
}

export async function resolveImageRef(url: string) {
  if (!isStoredImageRef(url)) return url;
  const image = await getStoredImage(url.slice(IMAGE_STORE_PREFIX.length));
  return image ? URL.createObjectURL(image.blob) : "";
}

export async function resolveImageRefs(urls: string[]) {
  return (await Promise.all(urls.map((url) => resolveImageRef(url)))).filter(Boolean);
}

export async function imageRefToUploadUrl(url: string) {
  if (!isStoredImageRef(url)) return url;
  const image = await getStoredImage(url.slice(IMAGE_STORE_PREFIX.length));
  if (!image) return "";
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(image.blob);
  });
}
