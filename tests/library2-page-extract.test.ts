import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);
const collector = require("../browser-extension/shared/collector.js");
const extract = require("../browser-extension/shared/page-extract.js") as {
  detectPlatform(href: string): string;
  douyinNoteId(href: string): string;
  extract(document: Document, href: string): {
    ok: boolean;
    reason?: string;
    kind?: string;
    platform?: string;
    title?: string;
    body?: string;
    imageUrls?: string[];
  };
};
const media = require("../browser-extension/shared/library2-media.js") as {
  isAllowedMediaUrl(value: string): boolean;
  sniffType(bytes: Uint8Array): string;
  downloadImage(value: string, fetchImpl: typeof fetch, timeoutMs?: number): Promise<unknown>;
};
const bar = readFileSync("browser-extension/library2-bar.js", "utf8");
const background = readFileSync("browser-extension/background.js", "utf8");
const bridge = readFileSync("browser-extension/app-bridge.js", "utf8");

function fixture(name: string) {
  return parseHTML(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).document;
}

test("extracts image posts from Xiaohongshu, Douyin, and TikTok photo pages", () => {
  globalThis.XhsPageCollector = collector;
  const xhs = extract.extract(fixture("xhs-detail.html"), "https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaa");
  assert.equal(xhs.ok, true);
  assert.equal(xhs.platform, "小红书");
  assert.equal(xhs.body?.includes("公开笔记正文"), true);
  assert.equal(xhs.imageUrls?.some((url) => url.includes("detail-1.webp")), true);

  const douyin = extract.extract(fixture("douyin-note.html"), "https://www.douyin.com/note/123");
  assert.equal(douyin.ok, true);
  assert.equal(douyin.platform, "抖音");
  assert.equal(douyin.title, "通勤穿搭图文");
  assert.equal(douyin.imageUrls?.length, 2);

  const douyinModal = extract.extract(fixture("douyin-modal.html"), "https://www.douyin.com/jingxuan?modal_id=7597329042169220398");
  assert.equal(douyinModal.ok, true);
  assert.equal(douyinModal.platform, "抖音");
  assert.equal(douyinModal.title, "军训防晒图文");
  assert.equal(douyinModal.imageUrls?.length, 2);

  const douyinUserModal = extract.extract(fixture("douyin-modal.html"), "https://www.douyin.com/user/abc?modal_id=7597329042169220398");
  assert.equal(douyinUserModal.ok, true);

  const douyinShare = extract.extract(fixture("douyin-note.html"), "https://www.iesdouyin.com/share/note/123");
  assert.equal(douyinShare.ok, true);
  assert.equal(douyinShare.platform, "抖音");

  const douyinOverlay = extract.extract(fixture("douyin-modal.html"), "https://www.douyin.com/recommend");
  assert.equal(douyinOverlay.ok, false);
  assert.equal(douyinOverlay.reason, "not-detail");

  const searchModal = extract.extract(
    fixture("douyin-search-modal.html"),
    "https://www.douyin.com/search/%E5%9B%BE%E6%96%87?modal_id=708593217596686499&type=general"
  );
  assert.equal(searchModal.ok, true);
  assert.equal(searchModal.platform, "抖音");
  assert.deepEqual(searchModal.imageUrls, [
    "https://p3-sign.douyinpic.com/json-1.jpeg",
    "https://p3-sign.douyinpic.com/json-2.jpeg"
  ]);
  assert.equal(searchModal.body?.includes("春有百花秋有月"), true);
  assert.equal(searchModal.imageUrls?.some((url) => url.includes("feed-")), false);

  const jingxuanSearchUrl = "https://www.douyin.com/jingxuan/search/%E5%9B%BE%E6%96%87?aid=303c396e-6397-4d19-b534-d2ed8234abfe&modal_id=7360323126909095219&type=general";
  assert.equal(extract.douyinNoteId(jingxuanSearchUrl), "7360323126909095219");
  assert.equal(extract.douyinNoteId("https://www.douyin.com/jingxuan/search/图文"), "");

  const jingxuanSearch = extract.extract(fixture("douyin-jingxuan-search-modal.html"), jingxuanSearchUrl);
  assert.equal(jingxuanSearch.ok, true);
  assert.equal(jingxuanSearch.platform, "抖音");
  assert.deepEqual(jingxuanSearch.imageUrls, [
    "https://p3-sign.douyinpic.com/sunset-1.jpeg",
    "https://p3-sign.douyinpic.com/sunset-2.jpeg"
  ]);
  assert.equal(jingxuanSearch.body?.includes("倘若遇到那个人"), true);
  assert.equal(jingxuanSearch.imageUrls?.some((url) => url.includes("feed-") || url.includes("json-feed") || url.includes("dom-sunset")), false);

  const jingxuanSearchDom = extract.extract(fixture("douyin-jingxuan-search-modal-dom.html"), jingxuanSearchUrl);
  assert.equal(jingxuanSearchDom.ok, true);
  assert.deepEqual(jingxuanSearchDom.imageUrls, [
    "https://p3-sign.douyinpic.com/dom-sunset-1.jpeg",
    "https://p3-sign.douyinpic.com/dom-sunset-2.jpeg"
  ]);
  assert.equal(jingxuanSearchDom.body?.includes("倘若遇到那个人"), true);

  const tiktok = extract.extract(fixture("tiktok-photo.html"), "https://www.tiktok.com/@user/photo/1");
  assert.equal(tiktok.ok, true);
  assert.equal(tiktok.platform, "TikTok");
  assert.equal(tiktok.imageUrls?.length, 2);

  const video = extract.extract(fixture("tiktok-photo.html"), "https://www.tiktok.com/@user/video/1");
  assert.equal(video.ok, false);
});

