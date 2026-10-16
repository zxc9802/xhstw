import assert from "node:assert/strict";
import test from "node:test";
import { collectTikTokVideos, getTikTokCapabilities } from "../lib/tiktok/provider";
import { createCollectionApi } from "../lib/tiktok/collection-api";

const id = "7550000000000000001";
const item = { aweme_id: id, desc: "caption", create_time: 1791604800, author: { unique_id: "example", sec_uid: "bound-sec" }, statistics: { play_count: 60000 }, video: { duration: 15000 } };
const request = { keyword: "sunscreen", country: "MY", days: 7, limit: 1 };
const response = (data: unknown) => Response.json({ success: true, ...data as object });
const fallback = (data: unknown) => Response.json({ code: 200, data });
function mockData(url: URL) {
  if (url.hostname === "api.scrapecreators.com") {
    if (url.pathname.endsWith("search/keyword")) return response({ search_item_list: [{ aweme_info: item }], has_more: 0, cursor: null });
    if (url.pathname.endsWith("profile/region")) return response({ handle: "example", region: "ID" });
    if (url.pathname.endsWith("profile")) return response({ user: { uniqueId: "example", secUid: "bound-sec" }, stats: { followerCount: 1234 } });
    if (url.pathname.endsWith("video")) return response({ aweme_detail: item, privateCookie: "private-cookie", transcript: "ignored" });
  } else {
    if (url.pathname.endsWith("fetch_general_search_result")) return fallback({ data: [{ aweme_info: item }], has_more: false });
    if (url.pathname.endsWith("fetch_one_video_v3")) return fallback({ aweme_detail: item });
    if (url.pathname.endsWith("handler_user_profile")) return fallback({ user: { unique_id: "example", sec_uid: "bound-sec", follower_count: 5678 } });
    if (url.pathname.endsWith("fetch_user_country_by_username")) return fallback({ username: "example", country: "MY", sec_user_id: "bound-sec" });
    if (url.pathname.endsWith("fetch_post_detail_v2")) return fallback({ itemInfo: { itemStruct: { id, author: { uniqueId: "example", secUid: "bound-sec" }, diversificationLabels: ["Beauty"] } } });
  }
  throw new Error(`Unexpected endpoint ${url.pathname}`);
}
const options = (fetcher: typeof fetch, backup = "") => ({ scrapeCreatorsApiKey: "sc-test-key", apiKey: backup, fetcher });

test("ScrapeCreators is first for collection, detail, followers and independently verified account region", async () => {
  const urls: URL[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(new Headers(init?.headers).get("x-api-key"), "sc-test-key");
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return mockData(url);
  }) as typeof fetch;
  const result = await collectTikTokVideos(request, options(fetcher));
  assert.equal(result.provider, "scrapecreators");
  assert.equal(result.videos[0].source, "ScrapeCreators");
  assert.equal(result.videos[0].country, "ID");
  assert.equal(result.videos[0].followers, 1234);
  assert.equal(result.videos[0].views, 60000);
  assert.equal(urls[0].searchParams.get("date_posted"), "this-week");
  assert.equal(urls[0].searchParams.get("region"), "MY");
  assert.ok(urls.every(url => url.hostname === "api.scrapecreators.com"));
  assert.doesNotMatch(JSON.stringify(result), /sc-test-key|private-cookie|play_addr|ignored/);
});

test("ScrapeCreators errors switch to TikHub and disclose the fallback", async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.scrapecreators.com" && url.pathname.endsWith("search/keyword")) return new Response("rate limited", { status: 429 });
    if (url.hostname === "api.tikhub.io") {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer backup-key");
      assert.equal(new Headers(init?.headers).has("x-api-key"), false);
      if (url.pathname.endsWith("fetch_general_search_result")) assert.equal(url.searchParams.has("region"), false);
    }
    return mockData(url);
  }) as typeof fetch;
  const result = await collectTikTokVideos(request, options(fetcher, "backup-key"));
  assert.equal(result.provider, "tikhub");
  assert.equal(result.videos.length, 1);
  assert.match(result.warnings.join(" "), /429.*已切换 TikHub/);
});

