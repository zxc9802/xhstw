import assert from "node:assert/strict";
import test from "node:test";
import { collectTikTokVideos, validateCollectionInput } from "../lib/tiktok/provider";
import { buildSearchKeywords } from "../lib/tiktok/search-keywords";
import { defaultFilters, evaluateVideo } from "../lib/tiktok/videos";
import type { CollectionProgress } from "../lib/tiktok/batch-collection";

const input = { keyword: "防晒霜", target: 20, filters: defaultFilters };
const reply = (data: object) => Response.json({ code: 200, data: { status_code: 0, ...data } });
const delay = () => new Promise(resolve => setTimeout(resolve, 2));
function fixture() {
  const rows = new Map<string, Record<string, unknown>>(), profiles = new Map<string, number>();
  const calls: URL[] = []; let active = 0, peak = 0, index = 0;
  const fetcher = (async (url: RequestInfo | URL) => {
    const u = new URL(String(url)); calls.push(u); active++; peak = Math.max(peak, active); await delay(); active--;
    if (u.pathname.endsWith("fetch_video_search_result")) {
      const creator = index++, items = Array.from({ length: 3 }, (_, i) => {
        const row = { aweme_id: String(BigInt("7000000000000000000") + BigInt(creator * 3 + i)), desc: "sunscreen skincare review",
          author: { unique_id: `author${creator}`, sec_uid: `sec${creator}`, follower_count: 1000 }, statistics: { play_count: 60000 },
          create_time: Math.floor(Date.now() / 1000) - 3600, region: "ID" };
        rows.set(row.aweme_id, row); return { aweme_info: row };
      });
      return reply({ aweme_list: [], search_item_list: [...items, items[0]], has_more: 0 });
    }
    if (u.pathname.endsWith("handler_user_profile")) {
      const author = u.searchParams.get("unique_id")!; profiles.set(author, (profiles.get(author) ?? 0) + 1);
      return reply({ user: { unique_id: author, sec_uid: author.replace("author", "sec"), follower_count: 1000 } });
    }
    if (u.pathname.endsWith("fetch_one_video_v3")) return reply({ aweme_detail: rows.get(u.searchParams.get("aweme_id")!) });
    throw new Error("Unneeded country/category request");
  }) as typeof fetch;
  return { fetcher, profiles, calls, get peak() { return peak; } };
}
const options = (fetcher: typeof fetch) => ({ apiKey: "test-key", scrapeCreatorsApiKey: "", fetcher });

test("integrated collection reaches 20 or 50 using six slots, deduplication and bound profiles", async () => {
  for (const target of [20, 50]) {
    const api = fixture(), updates: CollectionProgress[] = [];
    const result = await collectTikTokVideos({ ...input, target, filters: { ...defaultFilters, region: "US" } }, { ...options(api.fetcher), onProgress: p => updates.push(p) });
    assert.ok("stats" in result);
    assert.equal(result.stats.matched, target); assert.equal(result.videos.length, target);
    assert.equal(api.peak, 6);
    assert.ok([...api.profiles.values()].every(n => n === 1));
    assert.equal(new Set(result.videos.map(v => v.id)).size, target);
    assert.ok(result.videos.every(v => v.country === null && v.searchRegion === "US" && evaluateVideo(v, { ...defaultFilters, region: "US" }).status === "matched"));
    assert.ok(api.calls.filter(u => u.pathname.endsWith("fetch_video_search_result")).every(u => u.searchParams.get("region") === "US" && u.searchParams.get("keyword")));
    assert.ok(updates.some(p => p.matched > 0 && p.matched < target));
    assert.ok(result.scanned > result.stats.unique); assert.equal(result.stats.stopReason, "target_reached");
  }
});

