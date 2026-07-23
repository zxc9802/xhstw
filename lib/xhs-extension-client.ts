import type { Topic } from "@/types/topic";
import type { MediaChunk, MediaComplete, MediaStart, XhsTopicMediaStore } from "@/lib/xhs-topic-media-store";

export const XHS_EXTENSION_CHANNEL = "content-production-studio.xhs-extension";
export const XHS_EXTENSION_PROTOCOL_VERSION = 2;

const DEFAULT_PING_TIMEOUT_MS = 2_000;
const DEFAULT_COLLECT_TIMEOUT_MS = 10 * 60 * 1_000;
const LEGACY_PING_DELAY_MS = 150;

type PageMessageType = "ping" | "collect" | "cancel" | "media:ready" | "media:skip" | "media:ack" | "media:abort";
type ExtensionMessageType = "pong" | "progress" | "media:start" | "media:chunk" | "media:complete" | "media:error" | "result" | "error";

export interface XhsCollectTask {
  requestId: string;
  queries: string[];
  limitPerQuery: number;
  mediaType: "全部" | "图文" | "视频";
  dateRange: "全部" | "一天内" | "一周内" | "半年内";
  sortBy: "浏览量" | "点赞量" | "评论量" | "收藏量";
  existingUrls: string[];
}

export interface ExtensionProgress {
  stage: "opening" | "searching" | "enriching" | "downloading";
  completed: number;
  total: number;
  message: string;
}

export interface ExtensionCollectResult {
  topics: Topic[];
  message: string;
  mediaCompleted: number;
  mediaFailed: number;
}

interface ExtensionTarget {
  origin?: string;
  location?: { origin?: string };
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  postMessage(message: unknown, targetOrigin: string): void;
}

interface MessageEnvelope<T = unknown> {
  channel: typeof XHS_EXTENSION_CHANNEL;
  protocolVersion: number;
  direction: "page-to-extension" | "extension-to-page";
  type: PageMessageType | ExtensionMessageType;
  requestId: string;
  payload: T;
}

interface PendingRequest {
  expectedTerminalType: "pong" | "result";
  reject: (reason: Error) => void;
  resolve: (value: any) => void;
  timer: ReturnType<typeof setTimeout>;
  onProgress?: (progress: ExtensionProgress) => void;
  mediaStore?: XhsTopicMediaStore;
  mediaQueue: Promise<void>;
  requestTimeout: number;
}

