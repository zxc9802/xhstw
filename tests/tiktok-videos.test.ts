import assert from "node:assert/strict";
import test from "node:test";
import { defaultFilters, evaluateVideo, importVideos, normalizeVideo, mergeVideos } from "../lib/tiktok/videos";

const now = new Date("2026-10-13T04:00:00Z");
const row = {
  id: "7550000000000000001", url: "https://www.tiktok.com/@example/video/7550000000000000001",
  author: "example", description: "Caption", followers: 20000, views: 60000,
  publishedAt: "2026-10-10T04:00:00Z", country: "MY", hasProductLink: false,
  capturedAt: now.toISOString(), source: "用户导入"
};
const video = (changes = {}) => normalizeVideo({ ...row, ...changes }, now.toISOString());

test("default ratio is at least three with no ceiling; strict mode remains available", () => {
  assert.equal(defaultFilters.minRatio, 3);
  assert.equal(defaultFilters.maxRatio, null);
  assert.equal(evaluateVideo(video(), defaultFilters, now).status, "matched");
  assert.equal(evaluateVideo(video({ views: 100000 }), defaultFilters, now).status, "matched");
  assert.equal(evaluateVideo(video({ views: 100001 }), defaultFilters, now).status, "matched");
  assert.equal(evaluateVideo(video({ views: 1000000 }), defaultFilters, now).status, "matched");
  assert.equal(evaluateVideo(video({ views: 100001 }), { ...defaultFilters, maxRatio: 5 }, now).status, "excluded");
  assert.equal(evaluateVideo(video({ views: 59999 }), defaultFilters, now).status, "excluded");
  assert.equal(evaluateVideo(video({ followers: 20001 }), defaultFilters, now).status, "excluded");
});

test("missing facts and zero followers never become matched", () => {
  for (const changes of [{ followers: null }, { views: null }, { publishedAt: null }, { followers: 0 }]) {
    assert.equal(evaluateVideo(video(changes), defaultFilters, now).status, "pending");
  }
  assert.equal(video({ followers: null }).followers, null);
  assert.equal(video({ views: "" }).views, null);
  assert.equal(evaluateVideo(video({ country: null, views: 1 }), defaultFilters, now).status, "excluded");
});

test("search region is independent of author nationality and unknown verification stays pending", () => {
  assert.equal(evaluateVideo(video({ country: "ID", searchRegion: "MY" }), defaultFilters, now).status, "matched");
  assert.equal(evaluateVideo(video({ country: null, searchRegion: "MY" }), defaultFilters, now).status, "matched");
  assert.equal(evaluateVideo(video({ searchRegion: "US" }), defaultFilters, now).status, "excluded");
  assert.equal(evaluateVideo(video({ searchRegion: "US" }), { ...defaultFilters, region: "US" }, now).status, "matched");
  assert.equal(evaluateVideo(video({ evidence: { verificationPending: true } }), defaultFilters, now).status, "pending");
});

test("uses posting time rather than capture time; future posts need verification", () => {
  assert.equal(evaluateVideo(video({ publishedAt: "2026-10-06T04:00:00Z" }), defaultFilters, now).status, "matched");
  assert.equal(evaluateVideo(video({ publishedAt: "2026-10-06T03:59:59Z" }), defaultFilters, now).status, "excluded");
  assert.equal(evaluateVideo(video({ publishedAt: "2026-10-14T04:00:00Z" }), defaultFilters, now).status, "pending");
  assert.equal(evaluateVideo(video({ country: "SG" }), defaultFilters, now).status, "matched");
});

test("cart state is ignored, including legacy filters; explicit content category is still checked", () => {
  const item = video({ hasProductLink: null });
  assert.equal(evaluateVideo(item, defaultFilters, now).status, "matched");
  const legacyFilters = { ...defaultFilters, commerce: "linked" };
  assert.equal(evaluateVideo(item, legacyFilters, now).status, "matched");
  assert.equal(evaluateVideo(video(), legacyFilters, now).status, "matched");
  assert.equal(evaluateVideo(item, { ...defaultFilters, category: "美妆" }, now).status, "pending");
});

test("exact text IDs are preserved; numeric IDs and mismatched URLs are rejected", () => {
  assert.equal(video().id, row.id);
  assert.throws(() => video({ id: 7550000000000000001 }), /字符串/);
  assert.throws(() => video({ url: "https://www.tiktok.com/@example/video/7550000000000000002" }), /不一致/);
  assert.throws(() => video({ url: "javascript:alert(1)" }), /TikTok/);
  assert.throws(() => video({ url: "https://www.tiktok.com/@example/photo/7550000000000000001" }), /视频/);
});

test("JSON and quoted CSV import preserve exact IDs, multiline text and missing values", () => {
  const json = importVideos(JSON.stringify([row, { ...row, id: "7550000000000000002", url: "https://www.tiktok.com/@example/video/7550000000000000002", country: null }]), "json", now.toISOString());
  assert.equal(json.videos.length, 2);
  assert.equal(json.videos[1].country, null);
  const csv = 'id,url,author,description,followers,views,publishedAt,country,hasProductLink\r\n7550000000000000001,https://www.tiktok.com/@example/video/7550000000000000001,example,"hello, ""world""\nnext",20000,60000,2026-10-10T04:00:00Z,MY,false\r\n';
  const imported = importVideos(csv, "csv", now.toISOString());
  assert.equal(imported.videos[0].description, 'hello, "world"\nnext');
  assert.equal(imported.videos[0].hasProductLink, false);
  assert.throws(() => importVideos('id,description\n"unclosed', "csv", now.toISOString()), /CSV/);
});

test("TikHub raw exports normalize metadata without inventing region or shop status", () => {
  const imported = importVideos(JSON.stringify({ code: 200, data: { data: [{ aweme_info: {
    aweme_id: row.id, desc: "Malaysia caption", create_time: 1791604800,
    statistics: { play_count: 60000 }, author: { unique_id: "example", follower_count: 20000 },
    video: { duration: 18000, play_addr: { url_list: ["https://video.example/play.mp4"] } }
  } }] } }), "json", now.toISOString());
  assert.equal(imported.videos[0].country, null);
  assert.equal(imported.videos[0].hasProductLink, null);
  assert.equal(imported.videos[0].duration, 18);
  assert.equal(imported.videos[0].transcript, "");
  assert.equal(evaluateVideo(imported.videos[0], defaultFilters, now).status, "matched");
});

test("invalid rows are reported and same-ID older captures cannot overwrite newer data", () => {
  const imported = importVideos(JSON.stringify([row, { ...row, id: 123 }, row]), "json", now.toISOString());
  assert.equal(imported.videos.length, 1);
  assert.equal(imported.errors.length, 1);
  assert.equal(imported.duplicates, 1);
  const older = video({ views: 100, capturedAt: "2026-10-12T04:00:00Z" });
  assert.equal(mergeVideos([video()], [older])[0].views, 60000);
});
