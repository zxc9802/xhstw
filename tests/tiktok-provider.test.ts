import assert from "node:assert/strict";
import test from "node:test";
import { collectTikTokVideos, getTikTokCapabilities } from "../lib/tiktok/provider";

const id = "7550000000000000001";
const item = { aweme_id: id, desc: "caption", create_time: 1791604800, author: { unique_id: "example" }, statistics: { play_count: 60000 }, video: { duration: 15000 } };
const reply = (data: unknown, code = 200) => new Response(JSON.stringify({ code, data }), { status: 200 });
const request = { keyword: "Malaysia", days: 7, limit: 2 };

test("missing credentials blocks collection and never returns mock records", async () => {
  const previous = process.env.TIKHUB_API_KEY;
  delete process.env.TIKHUB_API_KEY;
  try {
    assert.equal(getTikTokCapabilities().collection, false);
    await assert.rejects(collectTikTokVideos(request), /TIKHUB_API_KEY/);
  } finally { if (previous !== undefined) process.env.TIKHUB_API_KEY = previous; }
});

test("search verifies account country and missing followers through bound user endpoints", async () => {
  const urls: URL[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key");
    if (url.pathname.endsWith("fetch_general_search_result")) return reply({ data: [{ aweme_info: item }], has_more: 0, cursor: 1 });
    if (url.pathname.endsWith("handler_user_profile")) return reply({ user: { unique_id: "example", follower_count: 20000 } });
    if (url.pathname.endsWith("fetch_user_country_by_username")) return reply({ username: "example", country: "MY" });
    throw new Error(`unexpected ${url.pathname}`);
  }) as typeof fetch;
  const result = await collectTikTokVideos(request, { apiKey: "test-key", fetcher });
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].country, "MY");
  assert.equal(result.videos[0].followers, 20000);
  assert.equal(result.videos[0].source, "TikHub App V3");
  assert.equal(urls[0].searchParams.get("publish_time"), "7");
  assert.equal(urls[0].searchParams.has("region"), false);
  assert.equal(result.hasMore, false);
});

test("upstream HTTP 200 with business failure is an error", async () => {
  await assert.rejects(collectTikTokVideos(request, { apiKey: "test-key", fetcher: (async () => reply({}, 401)) as typeof fetch }), /业务/);
});

test("HTTP 200 search with hit_shark is unavailable rather than a successful zero", async () => {
  const fetcher = (async () => reply({ status_code: 0, data: [], has_more: false, search_nil_info: { search_nil_item: "hit_shark" } })) as typeof fetch;
  await assert.rejects(collectTikTokVideos(request, { apiKey: "test-key", fetcher }), (error: unknown) => {
    assert.equal((error as { status: number }).status, 502);
    assert.match((error as Error).message, /hit_shark/);
    return true;
  });
});

test("an ordinary empty search remains a valid empty result", async () => {
  const fetcher = (async () => reply({ status_code: 0, data: [], has_more: false })) as typeof fetch;
  const result = await collectTikTokVideos(request, { apiKey: "test-key", fetcher });
  assert.equal(result.scanned, 0);
  assert.equal(result.videos.length, 0);
  assert.equal(result.hasMore, false);
});

test("a blocked later page keeps prior candidates and reports incomplete collection", async () => {
  let searchCalls = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("fetch_general_search_result")) {
      searchCalls++;
      return reply(searchCalls === 1 ? { data: [{ aweme_info: item }], has_more: true, cursor: 10 }
        : { status_code: 0, data: [], has_more: false, search_nil_info: { search_nil_item: "hit_shark" } });
    }
    if (path.endsWith("fetch_one_video_v3")) return reply({ aweme_detail: item });
    if (path.endsWith("handler_user_profile")) return reply({ user: { unique_id: "example", follower_count: 20000 } });
    if (path.endsWith("fetch_user_country_by_username")) return reply({ username: "example", country: "MY" });
    return reply({ itemInfo: { itemStruct: { id, author: { uniqueId: "example" } } } });
  }) as typeof fetch;
  const result = await collectTikTokVideos(request, { apiKey: "test-key", fetcher });
  assert.equal(result.videos.length, 1);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, 10);
  assert.match(result.warnings.join(" "), /hit_shark/);
});