export interface XhsExtensionClient {
  detect(): Promise<{ version: string; protocolVersion: number }>;
  collect(task: XhsCollectTask, onProgress?: (progress: ExtensionProgress) => void): Promise<ExtensionCollectResult>;
  cancel(requestId: string): Promise<void>;
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPongPayload(value: unknown): value is { version: string } {
  return isRecord(value) && typeof value.version === "string";
}

function isProgressPayload(value: unknown): value is ExtensionProgress {
  return isRecord(value) &&
    (value.stage === "opening" || value.stage === "searching" || value.stage === "enriching" || value.stage === "downloading") &&
    typeof value.completed === "number" && Number.isFinite(value.completed) &&
    typeof value.total === "number" && Number.isFinite(value.total) &&
    typeof value.message === "string";
}

function isResultPayload(value: unknown): value is ExtensionCollectResult {
  return isRecord(value) &&
    Array.isArray(value.topics) &&
    typeof value.message === "string" &&
    typeof value.mediaCompleted === "number" && Number.isFinite(value.mediaCompleted) && value.mediaCompleted >= 0 &&
    typeof value.mediaFailed === "number" && Number.isFinite(value.mediaFailed) && value.mediaFailed >= 0;
}

function isErrorPayload(value: unknown): value is { message: string; code?: string } {
  return isRecord(value) && typeof value.message === "string" && (value.code === undefined || typeof value.code === "string");
}

const ASSET_KEY_PATTERN = /^sha256-[0-9a-f]{32}$/;

function isMediaMessagePayload(type: string, value: unknown) {
  if (!isRecord(value) || typeof value.assetKey !== "string" || !ASSET_KEY_PATTERN.test(value.assetKey)) return false;
  if (type === "media:start") {
    return typeof value.topicKey === "string" && value.topicKey.length > 0 && value.topicKey.length <= 160 &&
      (value.mediaRole === "image" || value.mediaRole === "video" || value.mediaRole === "poster") &&
      typeof value.sourceUrl === "string" && value.sourceUrl.startsWith("https://");
  }
  if (type === "media:chunk") {
    return typeof value.chunkIndex === "number" && Number.isSafeInteger(value.chunkIndex) && value.chunkIndex >= 0 &&
      typeof value.data === "string" && value.data.length <= 262_144 &&
      typeof value.byteLength === "number" && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 && value.byteLength <= 196_608;
  }
  if (type === "media:complete") {
    return typeof value.mimeType === "string" && /^(?:image|video)\//.test(value.mimeType) &&
      typeof value.byteLength === "number" && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 &&
      typeof value.chunkCount === "number" && Number.isSafeInteger(value.chunkCount) && value.chunkCount >= 0;
  }
  return type === "media:error" && typeof value.code === "string" && typeof value.message === "string";
}

export function createXhsExtensionClient(
  target: ExtensionTarget = getDefaultTarget(),
  timeoutMs?: number,
  mediaStore?: XhsTopicMediaStore
): XhsExtensionClient {
  const origin = target.location?.origin ?? target.origin;
  if (!origin) throw new Error("The XHS extension client requires a page origin.");

  const pending = new Map<string, PendingRequest>();
  let disposed = false;
  const sendEnvelope = (type: PageMessageType, requestId: string, payload: unknown, protocolVersion: number) => {
    target.postMessage({
      channel: XHS_EXTENSION_CHANNEL,
      protocolVersion,
      direction: "page-to-extension",
      type,
      requestId,
      payload
    } satisfies MessageEnvelope, origin);
  };
  const send = (type: PageMessageType, requestId: string, payload: unknown) =>
    sendEnvelope(type, requestId, payload, XHS_EXTENSION_PROTOCOL_VERSION);

  const rejectPending = (requestId: string, error: Error) => {
    const request = pending.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(requestId);
    request.reject(error);
  };

  const refreshPendingTimer = (requestId: string) => {
    const request = pending.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    request.timer = setTimeout(
      () => rejectPending(requestId, new Error(`XHS extension request timed out after ${request.requestTimeout}ms.`)),
      request.requestTimeout
    );
  };

  const queueMediaMessage = (request: PendingRequest, message: Partial<MessageEnvelope>) => {
    if (!request.mediaStore || typeof message.type !== "string" || !isMediaMessagePayload(message.type, message.payload)) return false;
    const store = request.mediaStore;
    const payload = message.payload as Record<string, any>;
    request.mediaQueue = request.mediaQueue.then(async () => {
      try {
        if (message.type === "media:start") {
          const status = await store.prepare(payload as unknown as MediaStart);
          send(status === "skip" ? "media:skip" : "media:ready", message.requestId!, { assetKey: payload.assetKey });
        } else if (message.type === "media:chunk") {
          await store.writeChunk(payload as unknown as MediaChunk);
          send("media:ack", message.requestId!, { assetKey: payload.assetKey, chunkIndex: payload.chunkIndex });
        } else if (message.type === "media:complete") {
          await store.complete(payload as unknown as MediaComplete);
          send("media:ack", message.requestId!, { assetKey: payload.assetKey, chunkIndex: payload.chunkCount });
        } else if (message.type === "media:error") {
          await store.abort(payload.assetKey);
        }
      } catch (error) {
        await store.abort(payload.assetKey).catch(() => undefined);
        const quota = error instanceof DOMException && error.name === "QuotaExceededError";
        send("media:abort", message.requestId!, {
          assetKey: payload.assetKey,
          code: quota ? "QUOTA_EXCEEDED" : "MEDIA_STORE_FAILED",
          message: quota ? "本机存储空间不足" : "媒体保存失败"
        });
      }
    });
    return true;
  };

  const listener: EventListener = (event) => {
    const messageEvent = event as MessageEvent;
    if (messageEvent.origin !== origin || messageEvent.source !== target) return;
    const message = messageEvent.data as Partial<MessageEnvelope> | null;
    if (
      !message ||
      message.channel !== XHS_EXTENSION_CHANNEL ||
      message.direction !== "extension-to-page" ||
      typeof message.requestId !== "string"
    ) return;

    if (!pending.has(message.requestId)) return;
    if (message.protocolVersion !== XHS_EXTENSION_PROTOCOL_VERSION) {
      rejectPending(message.requestId, new Error("Incompatible XHS extension protocol. Please upgrade the extension."));
      return;
    }

    const request = pending.get(message.requestId)!;
    if (message.type === "progress") {
      if (request.expectedTerminalType !== "result") return;
      if (!isProgressPayload(message.payload)) {
        rejectPending(message.requestId, new Error("扩展响应格式异常。"));
        return;
      }
      refreshPendingTimer(message.requestId);
      request.onProgress?.(message.payload);
      return;
    }
    if (["media:start", "media:chunk", "media:complete", "media:error"].includes(String(message.type))) {
      if (typeof message.type !== "string" || !isMediaMessagePayload(message.type, message.payload)) {
        rejectPending(message.requestId, new Error("扩展媒体响应格式异常。"));
        return;
      }
      refreshPendingTimer(message.requestId);
      if (!queueMediaMessage(request, message)) {
        rejectPending(message.requestId, new Error("扩展媒体响应格式异常。"));
      }
      return;
    }
    if (message.type === "error") {
      if (!isErrorPayload(message.payload)) {
        rejectPending(message.requestId, new Error("扩展响应格式异常。"));
        return;
      }
      const error = new Error(message.payload.message) as Error & { code?: string };
      error.code = message.payload.code;
      rejectPending(message.requestId, error);
      return;
    }
    if (message.type === "result" && request.expectedTerminalType === "result") {
      if (!isResultPayload(message.payload)) {
        rejectPending(message.requestId, new Error("扩展响应格式异常。"));
        return;
      }
      void request.mediaQueue.then(() => {
        if (!pending.has(message.requestId!)) return;
        clearTimeout(request.timer);
        pending.delete(message.requestId!);
        request.resolve(message.payload);
      });
      return;
    }
    if (message.type === request.expectedTerminalType) {
      const validPayload = message.type === "pong" && isPongPayload(message.payload);
      if (!validPayload) {
        rejectPending(message.requestId, new Error("扩展响应格式异常。"));
        return;
      }
      clearTimeout(request.timer);
      pending.delete(message.requestId);
      request.resolve(message.payload);
    }
  };

  target.addEventListener("message", listener);

  const startRequest = <T>(requestId: string, type: "ping" | "collect", payload: unknown, requestTimeout: number, expectedTerminalType: "pong" | "result", onProgress?: (progress: ExtensionProgress) => void) => {
    if (pending.has(requestId)) return Promise.reject(new Error(`A request with id ${requestId} is already pending.`)) as Promise<T>;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => rejectPending(requestId, new Error(`XHS extension request timed out after ${requestTimeout}ms.`)), requestTimeout);
      pending.set(requestId, {
        expectedTerminalType,
        resolve,
        reject,
        timer,
        onProgress,
        mediaStore,
        mediaQueue: Promise.resolve(),
        requestTimeout
      });
      send(type, requestId, payload);
    });
  };

  return {
    detect() {
      if (disposed) return Promise.reject(new Error("The XHS extension client was disposed."));
      const requestId = crypto.randomUUID();
      const detection = startRequest<{ version: string }>(requestId, "ping", {}, timeoutMs ?? DEFAULT_PING_TIMEOUT_MS, "pong");
      setTimeout(() => {
        if (pending.has(requestId)) sendEnvelope("ping", requestId, {}, 1);
      }, LEGACY_PING_DELAY_MS);
      return detection.then((payload) => ({ version: payload.version, protocolVersion: XHS_EXTENSION_PROTOCOL_VERSION }));
    },
    collect(task, onProgress) {
      if (disposed) return Promise.reject(new Error("The XHS extension client was disposed."));
      return startRequest<ExtensionCollectResult>(task.requestId, "collect", task, DEFAULT_COLLECT_TIMEOUT_MS, "result", onProgress);
    },
    cancel(requestId) {
      if (disposed) return Promise.reject(new Error("The XHS extension client was disposed."));
      const request = pending.get(requestId);
      send("cancel", requestId, {});
      if (request?.expectedTerminalType === "result") {
        rejectPending(requestId, new Error("XHS extension collection was canceled."));
      }
      if (!request?.mediaStore) return Promise.resolve();
      return request.mediaQueue
        .then(() => request.mediaStore!.cleanupIncomplete())
        .then(() => undefined);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target.removeEventListener("message", listener);
      for (const [requestId, request] of pending) {
        if (request.mediaStore) void request.mediaQueue.then(() => request.mediaStore!.cleanupIncomplete());
        rejectPending(requestId, new Error("The XHS extension client was disposed."));
      }
    }
  };
}

function getDefaultTarget(): ExtensionTarget {
  if (typeof window === "undefined") throw new Error("The XHS extension client can only run in a browser.");
  return window;
}
