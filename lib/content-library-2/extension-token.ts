import { createHmac, timingSafeEqual } from "node:crypto";

export const LIBRARY2_EXTENSION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type TokenPayload = {
  version: 1;
  kind: "library2-extension";
  ownerId: string;
  expiresAt: number;
};

function secret() {
  const value = process.env.APP_SESSION_SECRET?.trim();
  if (!value) throw new Error("上传令牌配置无效");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createLibrary2ExtensionToken(ownerId: string, now = Date.now()) {
  if (!ownerId.trim()) throw new Error("ownerId不能为空");
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    kind: "library2-extension",
    ownerId,
    expiresAt: now + LIBRARY2_EXTENSION_TOKEN_TTL_MS
  } satisfies TokenPayload)).toString("base64url");
  return {
    token: `${payload}.${sign(payload)}`,
    expiresAt: now + LIBRARY2_EXTENSION_TOKEN_TTL_MS
  };
}

export function verifyLibrary2ExtensionToken(token: string, now = Date.now()): { ownerId: string; expiresAt: number } {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error();
    const [payload, actual] = parts;
    const expected = sign(payload);
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.byteLength !== expectedBytes.byteLength || !timingSafeEqual(actualBytes, expectedBytes)) {
      throw new Error();
    }
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<TokenPayload>;
    if (
      value.version !== 1
      || value.kind !== "library2-extension"
      || typeof value.ownerId !== "string"
      || !value.ownerId.trim()
      || !Number.isInteger(value.expiresAt)
      || (value.expiresAt as number) <= now
    ) {
      throw new Error();
    }
    return { ownerId: value.ownerId, expiresAt: value.expiresAt as number };
  } catch {
    throw new Error("插件授权无效，请先打开图文生产中台并登录。");
  }
}