test("hides the upload bar on search, feed, and list pages until a note is opened", () => {
  globalThis.XhsPageCollector = collector;
  const search = extract.extract(fixture("xhs-search.html"), "https://www.xiaohongshu.com/search_result?keyword=%E9%98%B2%E6%99%92");
  assert.equal(search.ok, false);
  assert.equal(search.reason, "not-detail");

  const explore = extract.extract(fixture("xhs-search.html"), "https://www.xiaohongshu.com/explore");
  assert.equal(explore.ok, false);

  const closedOverlay = extract.extract(fixture("xhs-search-click-detail.html"), "https://www.xiaohongshu.com/search_result?keyword=%E9%98%B2%E6%99%92");
  assert.equal(closedOverlay.ok, false);

  const openOverlay = fixture("xhs-search-click-detail.html");
  openOverlay.querySelector(".note-detail-mask")?.removeAttribute("hidden");
  const overlay = extract.extract(openOverlay, "https://www.xiaohongshu.com/search_result?keyword=%E9%98%B2%E6%99%92");
  assert.equal(overlay.ok, true);
  assert.equal(overlay.body?.includes("真实详情正文"), true);

  const douyinFeed = extract.extract(fixture("xhs-search.html"), "https://www.douyin.com/recommend");
  assert.equal(douyinFeed.ok, false);
  assert.equal(douyinFeed.reason, "not-detail");

  const douyinHome = extract.extract(fixture("xhs-search.html"), "https://www.douyin.com/");
  assert.equal(douyinHome.ok, false);
  assert.equal(douyinHome.reason, "not-detail");

  const douyinVideo = extract.extract(fixture("douyin-video.html"), "https://www.douyin.com/video/123");
  assert.equal(douyinVideo.ok, false);
  assert.equal(douyinVideo.reason, "video");

  const douyinVideoModal = extract.extract(fixture("douyin-video.html"), "https://www.douyin.com/discover?modal_id=123");
  assert.equal(douyinVideoModal.ok, false);
  assert.equal(["video", "incomplete"].includes(douyinVideoModal.reason || ""), true);

  const tiktokFeed = extract.extract(fixture("tiktok-photo.html"), "https://www.tiktok.com/foryou");
  assert.equal(tiktokFeed.ok, false);
  assert.equal(tiktokFeed.reason, "not-detail");

  const tiktokProfile = extract.extract(fixture("tiktok-photo.html"), "https://www.tiktok.com/@user");
  assert.equal(tiktokProfile.ok, false);
  assert.equal(tiktokProfile.reason, "not-detail");
});

test("extracts the Douyin carousel item matching the modal id instead of an adjacent item", () => {
  const result = extract.extract(
    fixture("douyin-search-carousel.html"),
    "https://www.douyin.com/search/%E5%9B%BE%E6%96%87?modal_id=222&type=general"
  );

  assert.equal(result.ok, true);
  assert.equal(result.body, "当前作品正文");
  assert.deepEqual(result.imageUrls, [
    "https://p3-sign.douyinpic.com/tos-cn-i-dy/current-one~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images",
    "https://p3-sign.douyinpic.com/tos-cn-i-dy/current-two~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images",
    "https://p3-sign.douyinpic.com/tos-cn-i-dy/current-three~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images"
  ]);
});

