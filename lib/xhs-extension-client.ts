import type { Topic } from "@/types/topic";

export const XHS_EXTENSION_CHANNEL = "content-production-studio.xhs-extension";
export const XHS_EXTENSION_PROTOCOL_VERSION = 1;

const DEFAULT_PING_TIMEOUT_MS = 2_000;
const DEFAULT_COLLECT_TIMEOUT_MS = 10 * 60 * 1_000;

type PageMessageType = "ping" | "collect" | "cancel";
type ExtensionMessageType = "pong" | "progress" | "result" | "error";

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
  stage: "opening" | "searching" | "enriching";
  completed: number;
  total: number;
  message: string;
}

export interface ExtensionCollectResult {
  topics: Topic[];
  message: string;
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
    (value.stage === "opening" || value.stage === "searching" || value.stage === "enriching") &&
    typeof value.completed === "number" && Number.isFinite(value.completed) &&
    typeof value.total === "number" && Number.isFinite(value.total) &&
    typeof value.message === "string";
}

function isResultPayload(value: unknown): value is ExtensionCollectResult {
  return isRecord(value) && Array.isArray(value.topics) && typeof value.message === "string";
}

function isErrorPayload(value: unknown): value is { message: string; code?: string } {
  return isRecord(value) && typeof value.message === "string" && (value.code === undefined || typeof value.code === "string");
}

export function createXhsExtensionClient(target: ExtensionTarget = getDefaultTarget(), timeoutMs?: number): XhsExtensionClient {
  const origin = target.location?.origin ?? target.origin;
  if (!origin) throw new Error("The XHS extension client requires a page origin.");

  const pending = new Map<string, PendingRequest>();
  let disposed = false;
  const send = (type: PageMessageType, requestId: string, payload: unknown) => {
    const message: MessageEnvelope = {
      channel: XHS_EXTENSION_CHANNEL,
      protocolVersion: XHS_EXTENSION_PROTOCOL_VERSION,
      direction: "page-to-extension",
      type,
      requestId,
      payload
    };
    target.postMessage(message, origin);
  };

  const rejectPending = (requestId: string, error: Error) => {
    const request = pending.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(requestId);
    request.reject(error);
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
      request.onProgress?.(message.payload);
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
    if (message.type === request.expectedTerminalType) {
      const validPayload = message.type === "pong" ? isPongPayload(message.payload) : isResultPayload(message.payload);
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
      pending.set(requestId, { expectedTerminalType, resolve, reject, timer, onProgress });
      send(type, requestId, payload);
    });
  };

  return {
    detect() {
      if (disposed) return Promise.reject(new Error("The XHS extension client was disposed."));
      const requestId = crypto.randomUUID();
      return startRequest<{ version: string }>(requestId, "ping", {}, timeoutMs ?? DEFAULT_PING_TIMEOUT_MS, "pong")
        .then((payload) => ({ version: payload.version, protocolVersion: XHS_EXTENSION_PROTOCOL_VERSION }));
    },
    collect(task, onProgress) {
      if (disposed) return Promise.reject(new Error("The XHS extension client was disposed."));
      return startRequest<ExtensionCollectResult>(task.requestId, "collect", task, DEFAULT_COLLECT_TIMEOUT_MS, "result", onProgress);
    },
    cancel(requestId) {
      if (disposed) return Promise.reject(new Error("The XHS extension client was disposed."));
      send("cancel", requestId, {});
      if (pending.get(requestId)?.expectedTerminalType === "result") {
        rejectPending(requestId, new Error("XHS extension collection was canceled."));
      }
      return Promise.resolve();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target.removeEventListener("message", listener);
      for (const requestId of pending.keys()) rejectPending(requestId, new Error("The XHS extension client was disposed."));
    }
  };
}

function getDefaultTarget(): ExtensionTarget {
  if (typeof window === "undefined") throw new Error("The XHS extension client can only run in a browser.");
  return window;
}
