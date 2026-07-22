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
  findDetailRoot(document: Document): Element | null;
  findSearchCardLink(document: Document, targetUrl: string): Element | null;
  parseSearchCards(document: Document, query: string, limit: number): Array<Record<string, unknown>>;
  parseDetail(document: Document | Element, expectedTitle: string): Record<string, unknown>;
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
    tags: ["防晒"],
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

test("unavailable detail pages are skippable and never become topics", () => {
  const detailRoot = collector.findDetailRoot(fixture("xhs-detail-unavailable.html"));

  assert.ok(detailRoot);
  assert.deepEqual(collector.parseDetail(detailRoot, "搜索卡片标题"), {
    ok: false,
    code: "NOTE_UNAVAILABLE",
    message: "当前笔记暂时无法浏览"
  });
});

test("detail parsing requires meaningful content inside a visible detail root", () => {
  const page = parseHTML(`
    <main>
      <h1 class="title">导航标题</h1>
      <img src="https://ci.xiaohongshu.com/navigation.webp" alt="导航图片">
    </main>
  `).document;

  assert.equal(collector.findDetailRoot(page), null);
  assert.deepEqual(collector.parseDetail(page, "搜索卡片标题"), {
    ok: false,
    code: "PAGE_STRUCTURE_CHANGED",
    message: "未检测到有效的小红书详情内容"
  });
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
    ["安全限制 访问频繁 300013", "RATE_LIMITED"],
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

test("screenshot-style rate-limit screens require visible marker co-occurrence", () => {
  const rateLimitScreen = parseHTML(`
    <main>
      <h1>安全限制</h1>
      <p>访问频繁，请稍后再试</p>
      <small>300013</small>
      <button>返回首页</button>
    </main>
  `).document;

  assert.deepEqual(collector.detectPageState(rateLimitScreen), {
    ok: false,
    code: "RATE_LIMITED",
    message: "小红书提示访问频繁，请稍后再试"
  });
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

test("computed stylesheet-hidden login markup does not block collection", () => {
  const classHiddenLogin = parseHTML("<section class=\"login-container css-hidden\"><input type=password></section><article>公开正文</article>").document;
  Object.defineProperty(classHiddenLogin, "defaultView", {
    configurable: true,
    value: {
      getComputedStyle(element: Element) {
        return { display: element.classList.contains("css-hidden") ? "none" : "block", visibility: "visible" };
      }
    }
  });

  assert.deepEqual(collector.detectPageState(classHiddenLogin), { ok: true });
});

test("search-card matching skips a hidden duplicate link before the visible cover", () => {
  const noteId = "69042cb60000000003020eea";
  const page = parseHTML(`
    <section class="note-item">
      <a href="/explore/${noteId}" style="display:none"></a>
      <a class="cover" href="/search_result/${noteId}?xsec_token=live">封面</a>
      <a class="title" href="/search_result/${noteId}?xsec_token=live">地铁可以穿防晒服</a>
    </section>
  `).document;

  assert.equal(collector.findSearchCardLink(page, `https://www.xiaohongshu.com/explore/${noteId}`)?.className, "cover");
});

test("detail media ignores comment and profile ancestor containers", () => {
  const detailDocument = parseHTML(`
    <div class="note-detail-mask" role="dialog">
      <img src="https://sns-webpic-qc.xhscdn.com/detail-1.webp" alt="正文图">
      <div class="comment"><img src="https://sns-webpic-qc.xhscdn.com/context-3.webp" alt="普通图片"></div>
      <div class="profile"><video src="https://sns-webpic-qc.xhscdn.com/context-4.mp4"></video></div>
    </div>
  `).document;
  const detail = collector.parseDetail(detailDocument, "通勤防晒实测");
  const urls = (detail.media as Array<{ url: string }>).map((item) => item.url);

  assert.deepEqual(urls, ["https://sns-webpic-qc.xhscdn.com/detail-1.webp"]);
});

test("detail parsing preserves every image in an eighteen-image Xiaohongshu post", () => {
  const detailDocument = parseHTML(`
    <div class="note-detail-mask" role="dialog">
      <h1 class="title">十八张图实测</h1>
      <article class="content">完整正文</article>
      ${Array.from({ length: 18 }, (_, index) => `<img src="https://sns-webpic-qc.xhscdn.com/detail-${index + 1}.webp" alt="正文图 ${index + 1}">`).join("")}
    </div>
  `).document;
  const detail = collector.parseDetail(detailDocument, "备用标题");
  const topic = collector.buildTopic({
    title: "十八张图实测",
    url: "https://www.xiaohongshu.com/explore/64f0a1b2c3d4e5f60718293a"
  }, detail, new Date("2026-07-22T00:00:00.000Z"));
  const envelope = {
    channel: protocol.CHANNEL,
    protocolVersion: protocol.PROTOCOL_VERSION,
    direction: "extension-to-page",
    type: "result",
    requestId: REQUEST_ID,
    payload: { topics: [JSON.parse(JSON.stringify(topic))], message: "完成" }
  };

  assert.equal((detail.media as Array<unknown>).length, 18);
  assert.equal((topic.media as Array<unknown>).length, 18);
  assert.equal(protocol.isEnvelope(envelope, "extension-to-page"), true);
});

test("detail tags are deduplicated and capped independently from topic output", () => {
  const detailDocument = parseHTML(`<div class="note-detail-mask" role="dialog"><article class="content">#防晒 #防晒 ${Array.from({ length: 11 }, (_, index) => `#标签${index + 1}`).join(" ")}</article></div>`).document;
  const detail = collector.parseDetail(detailDocument, "标签测试");

  assert.deepEqual(detail.tags, ["防晒", "标签1", "标签2", "标签3", "标签4", "标签5", "标签6", "标签7", "标签8", "标签9"]);
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

test("detail media supplies the cover before a search-card cover", () => {
  const topic = collector.buildTopic({
    title: "视频封面优先级",
    url: "https://www.xiaohongshu.com/explore/64f0a1b2c3d4e5f60718293a",
    coverUrl: "https://sns-webpic-qc.xhscdn.com/search-cover.webp"
  }, {
    title: "视频封面优先级",
    author: "测试作者",
    media: [{ type: "video", url: "https://sns-webpic-qc.xhscdn.com/detail-video.mp4" }]
  }, new Date("2026-07-22T00:00:00.000Z"));

  assert.equal(topic.coverUrl, "https://sns-webpic-qc.xhscdn.com/detail-video.mp4");
  assert.equal(topic.coverType, "video");
  assert.equal(topic.mediaType, "视频");
});

test("search collection never returns more than five rows", () => {
  const idPrefix = "64f0a1b2c3d4e5f607182";
  const searchDocument = parseHTML(Array.from({ length: 6 }, (_, index) => `
    <section class="note-item">
      <a href="/explore/${idPrefix}${index.toString(16).padStart(2, "0")}"><span class="title">第 ${index + 1} 条</span></a>
    </section>
  `).join("")).document;

  assert.equal(collector.parseSearchCards(searchDocument, "防晒", 99).length, 5);
});

test("oversized topic inputs serialize within the extension protocol bounds", () => {
  const oversized = "x".repeat(3_000);
  const topic = collector.buildTopic({
    title: oversized,
    url: `https://www.xiaohongshu.com/explore/64f0a1b2c3d4e5f60718293a?xsec_token=${oversized}`,
    coverUrl: `https://sns-webpic-qc.xhscdn.com/${oversized}.webp`,
    query: oversized
  }, {
    title: oversized,
    author: oversized,
    content: oversized,
    likes: oversized,
    comments: oversized,
    saves: oversized,
    media: Array.from({ length: 12 }, (_, index) => ({
      type: "image",
      url: `https://sns-webpic-qc.xhscdn.com/media-${index}.webp`,
      name: oversized,
      posterUrl: `https://sns-webpic-qc.xhscdn.com/${oversized}.webp`
    }))
  }, new Date("2026-07-22T00:00:00.000Z"));
  const wireTopic = JSON.parse(JSON.stringify(topic));
  const envelope = {
    channel: protocol.CHANNEL,
    protocolVersion: protocol.PROTOCOL_VERSION,
    direction: "extension-to-page",
    type: "result",
    requestId: REQUEST_ID,
    payload: { topics: [wireTopic], message: "完成" }
  };
  const media = topic.media as Array<Record<string, unknown>>;

  assert.equal(String(topic.title).length, 2048);
  assert.equal(String(topic.sourceAccount).length <= 2048, true);
  assert.equal(String(topic.keyword).length, 2048);
  assert.equal(String(topic.parsedContent).length, 2048);
  assert.equal(Object.hasOwn(topic, "url"), false);
  assert.equal(media.length, 12);
  assert.equal(String(media[0]?.name).length, 300);
  assert.equal(Object.hasOwn(media[0]!, "posterUrl"), false);
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
  const video = parseHTML("<div class=note-detail-mask role=dialog><h1 class=title>视频笔记</h1><video src=\"https://sns-webpic-qc.xhscdn.com/demo.mp4\"></video></div>").document;
  const detail = collector.parseDetail(video, "备用标题");
  const topic = collector.buildTopic({ title: "没有 ID 的标题", url: "not-a-url", query: "关键词" }, detail, new Date("2026-07-22T00:00:00.000Z"));

  assert.doesNotThrow(() => collector.parseSearchCards(empty, "关键词", 5));
  assert.doesNotThrow(() => collector.parseDetail(empty, "备用标题"));
  assert.deepEqual(collector.parseSearchCards(empty, "关键词", 5), []);
  assert.deepEqual(collector.parseDetail(empty, "备用标题"), {
    ok: false,
    code: "PAGE_STRUCTURE_CHANGED",
    message: "未检测到有效的小红书详情内容"
  });
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

test("detail actions click only the matching search card, parse its dialog, and close it", async () => {
  const page = fixture("xhs-search-click-detail.html");
  const target = page.querySelector('a[href*="6a59e17a000000001d00ca02"]') as HTMLAnchorElement;
  const other = page.querySelector('a[href*="6a5b67b2000000000f039c00"]') as HTMLAnchorElement;
  const dialog = page.querySelector(".note-detail-mask") as HTMLElement;
  const close = page.querySelector('[aria-label="关闭"]') as HTMLButtonElement;
  let targetClicks = 0;
  let otherClicks = 0;
  target.addEventListener("click", (event) => {
    event.preventDefault();
    targetClicks += 1;
    dialog.hidden = false;
  });
  other.addEventListener("click", (event) => {
    event.preventDefault();
    otherClicks += 1;
  });
  close.addEventListener("click", () => { dialog.hidden = true; });

  const actions = require("../browser-extension/xhs-content.js") as {
    handleMessage(message: unknown): Promise<Record<string, unknown>>;
  };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousCollector = Object.getOwnPropertyDescriptor(globalThis, "XhsPageCollector");
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  Object.defineProperty(globalThis, "XhsPageCollector", { configurable: true, value: collector });
  try {
    const response = await actions.handleMessage({
      action: "xhs:detail",
      expectedTitle: "目标笔记",
      targetUrl: "https://www.xiaohongshu.com/search_result/6a59e17a000000001d00ca02?xsec_token=first"
    });
    assert.equal(targetClicks, 1);
    assert.equal(otherClicks, 0);
    assert.equal(response.ok, true);
    assert.equal(response.title, "目标笔记");
    assert.equal(dialog.hidden, true);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete (globalThis as { document?: Document }).document;
    if (previousCollector) Object.defineProperty(globalThis, "XhsPageCollector", previousCollector);
    else delete (globalThis as { XhsPageCollector?: unknown }).XhsPageCollector;
  }
});

test("search actions ignore exact-label controls inside hidden ancestors", async () => {
  const page = parseHTML(`
    <div aria-hidden="true"><span id="hidden-filter">筛选</span></div>
    <div id="real-filter">筛选</div>
    <div aria-hidden="true"><span id="hidden-sort">最多点赞</span></div>
    <div id="real-sort">最多点赞</div>
    <div aria-hidden="true"><span id="hidden-media">图文</span></div>
    <div id="real-media">图文</div>
    <section class="note-item">
      <a href="/explore/64f0a1b2c3d4e5f60718293a"><span class="title">防晒实测</span></a>
    </section>
  `).document;
  const clicks = new Map<string, number>();
  for (const id of ["hidden-filter", "real-filter", "hidden-sort", "real-sort", "hidden-media", "real-media"]) {
    page.querySelector(`#${id}`)?.addEventListener("click", () => clicks.set(id, (clicks.get(id) || 0) + 1));
  }

  const actions = require("../browser-extension/xhs-content.js") as {
    handleMessage(message: unknown): Promise<Record<string, unknown>>;
  };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousCollector = Object.getOwnPropertyDescriptor(globalThis, "XhsPageCollector");
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  Object.defineProperty(globalThis, "XhsPageCollector", { configurable: true, value: collector });
  try {
    const response = await actions.handleMessage({
      action: "xhs:search",
      query: "防晒",
      limit: 1,
      mediaType: "图文",
      dateRange: "全部",
      sortBy: "点赞量"
    });

    assert.equal(response.ok, true);
    assert.equal(clicks.get("hidden-filter") || 0, 0);
    assert.equal(clicks.get("hidden-sort") || 0, 0);
    assert.equal(clicks.get("hidden-media") || 0, 0);
    assert.equal(clicks.get("real-filter"), 1);
    assert.equal(clicks.get("real-sort"), 1);
    assert.equal(clicks.get("real-media"), 1);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete (globalThis as { document?: Document }).document;
    if (previousCollector) Object.defineProperty(globalThis, "XhsPageCollector", previousCollector);
    else delete (globalThis as { XhsPageCollector?: unknown }).XhsPageCollector;
  }
});

test("xhs content actions accept only the two fixed commands", () => {
  const source = readFileSync(new URL("../browser-extension/xhs-content.js", import.meta.url), "utf8");
  const actions = require("../browser-extension/xhs-content.js") as {
    validateMessage(message: unknown):
      | { ok: true; action: "xhs:search" | "xhs:detail"; value: Record<string, unknown> }
      | { ok: false };
  };

  assert.equal(actions.validateMessage({
    action: "xhs:search",
    query: "防晒",
    limit: 5,
    mediaType: "图文",
    dateRange: "一周内",
    sortBy: "点赞量"
  }).ok, true);
  assert.equal(actions.validateMessage({
    action: "xhs:detail",
    expectedTitle: "通勤防晒实测",
    targetUrl: "https://www.xiaohongshu.com/search_result/64f0a1b2c3d4e5f60718293a?xsec_token=abc"
  }).ok, true);
  assert.equal(actions.validateMessage({ action: "xhs:detail", expectedTitle: "通勤防晒实测" }).ok, false);
  assert.equal(actions.validateMessage({
    action: "xhs:detail",
    expectedTitle: "通勤防晒实测",
    targetUrl: "https://example.test/search_result/64f0a1b2c3d4e5f60718293a"
  }).ok, false);
  assert.equal(actions.validateMessage({ action: "xhs:search", query: "防晒", limit: 6, mediaType: "全部", dateRange: "全部", sortBy: "浏览量" }).ok, false);
  assert.equal(actions.validateMessage({ action: "xhs:detail", expectedTitle: "标题", script: "alert(1)" }).ok, false);
  assert.equal(actions.validateMessage({ action: "xhs:execute", code: "alert(1)" }).ok, false);

  for (const forbidden of [/eval\s*\(/, /new\s+Function/, /document\.cookie/, /chrome\.cookies/, /fetch\s*\(/]) {
    assert.equal(forbidden.test(source), false);
  }
  assert.match(source, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(source, /SCROLL_LIMIT\s*=\s*6/);
  assert.match(source, /FILTER_WAIT_MS\s*=\s*1_600/);
  assert.match(source, /SCROLL_WAIT_MS\s*=\s*900/);
});
