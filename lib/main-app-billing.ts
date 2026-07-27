import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import {
  getMainAppSessionCookieName,
  getMainAppUrl,
  readMainAppSessionCookie,
} from "@/lib/main-app-sso";

export type MainAppTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export class MainAppBillingError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "MainAppBillingError";
  }
}

const billingUserStorage = new AsyncLocalStorage<string>();

export function runWithMainAppBillingUser<T>(userId: string, action: () => T): T {
  return billingUserStorage.run(userId, action);
}

function requiredValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new MainAppBillingError(`${name} is not configured.`, 503, "billing_config");
  return value;
}

export async function currentBillingUserId() {
  const contextualUserId = billingUserStorage.getStore();
  if (contextualUserId) return contextualUserId;
  if (process.env.NODE_TEST_CONTEXT) return "test-user";
  const cookieStore = await cookies();
  const session = await readMainAppSessionCookie(
    cookieStore.get(getMainAppSessionCookieName())?.value,
  );
  if (!session) throw new MainAppBillingError("主站登录状态已失效", 401, "sso_session");
  return session.user.id;
}

async function postBilling(body: Record<string, unknown>) {
  const response = await fetch(`${getMainAppUrl()}/api/sso/billing`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-qycm-sso-client-secret": requiredValue("MAIN_APP_SSO_CLIENT_SECRET"),
    },
    body: JSON.stringify({
      product: "xhstw",
      userId: await currentBillingUserId(),
      ...body,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as {
      error?: string;
      code?: string;
    };
    throw new MainAppBillingError(
      payload.error || `主站积分服务请求失败：${response.status}`,
      response.status,
      payload.code,
    );
  }
}

function noopHandle() {
  return {
    settleText: async (_usage: MainAppTokenUsage) => undefined,
    settleMedia: async () => undefined,
    release: async () => undefined,
  };
}

export async function reserveMainAppCredits(input: {
  operation: string;
  providerId: string;
  model: string;
  estimatedInputTokens?: number;
  maxOutputTokens?: number;
  media?: boolean;
}) {
  if (process.env.NODE_TEST_CONTEXT) return noopHandle();
  const requestId = randomUUID();
  const common = {
    requestId,
    operation: input.operation,
    providerId: input.providerId,
    model: input.model,
    ...(input.media ? {
      mediaProduct: "nanobanana2",
      billableUnits: 1,
    } : {}),
  };
  await postBilling({
    action: "reserve",
    ...common,
    ...(!input.media ? {
      estimatedInputTokens: input.estimatedInputTokens,
      maxOutputTokens: input.maxOutputTokens,
    } : {}),
  });
  let completed = false;
  return {
    async settleText(usage: MainAppTokenUsage) {
      if (completed) return;
      await postBilling({ action: "settle", ...common, usage });
      completed = true;
    },
    async settleMedia() {
      if (completed) return;
      await postBilling({ action: "settle", ...common });
      completed = true;
    },
    async release() {
      if (completed) return;
      await postBilling({ action: "release", ...common });
      completed = true;
    },
  };
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseOpenAiUsage(
  payload: unknown,
  fallback: { inputTokens: number; outputText: string },
): MainAppTokenUsage {
  const usage = record(record(payload).usage);
  const inputTokens = positiveInteger(usage.prompt_tokens ?? usage.input_tokens)
    || fallback.inputTokens;
  const cachedInputTokens = Math.min(
    inputTokens,
    positiveInteger(record(usage.prompt_tokens_details).cached_tokens),
  );
  const reasoningTokens = positiveInteger(
    record(usage.completion_tokens_details).reasoning_tokens,
  );
  const outputTokens = positiveInteger(usage.completion_tokens ?? usage.output_tokens)
    || Math.max(1, new TextEncoder().encode(fallback.outputText).length);
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: positiveInteger(usage.total_tokens) || inputTokens + outputTokens,
  };
}