test("wrong creator identity leaves country and followers unverified", async () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("fetch_general_search_result")) return reply({ data: [{ aweme_info: item }], has_more: false });
    if (path.endsWith("handler_user_profile")) return reply({ user: { unique_id: "wrong", follower_count: 20000 } });
    return reply({ username: "wrong", country: "MY" });
  }) as typeof fetch;
  const result = await collectTikTokVideos(request, { apiKey: "test-key", fetcher });
  assert.equal(result.videos[0].country, null);
  assert.equal(result.videos[0].followers, null);
  assert.ok(result.warnings.some((warning) => warning.includes("不一致")));
});

test("video detail ID mismatch is rejected without salvaging unrelated metadata", async () => {
  const result = await collectTikTokVideos({ urls: [`https://www.tiktok.com/@example/video/${id}`] }, {
    apiKey: "test-key", fetcher: (async () => reply({ aweme_detail: { ...item, aweme_id: "7550000000000000002" } })) as typeof fetch
  });
  assert.equal(result.videos.length, 0);
  assert.match(result.warnings.join(" "), /不一致/);
});

test("repeated search cursors stop honestly and keep unique records", async () => {
  let searchCalls = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("fetch_general_search_result")) { searchCalls++; return reply({ data: [{ aweme_info: item }], has_more: 1, cursor: 10 }); }
    if (path.endsWith("handler_user_profile")) return reply({ user: { unique_id: "example", follower_count: 20000 } });
    return reply({ username: "example", country: "MY" });
  }) as typeof fetch;
  const result = await collectTikTokVideos({ ...request, limit: 20 }, { apiKey: "test-key", fetcher });
  assert.equal(searchCalls, 2);
  assert.equal(result.videos.length, 1);
  assert.match(result.warnings.join(" "), /重复/);
});

test("invalid inputs and non-TikTok links fail before a paid request", async () => {
  let called = false;
  const options = { apiKey: "test-key", fetcher: (async () => { called = true; return reply({}); }) as typeof fetch };
  for (const input of [{}, { keyword: "x", limit: 500 }, { urls: ["https://evil.example/video/123"] }, { keyword: "x", offset: -1 }, { keyword: "x", country: "ZZ" }, { keyword: "x", country: "Malaysia" }, { keyword: "x", country: [] }]) {
    await assert.rejects(collectTikTokVideos(input, options));
  }
  assert.equal(called, false);
});

test("selected country controls detail requests but never overwrites the verified creator country", async () => {
  for (const country of ["us", "", undefined]) {
    const regions: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("fetch_one_video_v3")) { regions.push(url.searchParams.get("region")!); return reply({ aweme_detail: item }); }
      if (url.pathname.endsWith("fetch_post_detail_v2")) { regions.push(url.searchParams.get("region")!); return reply({ itemInfo: { itemStruct: { id, author: { uniqueId: "example" }, diversificationLabels: [] } } }); }
      if (url.pathname.endsWith("handler_user_profile")) return reply({ user: { unique_id: "example", follower_count: 1234 } });
      if (url.pathname.endsWith("fetch_user_country_by_username")) return reply({ username: "example", country: "CA" });
      throw new Error("unexpected endpoint");
    }) as typeof fetch;
    const result = await collectTikTokVideos({ urls: [`https://www.tiktok.com/@example/video/${id}`], country }, { apiKey: "test-key", fetcher });
    assert.deepEqual(regions, [country === "us" ? "US" : "MY", country === "us" ? "US" : "MY"]);
    assert.equal(result.country, country === undefined ? "MY" : country.toUpperCase());
    assert.equal(result.videos[0].country, "CA");
  }
});

