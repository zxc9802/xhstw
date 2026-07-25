"use client";

import { deleteAssetBlob, getAssetBlob, putAssetBlob } from "@/lib/utils/material-library";

export type ProductAsset = {
  id: string;
  type: "image" | "video";
  name: string;
  url?: string;
  storeKey?: string;
  size?: number;
};

export type ProductLibraryItem = {
  id: string;
  name: string;
  category: string;
  sellingPoint: string;
  painPoint: string;
  other: string;
  copy?: string;
  scenarios?: string;
  compliance?: string;
  assets: ProductAsset[];
  status: "active" | "pending";
};

export function formatProductCopyContext(product: ProductLibraryItem) {
  return [
    `产品名称：${product.name.trim() || "未填写"}`,
    `产品分类：${product.category.trim() || "未填写"}`,
    `核心卖点：${product.sellingPoint.trim() || "未填写"}`,
    `核心痛点：${product.painPoint.trim() || "未填写"}`,
    `补充要求：${product.other.trim() || "未填写"}`
  ].join("\n");
}

export const PRODUCT_STORAGE_KEY = "content-production-studio-xhs.product-library";

function productAssetKey(fileName: string) {
  return `product_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${fileName}`;
}

export async function createProductAssetFromFile(file: File, type: "image" | "video", index: number): Promise<ProductAsset> {
  const storeKey = productAssetKey(file.name || String(index));
  await putAssetBlob(storeKey, file);
  return {
    id: `asset_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    name: file.name,
    storeKey,
    size: file.size,
    url: URL.createObjectURL(file)
  };
}

async function hydrateProductAsset(asset: ProductAsset): Promise<ProductAsset> {
  if (!asset.storeKey) return asset;
  const blob = await getAssetBlob(asset.storeKey);
  return blob ? { ...asset, url: URL.createObjectURL(blob) } : asset;
}

export async function hydrateProductLibrary(items: ProductLibraryItem[]) {
  return Promise.all(items.map(async (item) => ({
    ...item,
    assets: await Promise.all((item.assets ?? []).map(hydrateProductAsset))
  })));
}

async function migrateAssetForStorage(asset: ProductAsset): Promise<ProductAsset> {
  if (asset.storeKey) {
    const { url, ...storedAsset } = asset;
    return storedAsset;
  }
  if (asset.url?.startsWith("data:") || asset.url?.startsWith("blob:")) {
    try {
      const response = await fetch(asset.url);
      const blob = await response.blob();
      const storeKey = productAssetKey(asset.name || asset.id);
      await putAssetBlob(storeKey, blob);
      const { url, ...storedAsset } = asset;
      return { ...storedAsset, storeKey, size: blob.size };
    } catch {
      return asset;
    }
  }
  return asset;
}

async function prepareProductForStorage(item: ProductLibraryItem): Promise<ProductLibraryItem> {
  return {
    ...item,
    assets: await Promise.all((item.assets ?? []).map(migrateAssetForStorage))
  };
}

export async function readProductLibrary(): Promise<ProductLibraryItem[]> {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRODUCT_STORAGE_KEY);
    if (!raw) return [];
    return await hydrateProductLibrary(JSON.parse(raw) as ProductLibraryItem[]);
  } catch {
    return [];
  }
}

export async function writeProductLibrary(items: ProductLibraryItem[]) {
  if (typeof window === "undefined") return;
  const storedItems = await Promise.all(items.map(prepareProductForStorage));
  window.localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(storedItems));
}

export async function deleteProductAsset(asset: ProductAsset) {
  if (asset.storeKey) await deleteAssetBlob(asset.storeKey);
}

export async function deleteProductAssets(product: Pick<ProductLibraryItem, "assets">) {
  await Promise.all((product.assets ?? []).map(deleteProductAsset));
}