test("deduplicates Douyin cover and rendered URLs for the same detail image", () => {
  const document = fixture("douyin-search-carousel.html");
  document.querySelector(".previous-slide")?.remove();
  document.querySelector(".next-slide")?.remove();

  const result = extract.extract(document, "https://www.douyin.com/note/222");

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, [
    "https://p3-sign.douyinpic.com/tos-cn-i-dy/current-one~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images",
    "https://p3-sign.douyinpic.com/tos-cn-i-dy/current-two~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images",
    "https://p3-sign.douyinpic.com/tos-cn-i-dy/current-three~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images"
  ]);
});

test("extracts only the current TikTok photo images when adjacent posts remain mounted", () => {
  const result = extract.extract(
    fixture("tiktok-photo-neighbors.html"),
    "https://www.tiktok.com/@current/photo/222"
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, [
    "https://p16-sign.tiktokcdn.com/current-1.jpeg",
    "https://p16-sign.tiktokcdn.com/current-2.jpeg"
  ]);
});

test("extracts the TikTok caption from the current photo instead of a mounted neighbor", () => {
  const result = extract.extract(
    fixture("tiktok-photo-neighbors.html"),
    "https://www.tiktok.com/@current/photo/222"
  );

  assert.equal(result.ok, true);
  assert.equal(result.title, "当前主题标题");
  assert.equal(result.body, "当前详情页的正确文案");
});

test("extracts only the TikTok JSON record matching the current photo id", () => {
  const document = parseHTML(`
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
      {"items":[
        {"id":"111","desc":"相邻主题文案","imagePost":{"images":[{"imageURL":{"urlList":["https://p16-sign.tiktokcdn.com/json-previous.jpeg"]}}]}},
        {"id":"222","desc":"当前 JSON 文案","imagePost":{"images":[{"imageURL":{"urlList":["https://p16-sign.tiktokcdn.com/json-current-1.jpeg"]}},{"imageURL":{"urlList":["https://p16-sign.tiktokcdn.com/json-current-2.jpeg"]}}]}}
      ]}
    </script>
  `).document;

  const result = extract.extract(document, "https://www.tiktok.com/@current/photo/222");

  assert.equal(result.ok, true);
  assert.equal(result.body, "当前 JSON 文案");
  assert.deepEqual(result.imageUrls, [
    "https://p16-sign.tiktokcdn.com/json-current-1.jpeg",
    "https://p16-sign.tiktokcdn.com/json-current-2.jpeg"
  ]);
});

test("extracts an open TikTok photo dialog instead of hiding the upload bar on search results", () => {
  const result = extract.extract(
    fixture("tiktok-search-open-dialog.html"),
    "https://www.tiktok.com/@current/photo/222?q=%E5%9B%BE%E6%96%87"
  );

  assert.equal(result.ok, true);
  assert.equal(result.title, "当前弹窗标题");
  assert.equal(result.body, "当前弹窗正文");
  assert.deepEqual(result.imageUrls, [
    "https://p16-sign.tiktokcdn.com/dialog-current-1.jpeg",
    "https://p16-sign.tiktokcdn.com/dialog-current-2.jpeg"
  ]);
});

test("extracts a visible Douyin detail dialog when the search URL no longer carries a modal id", () => {
  const result = extract.extract(
    fixture("douyin-search-modal.html"),
    "https://www.douyin.com/search/%E5%9B%BE%E6%96%87?aid=3131d386-300f-4719-be6a-5ed8458103fd&type=general"
  );

  assert.equal(result.ok, true);
  assert.equal(result.platform, "抖音");
  assert.equal(result.title, "春有百花秋有月");
  assert.deepEqual(result.imageUrls, [
    "https://p3-sign.douyinpic.com/json-1.jpeg",
    "https://p3-sign.douyinpic.com/json-2.jpeg"
  ]);
});

