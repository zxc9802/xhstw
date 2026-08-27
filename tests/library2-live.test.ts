import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);
const modulePath = path.resolve("browser-extension/shared/library2-live.js");

type LivePair = {
  order: number;
  coverUrl: string;
  videoSource: { kind: "remote" | "blob"; url: string };
};

type LiveHelper = {
  collectXhsLivePhotos(document: Document, options?: {
    performance?: { getEntriesByType(type: string): Array<{ name: string; initiatorType?: string; startTime?: number }> };
    delay?: (milliseconds: number) => Promise<void>;
    maxWaitMs?: number;
  }): Promise<LivePair[]>;
};

function loadLive(): LiveHelper {
  assert.equal(existsSync(modulePath), true, "Xiaohongshu Live helper must exist");
  return require(modulePath) as LiveHelper;
}

function liveFixture() {
  return parseHTML(readFileSync(new URL("./fixtures/xhs-live-detail.html", import.meta.url), "utf8")).document;
}

function activeIndex(document: Document) {
  return document.querySelector(".swiper-slide-active")?.getAttribute("data-swiper-slide-index") ?? "";
}

function installCarousel(document: Document, initialIndex = 0) {
  const slides = Array.from(document.querySelectorAll<HTMLElement>(".swiper-slide:not(.swiper-slide-duplicate)"));
  let current = initialIndex;
  function render() {
    slides.forEach((slide, index) => slide.classList.toggle("swiper-slide-active", index === current));
    const counter = document.querySelector(".live-counter");
    if (counter) counter.textContent = `${current + 1}/${slides.length}`;
  }
  document.querySelector(".swiper-button-next")?.addEventListener("click", () => {
    current = (current + 1) % slides.length;
    render();
  });
  document.querySelector(".swiper-button-prev")?.addEventListener("click", () => {
    current = (current + slides.length - 1) % slides.length;
    render();
  });
  render();
  return () => current;
}

test("collects three ordered Live pairs, ignores a duplicate, and restores the active slide", async () => {
  const live = loadLive();
  const document = liveFixture();
  const currentIndex = installCarousel(document, 1);
  const resources = [
    { name: "https://sns-video-v3.xhscdn.com/live-1.mp4?sign=1", initiatorType: "video", startTime: 1 },
    { name: "https://sns-video-v3.xhscdn.com/live-2.mp4?sign=2", initiatorType: "video", startTime: 2 },
    { name: "https://sns-video-v3.xhscdn.com/live-3.mp4?sign=3", initiatorType: "video", startTime: 3 }
  ];

  const pairs = await live.collectXhsLivePhotos(document, {
    performance: { getEntriesByType: () => resources.slice(0, currentIndex() + 1) },
    delay: async () => {},
    maxWaitMs: 20
  });

  assert.deepEqual(pairs.map((pair) => [pair.order, pair.coverUrl, pair.videoSource.kind, pair.videoSource.url]), [
    [0, "https://sns-webpic-qc.xhscdn.com/live-1.jpg", "remote", resources[0]!.name],
    [1, "https://sns-webpic-qc.xhscdn.com/live-2.jpg", "remote", resources[1]!.name],
    [2, "https://sns-webpic-qc.xhscdn.com/live-3.jpg", "remote", resources[2]!.name]
  ]);
  assert.equal(activeIndex(document), "1");
});

test("falls back to the active page blob when no official MP4 resource is available", async () => {
  const live = loadLive();
  const document = liveFixture();
  document.querySelectorAll(".swiper-slide").forEach((slide) => {
    if (slide.getAttribute("data-swiper-slide-index") !== "0" || slide.classList.contains("swiper-slide-duplicate")) slide.remove();
  });
  installCarousel(document);

  const pairs = await live.collectXhsLivePhotos(document, {
    performance: { getEntriesByType: () => [] },
    delay: async () => {},
    maxWaitMs: 20
  });

  assert.deepEqual(pairs[0]?.videoSource, {
    kind: "blob",
    url: "blob:https://www.xiaohongshu.com/live-1"
  });
});

test("rejects an incomplete Live pair and restores the original slide", async () => {
  const live = loadLive();
  const document = liveFixture();
  document.querySelector('[data-swiper-slide-index="1"] .live-video')?.remove();
  installCarousel(document, 2);

  await assert.rejects(live.collectXhsLivePhotos(document, {
    performance: { getEntriesByType: () => [] },
    delay: async () => {},
    maxWaitMs: 20
  }), /第 2 张 Live 图片没有对应视频/);
  assert.equal(activeIndex(document), "2");
});
