export const collectionTraceHeader = "x-tiktok-request-id";

export function collectionRequestId(headers: Headers) {
  const id = headers.get(collectionTraceHeader);
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : crypto.randomUUID();
}

type CollectionLogFields = {
  jobId?: string;
  method?: string; status?: number | null; elapsedMs?: number;
  attempt?: number; provider?: string; endpoint?: string; contentType?: string;
  reason?: string; errorType?: string; scanned?: number; retained?: number; warnings?: number;
  scrapeCreatorsConfigured?: boolean; tikHubConfigured?: boolean;
};

export function logCollectionRequest(requestId: string | undefined, stage: string, fields: CollectionLogFields = {}) {
  if (requestId) console.info(JSON.stringify({ scope: "tiktok.collect", time: new Date().toISOString(), requestId, stage, ...fields }));
}