test("uses the visible Douyin dialog to select every image from the matching data record", () => {
  const document = parseHTML(`
    <div class="search-list">
      <img src="https://p3-sign.douyinpic.com/feed-cover.jpeg" alt="列表封面">
    </div>
    <div role="dialog" aria-modal="true" class="NoteModal">
      <h1 data-e2e="note-title">当前主题</h1>
      <div data-e2e="note-desc">当前作品正文</div>
      <img src="https://p3-sign.douyinpic.com/tos-cn-i-dy/current-one~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images" alt="当前首图">
    </div>
    <script id="RENDER_DATA" type="application/json">
      {"items":[
        {"aweme_id":"111","desc":"相邻作品正文","images":[
          {"url_list":["https://p3-sign.douyinpic.com/tos-cn-i-dy/previous-one~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images"]}
        ]},
        {"aweme_id":"222","desc":"当前作品正文","images":[
          {"url_list":["https://p3-sign.douyinpic.com/tos-cn-i-dy/current-one~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images"]},
          {"url_list":["https://p3-sign.douyinpic.com/tos-cn-i-dy/current-two~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images"]},
          {"url_list":["https://p3-sign.douyinpic.com/tos-cn-i-dy/current-three~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images"]}
        ]}
      ]}
    </script>
  `).document;

  const result = extract.extract(
    document,
    "https://www.douyin.com/search/%E5%9B%BE%E6%96%87?aid=3131d386-300f-4719-be6a-5ed8458103fd&type=general"
  );

  assert.equal(result.ok, true);
  assert.equal(result.body, "当前作品正文");
  assert.deepEqual(result.imageUrls, [
    "https://p3-sign.douyinpic.com/tos-cn-i-dy/current-one~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images",
    "https://p3-sign.douyinpic.com/tos-cn-i-dy/current-two~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images",
    "https://p3-sign.douyinpic.com/tos-cn-i-dy/current-three~tplv-dy-aweme-images:q75.webp?biz_tag=aweme_images"
  ]);
});

test("prefers the complete Douyin image record when the same modal id first appears as a one-image preview", () => {
  const document = parseHTML(`
    <div role="dialog" aria-modal="true" class="NoteModal">
      <h1 data-e2e="note-title">当前主题</h1>
      <div data-e2e="note-desc">同一作品正文</div>
      <img src="https://p3-sign.douyinpic.com/current-one.jpeg" alt="当前首图">
    </div>
    <script id="RENDER_DATA" type="application/json">
      {"searchPreview":{
        "aweme_id":"7535681021778971962",
        "desc":"同一作品正文",
        "images":[{"url_list":["https://p3-sign.douyinpic.com/current-one.jpeg"]}]
      },"detailRecord":{
        "aweme_id":"7535681021778971962",
        "desc":"同一作品正文",
        "images":[
          {"url_list":["https://p3-sign.douyinpic.com/current-one.jpeg"]},
          {"url_list":["https://p3-sign.douyinpic.com/current-two.jpeg"]},
          {"url_list":["https://p3-sign.douyinpic.com/current-three.jpeg"]},
          {"url_list":["https://p3-sign.douyinpic.com/current-four.jpeg"]}
        ]
      }}
    </script>
  `).document;

  const result = extract.extract(
    document,
    "https://www.douyin.com/search/%E5%9B%BE%E6%96%87?modal_id=7535681021778971962&type=general"
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, [
    "https://p3-sign.douyinpic.com/current-one.jpeg",
    "https://p3-sign.douyinpic.com/current-two.jpeg",
    "https://p3-sign.douyinpic.com/current-three.jpeg",
    "https://p3-sign.douyinpic.com/current-four.jpeg"
  ]);
});

test("prefers a complete Douyin detail script over a parsed partial search preview", () => {
  const document = parseHTML(`
    <div role="dialog" aria-modal="true" class="NoteModal">
      <h1 data-e2e="note-title">当前主题</h1>
      <div data-e2e="note-desc">脚本中的同一作品</div>
      <img src="https://p3-sign.douyinpic.com/script-one.jpeg" alt="当前首图">
    </div>
    <script id="RENDER_DATA" type="application/json">{"aweme_id":"7535681021778971962","desc":"脚本中的同一作品","images":[{"url_list":["https://p3-sign.douyinpic.com/script-one.jpeg"]},{"url_list":["https://p3-sign.douyinpic.com/script-two.jpeg"]}]}</script>
    <script>self.__DETAIL_CACHE__={"aweme_id":"7535681021778971962","desc":"脚本中的同一作品","images":[{"url_list":["https://p3-sign.douyinpic.com/script-one.jpeg"]},{"url_list":["https://p3-sign.douyinpic.com/script-two.jpeg"]},{"url_list":["https://p3-sign.douyinpic.com/script-three.jpeg"]}]};</script>
  `).document;

  const result = extract.extract(
    document,
    "https://www.douyin.com/search/%E5%9B%BE%E6%96%87?modal_id=7535681021778971962&type=general"
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, [
    "https://p3-sign.douyinpic.com/script-one.jpeg",
    "https://p3-sign.douyinpic.com/script-two.jpeg",
    "https://p3-sign.douyinpic.com/script-three.jpeg"
  ]);
});

