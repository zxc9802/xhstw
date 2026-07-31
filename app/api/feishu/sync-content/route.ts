import { ok, readJson } from "@/lib/utils/api";
import { resolveFeishuContentFieldNames, resolveFeishuTagFieldValue } from "@/lib/adapters/feishu-content-fields";
import { buildFeishuBaseUrl } from "@/lib/adapters/feishu-target";
import { getFeishuUploadDateValue } from "@/lib/utils/feishu-upload-date";
import { NextResponse } from "next/server";

type SyncPayload = {
  platform?: string;
  accountName?: string;
  images?: string[];
  title?: string;
  body?: string;
  tags?: string[];
};

const FEISHU_OPEN_API = "https://open.feishu.cn/open-apis";

function parseAppToken(baseUrl = "") {
  const match = baseUrl.match(/\/base\/([^/?#]+)/);
  return match?.[1] || process.env.FEISHU_APP_TOKEN || "";
}

async function feishuRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${FEISHU_OPEN_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.code) {
    throw new Error(data?.msg || data?.message || `Feishu API ${response.status}`);
  }
  return data as T;
}

async function getTenantAccessToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET");
  const data = await feishuRequest<{ tenant_access_token?: string }>("/auth/v3/tenant_access_token/internal", {
    method: "POST",
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  if (!data.tenant_access_token) throw new Error("未获取到飞书 tenant_access_token");
  return data.tenant_access_token;
}

async function getTableId(appToken: string, token: string) {
  if (process.env.FEISHU_TABLE_ID) return process.env.FEISHU_TABLE_ID;
  const data = await feishuRequest<{ data?: { items?: Array<{ table_id?: string }> } }>(`/bitable/v1/apps/${appToken}/tables`, {}, token);
  const tableId = data.data?.items?.[0]?.table_id;
  if (!tableId) throw new Error("未找到飞书多维表 table_id，请检查 Base 链接或配置 FEISHU_TABLE_ID");
  return tableId;
}

async function getFieldNames(appToken: string, tableId: string, token: string) {
  const data = await feishuRequest<{ data?: { items?: Array<{ field_name?: string; type?: number }> } }>(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, {}, token);
  return new Map((data.data?.items ?? []).filter((item) => item.field_name).map((item) => [item.field_name as string, item.type ?? 0]));
}

function parseDataUrl(url: string) {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  return { mime, buffer: Buffer.from(match[2], "base64") };
}

async function imageToBlob(url: string, index: number) {
  const parsed = parseDataUrl(url);
  if (parsed) {
    return {
      blob: new Blob([parsed.buffer], { type: parsed.mime }),
      fileName: `${index + 1}.jpg`
    };
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "image/jpeg";
  return {
    blob: new Blob([arrayBuffer], { type: contentType }),
    fileName: `${index + 1}.jpg`
  };
}

async function uploadImageToFeishu(imageUrl: string, index: number, appToken: string, token: string) {
  const { blob, fileName } = await imageToBlob(imageUrl, index);
  const form = new FormData();
  form.append("file_name", fileName);
  form.append("parent_type", "bitable_image");
  form.append("parent_node", appToken);
  form.append("size", String(blob.size));
  form.append("file", blob, fileName);

  const response = await fetch(`${FEISHU_OPEN_API}/drive/v1/medias/upload_all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.code) {
    throw new Error(data?.msg || data?.message || `图片上传飞书失败：HTTP ${response.status}`);
  }
  const fileToken = data?.data?.file_token;
  if (!fileToken) throw new Error("图片上传飞书成功但未返回 file_token");
  return fileToken as string;
}

export async function POST(request: Request) {
  try {
    const uploadedAt = Date.now();
    const payload = await readJson(request) as SyncPayload;
    const appToken = parseAppToken(process.env.FEISHU_BASE_URL);
    if (!appToken) throw new Error("缺少 FEISHU_BASE_URL 或 FEISHU_APP_TOKEN");

    const token = await getTenantAccessToken();
    const tableId = await getTableId(appToken, token);
    const fields = await getFieldNames(appToken, tableId, token);
    const { titleFieldName, attachmentFieldName, tagFieldName } = resolveFeishuContentFieldNames(fields);
    const imageText = (payload.images ?? []).filter(Boolean).join("\n");
    const tagText = (payload.tags ?? []).map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" ");
    const tagFieldValue = resolveFeishuTagFieldValue(fields, tagFieldName, payload.tags ?? []);
    const uploadWarnings: string[] = [];
    let attachmentValues: Array<{ file_token: string }> = [];

    if (payload.images?.length && !attachmentFieldName) {
      uploadWarnings.push("飞书表中未找到附件字段：图片或视频、图片、平台图片");
    }

    if (attachmentFieldName && payload.images?.length) {
      for (const [index, url] of payload.images.slice(0, 9).entries()) {
        try {
          const fileToken = await uploadImageToFeishu(url, index, appToken, token);
          attachmentValues.push({ file_token: fileToken });
        } catch (error) {
          uploadWarnings.push(error instanceof Error ? error.message : "图片上传飞书失败");
        }
      }
    }

    if (attachmentFieldName && payload.images?.length && !attachmentValues.length) {
      throw new Error(uploadWarnings[0] ?? "图片上传飞书失败");
    }

    const candidateFields: Record<string, unknown> = {
      平台: payload.platform ?? "",
      账号名称: payload.accountName ?? "",
      账号: payload.accountName ?? "",
      上传日期: getFeishuUploadDateValue(fields, uploadedAt),
      图片: imageText,
      平台图片: imageText,
      图片链接: imageText,
      平台图片链接: imageText,
      内容正文: payload.body ?? "",
      小红书tag: tagText
    };
    if (titleFieldName) candidateFields[titleFieldName] = payload.title ?? "";
    if (tagFieldName && (Array.isArray(tagFieldValue) ? tagFieldValue.length : tagFieldValue)) {
      candidateFields[tagFieldName] = tagFieldValue;
    }
    if (attachmentFieldName && attachmentValues.length) {
      candidateFields[attachmentFieldName] = attachmentValues;
    }
    const recordFields = Object.fromEntries(Object.entries(candidateFields).filter(([name, value]) => {
      if (!fields.has(name) || value === "") return false;
      const type = fields.get(name);
      return type !== 17 || Array.isArray(value);
    }));
    if (!Object.keys(recordFields).length) {
      throw new Error("飞书表中未匹配到字段：平台、账号名称、图片或视频、标题、内容正文、小红书tag、关键词、标签");
    }

    const result = await feishuRequest(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
      method: "POST",
      body: JSON.stringify({ fields: recordFields })
    }, token);

    return ok({ appToken, tableId, baseUrl: buildFeishuBaseUrl(appToken, tableId), fields: recordFields, warnings: uploadWarnings, result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "飞书同步失败" }, { status: 500 });
  }
}