test("provider cursors remain bound and switching providers restarts the backup cursor at zero", async () => {
  const offsets: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("search/keyword")) { assert.equal(url.searchParams.get("cursor"), "100"); throw new Error("offline"); }
    if (url.pathname.endsWith("fetch_general_search_result")) { offsets.push(url.searchParams.get("offset")!); return fallback({ data: [{ aweme_info: item }], has_more: 1, cursor: 10 }); }
    return mockData(url);
  }) as typeof fetch;
  const result = await collectTikTokVideos({ ...request, provider: "scrapecreators", offset: 100 }, options(fetcher, "backup-key"));
  assert.deepEqual(offsets, ["0"]);
  assert.equal(result.provider, "tikhub");
  assert.equal(result.nextOffset, 10);
  assert.equal(result.hasMore, true);
  assert.match(result.warnings.join(" "), /游标不通用/);
  const pinned = (async (input: RequestInfo | URL) => { const url = new URL(String(input)); assert.equal(url.hostname, "api.tikhub.io"); return fallback({ data: [], has_more: false }); }) as typeof fetch;
  await collectTikTokVideos({ ...request, provider: "tikhub", offset: 10 }, options(pinned, "backup-key"));
});

test("ordinary empty ScrapeCreators results do not invoke the paid backup", async () => {
  let calls = 0;
  const fetcher = (async (input: RequestInfo | URL) => { calls++; assert.equal(new URL(String(input)).hostname, "api.scrapecreators.com"); return response({ search_item_list: [], has_more: 0 }); }) as typeof fetch;
  const result = await collectTikTokVideos(request, options(fetcher, "backup-key"));
  assert.equal(calls, 1);
  assert.equal(result.scanned, 0);
  assert.equal(result.hasMore, false);
});

test("malformed successful responses and unbound region identities fall back without inventing facts", async () => {
  for (const bad of [{ success: false }, { success: true }, { success: true, search_item_list: [{ aweme_id: 7550000000000000001 }] }, { success: true, search_nil_info: { search_nil_item: "hit_shark" } }]) {
    const fetcher = (async (input: RequestInfo | URL) => { const url = new URL(String(input)); return url.hostname === "api.scrapecreators.com" ? Response.json(bad) : fallback({ data: [], has_more: false }); }) as typeof fetch;
    const result = await collectTikTokVideos(request, options(fetcher, "backup-key"));
    assert.equal(result.provider, "tikhub");
    assert.ok(result.warnings.some(warning => warning.includes("已切换")));
  }
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "api.scrapecreators.com" && url.pathname.endsWith("profile/region")) return response({ handle: "another-user", region: "MY" });
    return mockData(url);
  }) as typeof fetch;
  const result = await collectTikTokVideos(request, options(fetcher, "backup-key"));
  assert.equal(result.videos[0].country, "MY");
  assert.equal((result.videos[0].evidence.user as { country: { provider: string } }).country.provider, "tikhub");
  const onlyPrimary = await collectTikTokVideos(request, options(fetcher));
  assert.equal(onlyPrimary.videos[0].country, null);
});

test("video identity mismatch cannot supply original media and both failures never become empty success", async () => {
  const fetcher = (async () => response({ aweme_detail: { ...item, aweme_id: "7550000000000000002" } })) as typeof fetch;
  await assert.rejects(createCollectionApi(options(fetcher)).request("fetch_one_video_v3", { aweme_id: id, username: "example", region: "MY" }), /身份不一致/);
  const bothFailed = (async () => new Response("secret upstream details", { status: 503 })) as typeof fetch;
  await assert.rejects(collectTikTokVideos(request, options(bothFailed, "backup-key")), error => {
    assert.match((error as Error).message, /ScrapeCreators.*TikHub/);
    assert.doesNotMatch((error as Error).message, /secret upstream|sc-test-key|backup-key/);
    return true;
  });
});

test("invalid continuation source is rejected before any provider request", async () => {
  const fetcher = (async () => { throw new Error("must not request"); }) as typeof fetch;
  for (const input of [{ ...request, offset: 10 }, { ...request, provider: ["scrapecreators"] }, { ...request, provider: "other" }]) {
    await assert.rejects(collectTikTokVideos(input, options(fetcher)), /采集来源/);
  }
});

test("a ScrapeCreators-only configuration enables collection and media capabilities", () => {
  const previous = process.env.SCRAPECREATORS_API_KEY;
  process.env.SCRAPECREATORS_API_KEY = "test-key";
  try { assert.equal(getTikTokCapabilities().collection, true); }
  finally { if (previous === undefined) delete process.env.SCRAPECREATORS_API_KEY; else process.env.SCRAPECREATORS_API_KEY = previous; }
});