test("merges mounted images from only the current Douyin modal item when page data has just the first image", () => {
  const document = parseHTML(`
    <div data-e2e="slideList">
      <div class="video_7600095287253156785 sliderVideo">
        <div class="playerContainer">
          <img src="https://p3-sign.douyinpic.com/current-one.jpeg" alt="当前首图">
          <img src="https://p3-sign.douyinpic.com/current-two.jpeg" alt="当前第二图">
          <img src="https://p3-sign.douyinpic.com/current-three.jpeg" alt="当前第三图">
          <img src="https://p3-sign.douyinpic.com/current-four.jpeg" alt="当前第四图">
        </div>
        <div data-e2e="video-desc">当前作品正文</div>
      </div>
      <div class="video_9999999999999999999 sliderVideo">
        <div class="playerContainer">
          <img src="https://p3-sign.douyinpic.com/next-topic.jpeg" alt="下一主题图片">
        </div>
        <div data-e2e="video-desc">下一主题正文</div>
      </div>
    </div>
    <script id="RENDER_DATA" type="application/json">
      {"aweme_id":"7600095287253156785","desc":"当前作品正文","images":[
        {"url_list":["https://p3-sign.douyinpic.com/current-one.jpeg"]}
      ]}
    </script>
  `).document;

  const result = extract.extract(
    document,
    "https://www.douyin.com/search/%E5%9B%BE%E6%96%87?modal_id=7600095287253156785&type=general"
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, [
    "https://p3-sign.douyinpic.com/current-one.jpeg",
    "https://p3-sign.douyinpic.com/current-two.jpeg",
    "https://p3-sign.douyinpic.com/current-three.jpeg",
    "https://p3-sign.douyinpic.com/current-four.jpeg"
  ]);
  assert.equal(result.imageUrls.includes("https://p3-sign.douyinpic.com/next-topic.jpeg"), false);
});

test("walks a lazy Douyin image carousel inside the current modal item", async () => {
  const href = "https://www.douyin.com/search/%E5%9B%BE%E6%96%87?modal_id=7600095287253156785&type=general";
  const document = parseHTML(`
    <div class="video_7600095287253156785 sliderVideo">
      <div data-e2e="video-desc">当前作品正文</div>
      <div class="playerContainer">
        <img id="lazy-current" src="https://p3-sign.douyinpic.com/lazy-one.jpeg" alt="当前轮播图">
        <button id="lazy-next" type="button" aria-label="下一张"></button>
      </div>
    </div>
    <div class="video_9999999999999999999 sliderVideo">
      <img src="https://p3-sign.douyinpic.com/next-topic.jpeg" alt="下一主题图片">
      <div data-e2e="video-desc">下一主题正文</div>
    </div>
    <script id="RENDER_DATA" type="application/json">
      {"aweme_id":"7600095287253156785","desc":"当前作品正文","images":[
        {"url_list":["https://p3-sign.douyinpic.com/lazy-one.jpeg"]}
      ]}
    </script>
  `).document;
  const slides = [
    "https://p3-sign.douyinpic.com/lazy-one.jpeg",
    "https://p3-sign.douyinpic.com/lazy-two.jpeg",
    "https://p3-sign.douyinpic.com/lazy-three.jpeg"
  ];
  const image = document.querySelector("#lazy-current")!;
  const next = document.querySelector("#lazy-next")!;
  let slideIndex = 0;
  let clickCount = 0;
  next.addEventListener("click", () => {
    clickCount += 1;
    slideIndex += 1;
    image.setAttribute("src", slides[slideIndex]);
    if (slideIndex === slides.length - 1) next.setAttribute("aria-disabled", "true");
  });

  const note = extract.extract(document, href);
  assert.equal(typeof extract.collectDouyinCarouselImages, "function");
  const imageUrls = await extract.collectDouyinCarouselImages(document, href, note);

  assert.deepEqual(imageUrls, slides);
  assert.equal(imageUrls.includes("https://p3-sign.douyinpic.com/next-topic.jpeg"), false);
  assert.equal(clickCount, 2);
});

