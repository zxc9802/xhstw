const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 5;
const MAX_STRING_PREVIEW = 64;
const SENSITIVE_KEY = /authorization|api[_-]?key|token|secret|password/i;
const IMAGE_PAYLOAD_KEY = /^(b64_json|base64|image_base64|image_data)$/i;

function endpointWithoutQuery(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split("?")[0];
  }
}

function summarize(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return { type: "data-url", length: value.length };
    if (value.length > MAX_STRING_PREVIEW) return { type: "string", length: value.length, preview: value.slice(0, MAX_STRING_PREVIEW) };
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarize(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      IMAGE_PAYLOAD_KEY.test(key) && typeof item === "string"
        ? { type: "image-data", length: item.length }
        : SENSITIVE_KEY.test(key)
          ? "[redacted]"
          : summarize(item, depth + 1)
    ]));
  }
  return value;
}

export function summarizeImageProviderResponse(response: unknown): unknown;
export function summarizeImageProviderResponse(response: unknown, endpoint: string): { endpoint: string; response: unknown };
export function summarizeImageProviderResponse(response: unknown, endpoint?: string) {
  const summary = summarize(response, 0);
  return endpoint ? { endpoint: endpointWithoutQuery(endpoint), response: summary } : summary;
}

export function logImageProviderResponse(input: { provider: string; operation: string; endpoint: string; status: number; response: unknown }) {
  if (process.env.IMAGE_RESPONSE_DEBUG !== "true") return;
  console.info("[image/provider-response]", JSON.stringify({
    provider: input.provider,
    operation: input.operation,
    status: input.status,
    ...summarizeImageProviderResponse(input.response, input.endpoint)
  }));
}
