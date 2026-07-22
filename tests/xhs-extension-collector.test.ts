import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);
const collector = require("../browser-extension/shared/collector.js") as {
  clean(value: unknown): string;
  detectPageState(document: Document): { ok: true } | { ok: false; code: string; message: string };
  noteId(value: unknown): string;
  normalizeNoteUrl(value: unknown): string;
  parseSearchCards(document: Document, query: string, limit: number): Array<Record<string, unknown>>;
  parseDetail(document: Document, expectedTitle: string): Record<string, unknown>;
  buildTopic(row: Record<string, unknown>, detail: Record<string, unknown>, now: Date): Record<string, unknown>;
};
const protocol = require("../browser-extension/shared/protocol.js") as {
  CHANNEL: string;
  PROTOCOL_VERSION: number;
  isEnvelope(message: unknown, direction: string): boolean;
};

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function fixture(name: string) {
  return parseHTML(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).document;
}

test("normalized local-browser topics preserve the protocol wire contract", () => {
  const searchRows = collector.parseSearchCards(fixture("xhs-search.html"), "防晒", 5);
  const detail = collector.parseDetail(fixture("xhs-detail.html"), String(searchRows[0]?.title));
  const topic = collector.buildTopic(searchRows[0]!, detail, new Date("2026-07-22T00:00:00.000Z"));
  const wireTopic = JSON.parse(JSON.stringify(topic));
  const envelope = {
    channel: protocol.CHANNEL,
    protocolVersion: protocol.PROTOCOL_VERSION,
    direction: "extension-to-page",
    type: "result",
    requestId: REQUEST_ID,
    payload: { topics: [wireTopic], message: "完成" }
  };

  assert.equal(collector.clean("  通勤\n 防晒  "), "通勤 防晒");
  assert.equal(searchRows.length, 2);
  assert.equal(Object.keys(searchRows).length, 2);
  assert.deepEqual(searchRows[0], {
    title: "通勤防晒实测",
    author: "测试作者",
    url: "https://www.xiaohongshu.com/explore/64f0a1b2c3d4e5f60718293a?xsec_token=token-one&xsec_source=pc_search",
    coverUrl: "https://sns-webpic-qc.xhscdn.com/example-1.webp",
    likes: "1.2万",
    publishedAt: "昨天",
    query: "防晒"
  });
  assert.deepEqual(detail, {
    ok: true,
    title: "通勤防晒实测",
    author: "测试作者",
    content: "这是一段公开笔记正文 #防晒",
    publishedAt: "2026-07-21",
    likes: "1.2万",
    comments: "88",
    saves: "456",
    media: [
      { type: "image", url: "https://sns-webpic-qc.xhscdn.com/detail-1.webp", name: "防晒测试图一" },
      { type: "image", url: "https://sns-webpic-qc.xhscdn.com/detail-2.webp", name: "防晒测试图二" }
    ]
  });
  assert.equal(topic.id, "local_xhs_64f0a1b2c3d4e5f60718293a");
  assert.equal(topic.platform, "小红书");
  assert.equal(topic.status, "pending");
  assert.equal(topic.risk, "低");
  assert.equal(topic.priority, "P2");
  assert.equal(topic.sourceAccount, "本机浏览器 · 测试作者");
  assert.equal(protocol.isEnvelope(envelope, "extension-to-page"), true);
});

test("security blocks are recognized before detail parsing", () => {
  const rateLimited = parseHTML("<main>错误 300013：访问频繁</main>").document;
  const captcha = parseHTML("<main>请完成验证码</main>").document;
  const login = parseHTML("<form class=\"login-container\"><input type=\"password\"></form>").document;
  const ordinaryText = parseHTML("<article class=\"content\">笔记里提到登录流程</article>").document;
  const captchaState = collector.detectPageState(captcha);
  const loginState = collector.detectPageState(login);

  assert.deepEqual(collector.detectPageState(rateLimited), { ok: false, code: "RATE_LIMITED", message: "小红书提示访问频繁，请稍后再试" });
  assert.equal(captchaState.ok, false);
  assert.equal(loginState.ok, false);
  if (!captchaState.ok) assert.equal(captchaState.code, "CAPTCHA");
  if (!loginState.ok) assert.equal(loginState.code, "LOGIN_REQUIRED");
  assert.deepEqual(collector.detectPageState(ordinaryText), { ok: true });
  assert.deepEqual(collector.parseDetail(rateLimited, "备用标题"), { ok: false, code: "RATE_LIMITED", message: "小红书提示访问频繁，请稍后再试" });
});

test("note identifiers and canonical URLs support public Xiaohongshu routes", () => {
  const id = "64f0a1b2c3d4e5f60718293a";

  for (const value of [`/explore/${id}`, `/discovery/item/${id}`, `/item/${id}`, `/search_result/${id}`, id]) {
    assert.equal(collector.noteId(value), id);
  }
  assert.equal(collector.normalizeNoteUrl(`/search_result/${id}?xsec_token=abc`), `https://www.xiaohongshu.com/explore/${id}?xsec_token=abc&xsec_source=pc_search`);
  assert.equal(collector.normalizeNoteUrl(`/explore/${id}?xsec_source=web&xsec_token=abc&other=discarded`), `https://www.xiaohongshu.com/explore/${id}?xsec_token=abc&xsec_source=web`);
  assert.equal(collector.normalizeNoteUrl("https://example.test/no-id"), "https://example.test/no-id");
});

test("collector tolerates malformed documents and omits absent optional wire fields", () => {
  const empty = parseHTML("<main></main>").document;
  const video = parseHTML("<h1 class=title>视频笔记</h1><video src=\"https://sns-webpic-qc.xhscdn.com/demo.mp4\"></video>").document;
  const detail = collector.parseDetail(video, "备用标题");
  const topic = collector.buildTopic({ title: "没有 ID 的标题", url: "not-a-url", query: "关键词" }, detail, new Date("2026-07-22T00:00:00.000Z"));

  assert.doesNotThrow(() => collector.parseSearchCards(empty, "关键词", 5));
  assert.doesNotThrow(() => collector.parseDetail(empty, "备用标题"));
  assert.deepEqual(collector.parseSearchCards(empty, "关键词", 5), []);
  assert.deepEqual(detail.media, [{ type: "video", url: "https://sns-webpic-qc.xhscdn.com/demo.mp4" }]);
  assert.equal(topic.id, "local_xhs_视频笔记");
  assert.equal(topic.likes, "-");
  assert.equal(topic.comments, "-");
  assert.equal(topic.saves, "-");
  assert.equal(topic.views, "-");
  assert.equal(Object.hasOwn(topic, "url"), false);
  assert.equal(Object.hasOwn((detail.media as Array<Record<string, unknown>>)[0]!, "name"), false);
  assert.equal(Object.hasOwn((detail.media as Array<Record<string, unknown>>)[0]!, "posterUrl"), false);
});