test("uses the nearest right-side carousel control instead of the Douyin action rail", async () => {
  const href = "https://www.douyin.com/search/%E5%9B%BE%E6%96%87?modal_id=7600095287253156785&type=general";
  const document = parseHTML(`
    <div class="video_7600095287253156785 sliderVideo">
      <div data-e2e="video-desc">当前作品正文</div>
      <img id="geometry-current" src="https://p3-sign.douyinpic.com/geometry-one.jpeg" alt="当前轮播图">
      <button id="geometry-next" type="button"></button>
      <button id="action-rail" type="button"></button>
    </div>
  `).document;
  const image = document.querySelector("#geometry-current")! as HTMLElement;
  const next = document.querySelector("#geometry-next")! as HTMLElement;
  const action = document.querySelector("#action-rail")! as HTMLElement;
  image.getBoundingClientRect = () => ({ left: 300, right: 1500, top: 100, bottom: 800, width: 1200, height: 700, x: 300, y: 100, toJSON() {} });
  next.getBoundingClientRect = () => ({ left: 1590, right: 1650, top: 420, bottom: 480, width: 60, height: 60, x: 1590, y: 420, toJSON() {} });
  action.getBoundingClientRect = () => ({ left: 1830, right: 1890, top: 430, bottom: 490, width: 60, height: 60, x: 1830, y: 430, toJSON() {} });
  let actionClicks = 0;
  next.addEventListener("click", () => {
    image.setAttribute("src", "https://p3-sign.douyinpic.com/geometry-two.jpeg");
    next.setAttribute("aria-disabled", "true");
  });
  action.addEventListener("click", () => {
    actionClicks += 1;
  });

  const note = extract.extract(document, href);
  assert.equal(typeof extract.collectDouyinCarouselImages, "function");
  const imageUrls = await extract.collectDouyinCarouselImages(document, href, note);

  assert.deepEqual(imageUrls, [
    "https://p3-sign.douyinpic.com/geometry-one.jpeg",
    "https://p3-sign.douyinpic.com/geometry-two.jpeg"
  ]);
  assert.equal(actionClicks, 0);
});

test("keeps TikTok post images whose accessibility text mentions comments", () => {
  const document = parseHTML(`
    <div role="dialog">
      <h1>正文图无障碍说明</h1>
      <div data-e2e="browse-video-desc">当前正文</div>
      <img
        alt="28 Likes, 0 Comments. image posted by () on TikTok"
        src="https://p16-sign.tiktokcdn.com/comment-alt-current.jpeg"
        width="1080"
        height="1440"
      >
    </div>
  `).document;

  const result = extract.extract(document, "https://www.tiktok.com/@current/photo/222");

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, [
    "https://p16-sign.tiktokcdn.com/comment-alt-current.jpeg"
  ]);
});

test("library2 media allowlist covers the three platforms and rejects unrelated hosts", () => {
  assert.equal(media.isAllowedMediaUrl("https://sns-webpic-qc.xhscdn.com/a.webp"), true);
  assert.equal(media.isAllowedMediaUrl("https://p3-sign.douyinpic.com/a.jpeg"), true);
  assert.equal(media.isAllowedMediaUrl("https://p16-sign.tiktokcdn.com/a.jpeg"), true);
  assert.equal(media.isAllowedMediaUrl("https://evil.example/a.jpeg"), false);
  assert.equal(media.sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
});

test("stops waiting for a stalled platform image request", async () => {
  let receivedSignal = false;
  const result = await media.downloadImage(
    "https://p16-sign.tiktokcdn.com/stalled.jpeg",
    async (_url, init) => new Promise<Response>((resolve) => {
      receivedSignal = Boolean(init?.signal);
      if (!init?.signal) {
        resolve(new Response(null, { status: 504 }));
        return;
      }
      init?.signal?.addEventListener("abort", () => resolve(new Response(null, { status: 504 })), { once: true });
    }),
    5
  );

  assert.equal(receivedSignal, true);
  assert.equal(result, null);
});

test("plugin bar and background upload to library2 without touching the collect protocol version", () => {
  assert.match(bar, /上传到爆款选题库2/);
  assert.match(bar, /已识别这条详情/);
  assert.match(bar, /library2:upload/);
  assert.match(bar, /collectDouyinCarouselImages/);
  assert.match(bridge, /content-production-studio\.library2/);
  assert.match(background, /library2:session/);
  assert.match(background, /shared\/library2-session\.js/);
  assert.match(background, /chrome\.tabs\.query/);
  assert.match(background, /MEDIA_DOWNLOAD_BATCH_SIZE\s*=\s*4/);
  assert.match(background, /Promise\.all/);
  assert.match(background, /\/api\/library2\/upload-intents/);
  assert.match(background, /http:\/\/127\.0\.0\.1:3000/);
  assert.doesNotMatch(background, /\/api\/content-storage\//);
});
