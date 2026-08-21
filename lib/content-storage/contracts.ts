export const CONTENT_IMAGE_MAX_COUNT = 20;
export const CONTENT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const CONTENT_IMAGE_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
export const CONTENT_MANIFEST_MAX_BYTES = 1024 * 1024;
export const CONTENT_UPLOAD_INTENT_TTL_MS = 10 * 60 * 1000;

export const CONTENT_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);

export type LibraryStatus = '可发布' | '需复查' | '已归档' | '已淘汰';
export type RiskLevel = '低' | '中' | '高';

export interface ImageDescriptor {
  contentType: string;
  size: number;
}

export interface UploadIntentObject extends ImageDescriptor {
  fileId: string;
  key: string;
}

export interface ReferenceSourceSnapshot {
  title: string;
  url: string;
  platform: string;
  media: Array<{
    type: 'image' | 'video';
    url: string;
    name?: string;
    posterUrl?: string;
  }>;
}

export type StoredMedia =
  | {
      storage: 'cos';
      fileId: string;
      key: string;
      contentType: string;
      size: number;
    }
  | {
      storage: 'external';
      fileId: string;
      mediaType: 'video';
      url: string;
    };

export interface StoredContentPage {
  page: number;
  title: string;
  copy: string;
  prompt: string;
  provider: string;
  sourceImages: string[];
}

export interface StoredContentManifest {
  schemaVersion: 1;
  id: string;
  ownerId: string;
  legacySourceId?: string;
  title: string;
  summary: string;
  body: string;
  platform: string;
  account: string;
  type: string;
  mediaKind: 'image' | 'video';
  media: StoredMedia[];
  pages: StoredContentPage[];
  referenceSources: ReferenceSourceSnapshot[];
  tags: string[];
  folder: string | null;
  prompts: string[];
  negativePrompts: string[];
  status: LibraryStatus;
  systemState: 'active' | 'deleting';
  duplicateRate: number;
  duplicateLabel: string;
  lowFlowRisk: RiskLevel;
  checkAdvice: string[];
  reviewNotes: string[];
  createdAt: string;
  updatedAt: string;
}

export type ContentDraft = Omit<StoredContentManifest, 'schemaVersion' | 'id' | 'ownerId' | 'media' | 'systemState' | 'createdAt' | 'updatedAt'> & {
  externalVideoUrls: string[];
};

export interface UploadIntent {
  contentId: string;
  token: string;
  uploads: Array<UploadIntentObject & { uploadUrl: string }>;
  expiresAt: number;
}

const CONTENT_ID_PATTERN = /^\d{8}T\d{9}Z-[0-9a-f]{12}$/;
const FILE_ID_PATTERN = /^\d{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif|avif)$/;

export function createContentId(now: Date, id: string): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now');
  const uuid = id.toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(uuid)) throw new Error('id');
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 23).replace(/[:.]/g, '')}Z-${uuid.slice(0, 12)}`;
}

function encodeOwnerId(ownerId: string): string {
  if (!ownerId.trim()) throw new Error('ownerId不能为空');
  return encodeURIComponent(ownerId).replace(/\./g, '%2E');
}

export function userContentsPrefix(ownerId: string): string {
  return `users/${encodeOwnerId(ownerId)}/contents/`;
}

function validateContentId(contentId: string): void {
  if (!CONTENT_ID_PATTERN.test(contentId)) throw new Error('contentId无效');
}

export function manifestObjectKey(ownerId: string, contentId: string): string {
  validateContentId(contentId);
  return `${userContentsPrefix(ownerId)}${contentId}/manifest.json`;
}

export function mediaFileId(index: number, contentType: string, id: string): string {
  if (!Number.isInteger(index) || index < 0 || index > 998) throw new Error('index无效');
  const extension = CONTENT_IMAGE_TYPES.get(contentType);
  if (!extension) throw new Error('不支持的图片类型');
  const uuid = id.toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(uuid)) throw new Error('id');
  return `${String(index + 1).padStart(3, '0')}-${uuid.slice(0, 12)}.${extension}`;
}

export function imageObjectKey(ownerId: string, contentId: string, fileId: string): string {
  validateContentId(contentId);
  if (!FILE_ID_PATTERN.test(fileId)) throw new Error('fileId无效');
  return `${userContentsPrefix(ownerId)}${contentId}/images/${fileId}`;
}

export function parseImageDescriptors(value: unknown): ImageDescriptor[] {
  if (!Array.isArray(value)) throw new Error('图片列表无效');
  if (value.length > CONTENT_IMAGE_MAX_COUNT) throw new Error('最多 20 张');
  let total = 0;
  const descriptors = value.map((item) => {
    const descriptor = item as Partial<ImageDescriptor>;
    if (!CONTENT_IMAGE_TYPES.has(descriptor.contentType ?? '')) throw new Error('不支持的图片类型');
    if (!Number.isInteger(descriptor.size) || (descriptor.size as number) <= 0) throw new Error('图片大小无效');
    if ((descriptor.size as number) > CONTENT_IMAGE_MAX_BYTES) throw new Error('单张图片不能超过 20 MB');
    total += descriptor.size as number;
    return { contentType: descriptor.contentType as string, size: descriptor.size as number };
  });
  if (total > CONTENT_IMAGE_TOTAL_MAX_BYTES) throw new Error('图片总大小不能超过 100 MB');
  return descriptors;
}
