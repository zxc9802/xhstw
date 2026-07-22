import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeExtensionTopics } from "../lib/xhs-extension-topics";
import type { Topic } from "../types/topic";

function topic(id: string, keyword: string, url: string, title = id): Topic {
  return {
    id,
    platform: "小红书",
    title,
    contentType: "图文",
    likes: "1",
    comments: "1",
    saves: "1",
    risk: "低",
    priority: "P2",
    status: "pending",
    sourceAccount: "本机浏览器 · 测试",
    fetchedAt: "2026-07-22T00:00:00.000Z",
    keyword,
    url
  };
}

test("merges extension topics without reviving rejected or duplicate URLs", () => {
  const refreshedUrl = "https://www.xiaohongshu.com/explore/64f0a1b2c3d4e5f60718293a?xsec_token=old";
  const otherUrl = "https://www.xiaohongshu.com/explore/74f0a1b2c3d4e5f60718293b";
  const rejectedUrl = "https://www.xiaohongshu.com/explore/84f0a1b2c3d4e5f60718293c";
  const current = [
    topic("old-active", "防晒", refreshedUrl, "旧的防晒结果"),
    topic("other", "通勤", otherUrl, "保留的其它关键词结果")
  ];
  const incoming = [
    topic("new-active", "防晒", refreshedUrl.replace("old", "new"), "刷新的防晒结果"),
    topic("duplicate-active", "防晒", refreshedUrl.replace("old", "another"), "同链接的后到结果"),
    topic("updated-other", "防晒", otherUrl, "同链接的新数据"),
    topic("rejected", "防晒", rejectedUrl, "不应恢复")
  ];

  const merged = mergeExtensionTopics(current, incoming, ["防晒"], [topic("blocked", "防晒", `${rejectedUrl}?xsec_token=blocked`)]);

  assert.deepEqual(merged.map((item) => item.url), [refreshedUrl.replace("old", "another"), otherUrl]);
  assert.equal(merged[0]?.title, "同链接的后到结果");
  assert.equal(merged[1]?.title, "同链接的新数据");
  assert.equal(merged.some((item) => item.id === "old-active"), false);
  assert.equal(merged.some((item) => item.id === "rejected"), false);
});

test("keeps unrelated keyword rows when no refreshed row shares their URL", () => {
  const unrelated = topic("other", "通勤", "https://www.xiaohongshu.com/explore/94f0a1b2c3d4e5f60718293d");
  const incoming = topic("new", "防晒", "https://www.xiaohongshu.com/explore/a4f0a1b2c3d4e5f60718293e");

  assert.deepEqual(mergeExtensionTopics([unrelated], [incoming], ["防晒"], []), [incoming, unrelated]);
});

test("topic page uses one local extension task and direct browser media URLs", () => {
  const source = readFileSync(new URL("../app/topics/page.tsx", import.meta.url), "utf8");

  assert.match(source, /createXhsExtensionClient\(\)/);
  assert.match(source, /extensionClientRef\.current\.collect\(task/);
  assert.match(source, /queries:\s*activeKeywords\.slice\(0,\s*2\)/);
  assert.match(source, /\.slice\(0,\s*2_000\)/);
  assert.match(source, /本机抓取已连接/);
  assert.match(source, /每次最多选择 2 个关键词/);
  assert.match(source, /每个关键词最多抓取 5 条/);
  assert.doesNotMatch(source, /fetch\(["']\/api\/topics\/opencli-xhs/);
  assert.doesNotMatch(source, /\/api\/topics\/media-proxy/);
});

test("extension detection replaces the temporary checking feedback", () => {
  const source = readFileSync(new URL("../app/topics/page.tsx", import.meta.url), "utf8");

  assert.match(source, /client\.detect\(\)\.then\(\(\) => \{[\s\S]*?setExtensionStatus\("ready"\);[\s\S]*?setFeedback\("本机抓取扩展已连接/);
  assert.match(source, /\.catch\(\(error: unknown\) => \{[\s\S]*?setExtensionStatus\([\s\S]*?setFeedback\("未检测到本机抓取扩展/);
});
