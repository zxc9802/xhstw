"use client";

import { useEffect, useState } from "react";
import { FileText, ImagePlus, PackageSearch, Plus, UploadCloud, Video, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { createProductAssetFromFile, deleteProductAssets, readProductLibrary, writeProductLibrary, type ProductLibraryItem } from "@/lib/utils/product-library";

const initialProducts: ProductLibraryItem[] = [
  {
    id: "p1",
    name: "清爽防晒喷雾",
    category: "防晒 / 补涂",
    sellingPoint: "通勤便携、不黏腻、适合午后补防晒",
    painPoint: "午后出油、补涂麻烦、担心妆面搓泥。",
    other: "适合办公室、通勤包、午休外出前补喷使用。避免绝对化防晒承诺，不表达医疗功效。",
    assets: [],
    status: "active"
  },
  {
    id: "p2",
    name: "敏感肌防晒霜",
    category: "防晒 / 敏感肌",
    sellingPoint: "温和肤感、换季友好、适合避坑清单内容",
    painPoint: "换季泛红、担心刺激、害怕厚重闷痘。",
    other: "适合做成敏感肌防晒避坑、成分温和表达、通勤使用体验。不承诺治疗、修复、不过敏等绝对结果。",
    assets: [],
    status: "active"
  }
];

const emptyDraft: ProductLibraryItem = {
  id: "",
  name: "",
  category: "",
  sellingPoint: "",
  painPoint: "",
  other: "",
  assets: [],
  status: "pending"
};

function normalizeProduct(item: ProductLibraryItem): ProductLibraryItem {
  return {
    ...emptyDraft,
    ...item,
    painPoint: item.painPoint ?? item.copy ?? "",
    other: item.other ?? [item.scenarios, item.compliance].filter(Boolean).join("\n"),
    assets: item.assets ?? []
  };
}

export default function ProductPage() {
  const [products, setProducts] = useState<ProductLibraryItem[]>(initialProducts);
  const [editing, setEditing] = useState<ProductLibraryItem | null>(null);
  const [previewingAssets, setPreviewingAssets] = useState<ProductLibraryItem | null>(null);
  const [feedback, setFeedback] = useState("产品资料库已就绪，可新增、编辑并上传图片 / 视频素材。");

  useEffect(() => {
    void readProductLibrary().then((stored) => {
      if (stored.length) setProducts(stored.map(normalizeProduct));
    });
  }, []);

  const persistProducts = async (items: ProductLibraryItem[]) => {
    setProducts(items);
    await writeProductLibrary(items);
  };

  const openNewProduct = () => {
    setEditing({ ...emptyDraft, id: `product_${Date.now()}` });
  };

  const updateDraft = (patch: Partial<ProductLibraryItem>) => {
    setEditing((item) => item ? { ...item, ...patch } : item);
  };

  const addAssets = async (files: FileList | null, type: "image" | "video") => {
    const validFiles = Array.from(files ?? []).filter((file) => type === "image" ? file.type.startsWith("image/") : file.type.startsWith("video/"));
    const incoming = await Promise.all(validFiles.map((file, index) => createProductAssetFromFile(file, type, index)));
    if (!incoming.length) return;
    setEditing((item) => item ? { ...item, assets: [...incoming, ...item.assets] } : item);
  };

  const deleteAsset = (assetId: string) => {
    setEditing((item) => item ? { ...item, assets: item.assets.filter((asset) => asset.id !== assetId) } : item);
  };

  const saveProduct = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setFeedback("请先填写产品名称。");
      return;
    }
    const nextProduct = {
      ...editing,
      name: editing.name.trim(),
      category: editing.category.trim() || "未分类",
      status: editing.sellingPoint.trim() && editing.painPoint.trim() ? "active" as const : "pending" as const
    };
    try {
      await persistProducts(products.some((item) => item.id === nextProduct.id) ? products.map((item) => item.id === nextProduct.id ? nextProduct : item) : [nextProduct, ...products]);
      setEditing(null);
      setFeedback(`已保存产品资料：${nextProduct.name}`);
    } catch {
      setFeedback("保存失败：浏览器本地存储异常，请稍后再试。");
    }
  };

  const deleteProduct = async (product: ProductLibraryItem) => {
    await deleteProductAssets(product);
    await persistProducts(products.filter((item) => item.id !== product.id));
    if (editing?.id === product.id) setEditing(null);
    if (previewingAssets?.id === product.id) setPreviewingAssets(null);
    setFeedback(`已删除产品资料：${product.name}`);
  };

  const assetCount = products.reduce((total, item) => total + item.assets.length, 0);
  const pendingCount = products.filter((item) => item.status === "pending").length;

  return (
    <>
      <PageHeader
        title="产品资料库"
        description="沉淀产品基础信息、卖点、痛点、素材和补充信息，供内容生产时引用。"
        action={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openNewProduct}>新增产品资料</Button>}
      />

      <div className="rounded-md bg-orange-50 px-4 py-3 text-sm text-orange-700">{feedback}</div>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["产品资料", products.length],
          ["可用素材", assetCount],
          ["待完善", pendingCount]
        ].map(([label, value]) => (
          <Card key={label}>
            <CardBody>
              <p className="text-sm text-muted">{label}</p>
              <p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
            </CardBody>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader title="产品资料" subtitle="可上传图片、视频，维护产品名称、分类、核心卖点、核心痛点和其他信息。" />
        <CardBody className="p-0">
          <DataTable headers={["产品", "分类", "核心卖点", "素材", "状态", "操作"]} className="rounded-none border-0 shadow-none">
            {products.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setPreviewingAssets(item)} className="flex h-14 w-14 overflow-hidden rounded-lg bg-orange-50 text-orange-700 ring-1 ring-orange-100 transition hover:ring-orange-300" title="查看全部素材">
                      {item.assets.find((asset) => asset.type === "image")
                        ? <img src={item.assets.find((asset) => asset.type === "image")?.url} alt={item.name} className="h-full w-full object-cover" />
                        : <span className="flex h-full w-full items-center justify-center"><PackageSearch className="h-5 w-5" /></span>}
                    </button>
                    <span className="font-medium text-ink">{item.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted">{item.category}</td>
                <td className="max-w-lg px-4 py-3 text-muted"><p className="line-clamp-2">{item.sellingPoint}</p></td>
                <td className="px-4 py-3 text-muted">{item.assets.filter((asset) => asset.type === "image").length} 图 / {item.assets.filter((asset) => asset.type === "video").length} 视频</td>
                <td className="px-4 py-3"><StatusBadge status={item.status} label={item.status === "active" ? "可用" : "待完善"} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setEditing({ ...item })}>编辑资料</Button>
                    <Button className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => void deleteProduct(item)}>删除</Button>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </CardBody>
      </Card>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">{products.some((item) => item.id === editing.id) ? "编辑产品资料" : "新增产品资料"}</h2>
                <p className="mt-1 text-sm text-muted">图片、视频、核心卖点、核心痛点和其他信息都会保存在本地产品资料库。</p>
              </div>
              <button onClick={() => setEditing(null)} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[0.46fr_0.54fr]">
              <div className="space-y-3">
                <div className="overflow-hidden rounded-lg border border-line bg-slate-50">
                  {editing.assets.find((asset) => asset.type === "image") ? (
                    <img src={editing.assets.find((asset) => asset.type === "image")?.url} alt="产品封面图" className="h-56 w-full object-cover" />
                  ) : (
                    <div className="flex h-56 flex-col items-center justify-center text-sm text-muted">
                      <PackageSearch className="mb-2 h-7 w-7 text-orange-600" />
                      上传第一张图片后会作为产品封面图
                    </div>
                  )}
                </div>
                <label className="block text-sm font-medium text-ink">产品名称<input value={editing.name} onChange={(event) => updateDraft({ name: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" placeholder="例如：清爽防晒喷雾" /></label>
                <label className="block text-sm font-medium text-ink">产品分类<input value={editing.category} onChange={(event) => updateDraft({ category: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" placeholder="例如：防晒 / 补涂" /></label>
                <label className="block text-sm font-medium text-ink">核心卖点<textarea value={editing.sellingPoint} onChange={(event) => updateDraft({ sellingPoint: event.target.value })} className="mt-2 min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" placeholder="一行一个卖点，或用逗号分隔" /></label>
                <label className="block text-sm font-medium text-ink">核心痛点<textarea value={editing.painPoint} onChange={(event) => updateDraft({ painPoint: event.target.value })} className="mt-2 min-h-28 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" placeholder="用户为什么需要这个产品，比如出油、闷痘、补涂麻烦、敏感泛红等" /></label>
                <label className="block text-sm font-medium text-ink">其他<textarea value={editing.other} onChange={(event) => updateDraft({ other: event.target.value })} className="mt-2 min-h-28 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" placeholder="补充信息、禁用词、使用场景、注意事项等" /></label>
              </div>

              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-orange-200 bg-orange-50 text-sm font-medium text-orange-700 transition hover:bg-orange-100">
                    <ImagePlus className="h-4 w-4" />
                    上传图片
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void addAssets(event.target.files, "image")} />
                  </label>
                  <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-orange-200 bg-orange-50 text-sm font-medium text-orange-700 transition hover:bg-orange-100">
                    <Video className="h-4 w-4" />
                    上传视频
                    <input type="file" accept="video/*" multiple className="hidden" onChange={(event) => void addAssets(event.target.files, "video")} />
                  </label>
                </div>
                <div className="rounded-lg border border-line bg-slate-50 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><UploadCloud className="h-4 w-4 text-orange-600" />产品素材</div>
                  {editing.assets.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {editing.assets.map((asset) => (
                        <div key={asset.id} className="overflow-hidden rounded-lg border border-line bg-white">
                          {asset.type === "video"
                            ? <video src={asset.url} className="h-40 w-full bg-black object-contain" controls />
                            : <img src={asset.url} alt={asset.name} className="h-40 w-full object-cover" />}
                          <div className="flex items-center justify-between gap-2 px-3 py-2">
                            <span className="truncate text-xs text-muted">{asset.name}</span>
                            <button onClick={() => deleteAsset(asset.id)} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">删除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-52 flex-col items-center justify-center rounded-md border border-dashed border-line bg-white text-sm text-muted">
                      <FileText className="mb-2 h-5 w-5" />
                      暂无素材，可上传产品图、质地图、场景图或视频
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <Button onClick={() => setEditing(null)}>取消</Button>
              <Button variant="primary" onClick={() => void saveProduct()}>保存资料</Button>
            </div>
          </div>
        </div>
      ) : null}
      {previewingAssets ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">{previewingAssets.name} · 全部素材</h2>
                <p className="mt-1 text-sm text-muted">{previewingAssets.assets.filter((asset) => asset.type === "image").length} 图 / {previewingAssets.assets.filter((asset) => asset.type === "video").length} 视频</p>
              </div>
              <button onClick={() => setPreviewingAssets(null)} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
              {previewingAssets.assets.length ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {previewingAssets.assets.map((asset) => (
                    <div key={asset.id} className="overflow-hidden rounded-lg border border-line bg-white">
                      {asset.type === "video"
                        ? <video src={asset.url} className="h-64 w-full bg-black object-contain" controls />
                        : <img src={asset.url} alt={asset.name} className="h-64 w-full object-cover" />}
                      <p className="truncate px-3 py-2 text-xs text-muted">{asset.name}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed border-line bg-white text-sm text-muted">
                  <PackageSearch className="mb-2 h-7 w-7 text-orange-600" />
                  这个产品还没有上传素材。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
