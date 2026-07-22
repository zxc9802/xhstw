import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);
const collector = require("../browser-extension/shared/collector.js") as {
  clean(value: unknown): string;
  detectPageState(document: unknown): { ok: true } | { ok: false; code: string; message: string };
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

test("security markers accept direct strings without blocking ordinary note prose", () => {
  const directMarkers = [
    ["300013", "RATE_LIMITED"],
    ["安全限制", "RATE_LIMITED"],
    ["访问频繁", "RATE_LIMITED"],
    ["验证码", "CAPTCHA"],
    ["请完成验证", "CAPTCHA"],
    ["滑块验证", "CAPTCHA"],
    ["登录后查看", "LOGIN_REQUIRED"],
    ["手机号登录", "LOGIN_REQUIRED"],
    ["扫码登录", "LOGIN_REQUIRED"]
  ] as const;
  const ordinaryNote = "这篇笔记讨论访问频繁、验证码和登录三个常见产品问题，并给出了处理建议。";

  for (const [marker, code] of directMarkers) {
    const state = collector.detectPageState(marker);
    assert.equal(state.ok, false);
    if (!state.ok) assert.equal(state.code, code);
  }
  assert.deepEqual(collector.detectPageState(ordinaryNote), { ok: true });
  assert.deepEqual(collector.detectPageState("这篇复盘引用了错误码 300013，说明它曾出现在旧版页面。"), { ok: true });
  assert.deepEqual(collector.detectPageState("小红书用户在评论里提到访问频繁，但这篇文章不是拦截页面。"), { ok: true });
  assert.deepEqual(collector.detectPageState("客服文档引用“请完成验证”这句提示，供运营核对话术。"), { ok: true });
});

test("hidden login markup does not block collection", () => {
  const hiddenLogin = parseHTML("<section hidden class=\"login-container\"><input type=password></section><article>公开正文</article>").document;
  const ariaHiddenLogin = parseHTML("<section aria-hidden=\"true\" class=\"login-container\"><input type=password></section><article>公开正文</article>").document;
  const styledHiddenLogin = parseHTML("<section style=\"display:none\" class=\"login-container\"><input type=password></section><article>公开正文</article>").document;
  const importantHiddenLogin = parseHTML("<section style=\"display:none !important\" class=\"login-container\"><input type=password></section><article>公开正文</article>").document;
  const importantInvisibleLogin = parseHTML("<section style=\"visibility:hidden !important\" class=\"login-container\"><input type=password></section><article>公开正文</article>").document;
  const hiddenRateLimit = parseHTML("<section hidden>300013</section>").document.querySelector("section");

  assert.deepEqual(collector.detectPageState(hiddenLogin), { ok: true });
  assert.deepEqual(collector.detectPageState(ariaHiddenLogin), { ok: true });
  assert.deepEqual(collector.detectPageState(styledHiddenLogin), { ok: true });
  assert.deepEqual(collector.detectPageState(importantHiddenLogin), { ok: true });
  assert.deepEqual(collector.detectPageState(importantInvisibleLogin), { ok: true });
  assert.deepEqual(collector.detectPageState(hiddenRateLimit), { ok: true });
});

test("detail media ignores comment and profile ancestor containers", () => {
  const detailDocument = parseHTML(`
    <main>
      <img src="https://sns-webpic-qc.xhscdn.com/detail-1.webp" alt="正文图">
      <div class="comment"><img src="https://sns-webpic-qc.xhscdn.com/context-3.webp" alt="普通图片"></div>
      <div class="profile"><video src="https://sns-webpic-qc.xhscdn.com/context-4.mp4"></video></div>
    </main>
  `).document;
  const detail = collector.parseDetail(detailDocument, "通勤防晒实测");
  const urls = (detail.media as Array<{ url: string }>).map((item) => item.url);

  assert.deepEqual(urls, ["https://sns-webpic-qc.xhscdn.com/detail-1.webp"]);
});

test("search covers become protocol-safe media when detail media is absent", () => {
  const topic = collector.buildTopic({
    title: "搜索封面回退",
    url: "https://www.xiaohongshu.com/explore/64f0a1b2c3d4e5f60718293a",
    coverUrl: "https://sns-webpic-qc.xhscdn.com/search-cover.webp",
    query: "防晒"
  }, { title: "搜索封面回退", author: "测试作者", media: [] }, new Date("2026-07-22T00:00:00.000Z"));
  const wireTopic = JSON.parse(JSON.stringify(topic));
  const envelope = {
    channel: protocol.CHANNEL,
    protocolVersion: protocol.PROTOCOL_VERSION,
    direction: "extension-to-page",
    type: "result",
    requestId: REQUEST_ID,
    payload: { topics: [wireTopic], message: "完成" }
  };

  assert.deepEqual(topic.media, [{ type: "image", url: "https://sns-webpic-qc.xhscdn.com/search-cover.webp", name: "搜索封面" }]);
  assert.equal(topic.coverUrl, "https://sns-webpic-qc.xhscdn.com/search-cover.webp");
  assert.equal(topic.coverType, "image");
  assert.equal(topic.mediaType, "图文");
  assert.equal(protocol.isEnvelope(envelope, "extension-to-page"), true);
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
