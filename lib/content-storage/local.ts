import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentStorageGateway, StoredObject } from "./gateway";

const META_SUFFIX = ".meta.json";

export function localContentStorageRoot() {
  const configured = process.env.LOCAL_CONTENT_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "outputs", "content-storage");
}

function assertSafeKey(key: string) {
  if (!key || key.includes("\\") || key.includes("\0") || key.includes(":") || key.startsWith("/")) {
    throw new Error("对象路径无效");
  }
  const parts = key.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error("对象路径无效");
  }
  return parts;
}

function resolveObjectPath(root: string, key: string) {
  const full = path.resolve(root, ...assertSafeKey(key));
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("对象路径无效");
  }
  return full;
}

function inferContentType(key: string) {
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".gif")) return "image/gif";
  if (key.endsWith(".avif")) return "image/avif";
  return "application/octet-stream";
}

async function readMeta(filePath: string, key: string) {
  try {
    const meta = JSON.parse(await readFile(`${filePath}${META_SUFFIX}`, "utf8")) as { contentType?: unknown };
    return typeof meta.contentType === "string" && meta.contentType ? meta.contentType : inferContentType(key);
  } catch {
    return inferContentType(key);
  }
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(full));
      continue;
    }
    if (entry.isFile() && !entry.name.endsWith(META_SUFFIX)) files.push(full);
  }
  return files;
}

export class LocalFileGateway implements ContentStorageGateway {
  constructor(private readonly root = localContentStorageRoot()) {}

  private filePath(key: string) {
    return resolveObjectPath(this.root, key);
  }

  async headObject(key: string) {
    try {
      const filePath = this.filePath(key);
      const info = await stat(filePath);
      if (!info.isFile()) return undefined;
      return { contentType: await readMeta(filePath, key), size: info.size };
    } catch {
      return undefined;
    }
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string) {
    const filePath = this.filePath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
    await writeFile(`${filePath}${META_SUFFIX}`, JSON.stringify({ contentType }));
  }

  async putJson(key: string, value: unknown) {
    await this.putObject(
      key,
      new TextEncoder().encode(JSON.stringify(value)),
      "application/json; charset=utf-8"
    );
  }

  async getJson(key: string) {
    const object = await this.getObject(key);
    return object ? JSON.parse(new TextDecoder().decode(object.bytes)) : undefined;
  }

  async listKeys(prefix: string) {
    const startKey = prefix.replace(/\/+$/, "");
    const startPath = startKey ? this.filePath(startKey) : this.root;
    try {
      const info = await stat(startPath);
      if (!info.isDirectory() && !info.isFile()) return [];
      const files = info.isDirectory() ? await walkFiles(startPath) : [startPath];
      return files
        .map((filePath) => path.relative(this.root, filePath).split(path.sep).join("/"))
        .filter((key) => key.startsWith(prefix));
    } catch {
      return [];
    }
  }

  async getObject(key: string): Promise<StoredObject | undefined> {
    try {
      const filePath = this.filePath(key);
      const bytes = new Uint8Array(await readFile(filePath));
      return { bytes, contentType: await readMeta(filePath, key) };
    } catch {
      return undefined;
    }
  }

  async deleteKeys(keys: string[]) {
    for (const key of [...new Set(keys)]) {
      const filePath = this.filePath(key);
      await rm(filePath, { force: true });
      await rm(`${filePath}${META_SUFFIX}`, { force: true });
    }
  }
}

export function isLocalContentStorageEnabled() {
  const mode = process.env.CONTENT_STORAGE?.trim().toLowerCase();
  if (mode === "local") return true;
  if (mode === "cos") return false;
  return !process.env.TENCENT_COS_SECRET_ID?.trim() || !process.env.TENCENT_COS_SECRET_KEY?.trim();
}