test("missing pagination state is not presented as search exhaustion", async () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("fetch_general_search_result")) return reply({ data: [] });
    throw new Error("unexpected enrichment");
  }) as typeof fetch;
  const result = await collectTikTokVideos(request, { apiKey: "test-key", fetcher });
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, null);
  assert.match(result.warnings.join(" "), /分页状态/);
});

test("MY video details and bound Web content labels enrich link records without exposing cookies", async () => {
  const requested: URL[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); requested.push(url);
    if (url.pathname.endsWith("fetch_one_video_v3")) {
      assert.equal(url.searchParams.get("region"), "MY");
      return reply({ aweme_detail: { ...item, author: { unique_id: "example", sec_uid: "bound-author", follower_count: 0 } } });
    }
    if (url.pathname.endsWith("handler_user_profile")) return reply({ user: { unique_id: "example", sec_uid: "bound-author", follower_count: 1234 } });
    if (url.pathname.endsWith("fetch_user_country_by_username")) return reply({ username: "example", sec_user_id: "bound-author", country: "MY" });
    if (url.pathname.endsWith("fetch_post_detail_v2")) {
      assert.equal(url.searchParams.get("region"), "MY");
      return reply({ cookie: "private-cookie", tt_chain_token: "private-token", statusCode: 0, itemInfo: { itemStruct: { id, author: { uniqueId: "example", secUid: "bound-author" }, diversificationLabels: ["Food & Drink", "Lifestyle"] } } });
    }
    throw new Error("unexpected endpoint");
  }) as typeof fetch;
  const result = await collectTikTokVideos({ urls: [`https://www.tiktok.com/@example/video/${id}`] }, { apiKey: "test-key", fetcher });
  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0].country, "MY");
  assert.equal(result.videos[0].followers, 1234);
  assert.equal(result.videos[0].category, "Food & Drink");
  assert.ok(result.videos[0].publishedAt);
  assert.doesNotMatch(JSON.stringify(result), /private-cookie|private-token/);
  assert.equal(requested.length, 4);
});

test("sec UID mismatches and embedded zero followers remain unknown", async () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("fetch_general_search_result")) return reply({ data: [{ aweme_info: { ...item, author: { unique_id: "example", sec_uid: "correct", follower_count: 0 } } }], has_more: false });
    if (path.endsWith("fetch_one_video_v3")) return reply({ aweme_detail: { ...item, author: { unique_id: "example", sec_uid: "correct", follower_count: 0 } } });
    if (path.endsWith("handler_user_profile")) return reply({ user: { unique_id: "example", sec_uid: "wrong", follower_count: 1234 } });
    if (path.endsWith("fetch_user_country_by_username")) return reply({ username: "example", sec_user_id: "wrong", country: "MY" });
    return reply({ itemInfo: { itemStruct: { id: "7550000000000000002", author: { uniqueId: "example" }, diversificationLabels: ["Unrelated"] } } });
  }) as typeof fetch;
  const result = await collectTikTokVideos({ ...request, limit: 1 }, { apiKey: "test-key", fetcher });
  assert.equal(result.videos[0].country, null);
  assert.equal(result.videos[0].followers, null);
  assert.equal(result.videos[0].category, null);
  assert.ok(result.warnings.some(warning => warning.includes("不一致")));
});

test("a search candidate proven to be a photo by its detail is skipped", async () => {
  let userRequests = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("fetch_general_search_result")) return reply({ data: [{ aweme_info: item }], has_more: false });
    if (path.endsWith("fetch_one_video_v3")) return reply({ aweme_detail: { ...item, aweme_type: 150, image_post_info: {} } });
    userRequests++;
    return reply({});
  }) as typeof fetch;
  const result = await collectTikTokVideos({ ...request, limit: 1 }, { apiKey: "test-key", fetcher });
  assert.equal(result.videos.length, 0);
  assert.equal(userRequests, 0);
  assert.match(result.warnings.join(" "), /图文作品已跳过/);
});
