export type WritableFileLike = {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
};

export type WritableDirectoryLike = {
  name: string;
  getFileHandle(name: string, options: { create: true }): Promise<WritableFileLike>;
  getDirectoryHandle?(name: string, options: { create: true }): Promise<WritableDirectoryLike>;
};

export type BlobFile = {
  name: string;
  blob: Blob;
};

export function safeFileName(value: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/g, "");
  return sanitized || "未命名";
}

export function imageExtension(blob: Blob): "png" | "jpg" | "webp" | "gif" {
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  if (blob.type === "image/gif") return "gif";
  return "png";
}

export async function writeBlobFiles(directory: WritableDirectoryLike, files: BlobFile[]) {
  let saved = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      const fileHandle = await directory.getFileHandle(file.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file.blob);
      await writable.close();
      saved += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${file.name}: ${message}`);
    }
  }

  return { saved, failed: errors.length, errors };
}