test("early filtering avoids enrichment for excess followers, low plays, old or photo posts", async () => {
  let paid = 0;
  const fetcher = (async (url: RequestInfo | URL) => {
    paid++; assert.match(String(url), /fetch_video_search_result/);
    const base = { desc: "sunscreen", create_time: Math.floor(Date.now() / 1000) - 3600, author: { unique_id: "example", follower_count: 1000 }, statistics: { play_count: 60000 } };
    return reply({ search_item_list: [
      { ...base, aweme_id: "1", author: { unique_id: "example", follower_count: 20001 } },
      { ...base, aweme_id: "2", statistics: { play_count: 49999 } },
      { ...base, aweme_id: "3", create_time: Math.floor(Date.now() / 1000) - 4 * 86400 },
      { ...base, aweme_id: "4", aweme_type: 150 },
      { ...base, aweme_id: "5", statistics: { play_count: 500000 } },
    ], has_more: 0 });
  }) as typeof fetch;
  const result = await collectTikTokVideos({ keyword: "test", target: 20, filters: { ...defaultFilters, days: 3, maxRatio: 5 } }, options(fetcher));
  assert.ok("stats" in result); assert.equal(result.stats.matched, 0); assert.equal(result.videos.length, 0);
  assert.equal(paid, buildSearchKeywords("test", "MY").length);
  assert.equal(result.stats.rejected, 5);
});

test("profile or detail identity mismatches cannot count toward the target", async () => {
  for (const endpoint of ["handler_user_profile", "fetch_one_video_v3"]) {
    const api = fixture();
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const response = await api.fetcher(url, init);
      if (!String(url).includes(endpoint)) return response;
      const body = await response.json();
      const row = endpoint === "handler_user_profile" ? body.data.user : body.data.aweme_detail.author;
      row.sec_uid = "wrong-identity";
      return Response.json(body);
    }) as typeof fetch;
    const result = await collectTikTokVideos({ ...input, keyword: "test" }, options(fetcher));
    assert.ok("stats" in result); assert.equal(result.stats.matched, 0);
    assert.ok(result.videos.length > 0 && result.videos.every(v => evaluateVideo(v, defaultFilters).status === "pending"));
    assert.match(result.warnings.join(" "), /身份不一致/);
  }
});

test("request budget stops new calls and previously collected IDs are not recounted", async () => {
  const api = fixture();
  const result = await collectTikTokVideos(input, { ...options(api.fetcher), maxRequests: 9 });
  assert.equal(api.calls.length, 9); assert.ok("stats" in result); assert.equal(result.stats.stopReason, "request_limit");
  const second = fixture();
  const ids = Array.from({ length: 18 }, (_, i) => String(BigInt("7000000000000000000") + BigInt(i)));
  const filtered = await collectTikTokVideos({ ...input, keyword: "test", excludeIds: ids }, options(second.fetcher));
  assert.equal(filtered.videos.length, 0); assert.equal(second.profiles.size, 0);
});

test("invalid thresholds and regions are rejected before any paid call", () => {
  for (const patch of [{ target: 100 }, { filters: { region: "ZZ" } }, { filters: { region: [] } }, { filters: { maxFollowers: null } }, { filters: { minViews: -1 } }, { filters: { minRatio: 0 } }, { filters: { maxRatio: 1 } }, { excludeIds: [123] }]) {
    assert.throws(() => validateCollectionInput({ ...input, ...patch }, options((async () => { throw new Error("Must not fetch"); }) as typeof fetch)));
  }
});

test("each keyword keeps its own fallback cursor and ordinary empty pages do not switch providers", async () => {
  const calls: URL[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input)); calls.push(u);
    if (u.hostname === "api.tikhub.io") return new Response("unavailable", { status: 502 });
    const cursor = u.searchParams.get("cursor");
    assert.ok(cursor === "0" || cursor === "10");
    return Response.json({ success: true, has_more: cursor === "0" ? 1 : 0, cursor: 10,
      search_item_list: cursor === "0" ? [{ aweme_info: { aweme_id: `${calls.length}`, desc: "caption", author: { unique_id: "a", follower_count: 999999 } } }] : [] });
  }) as typeof fetch;
  const result = await collectTikTokVideos({ ...input, keyword: "test" }, { ...options(fetcher), scrapeCreatorsApiKey: "backup" });
  assert.ok("stats" in result); assert.equal(result.stats.matched, 0);
  assert.equal(calls.filter(u => u.hostname === "api.tikhub.io").length, 6);
  assert.equal(calls.filter(u => u.hostname === "api.scrapecreators.com").length, 12);
  assert.ok(calls.filter(u => u.hostname === "api.scrapecreators.com").every(u => u.searchParams.get("region") === "MY"));
});
