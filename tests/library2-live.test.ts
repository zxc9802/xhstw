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
  streamBlob(port: { postMessage(message: unknown): void }, blobUrl: string, options?: {
    fetchImpl?: typeof fetch;
    chunkBytes?: number;
  }): Promise<{ byteLength: number; chunkCount: number }>;
  readBlobFromTab(
    connect: (tabId: number, info: { name: string }) => any,
    tabId: number,
    blobUrl: string,
    options?: { timeoutMs?: number }
  ): Promise<{ bytes: Uint8Array; contentType: "video/mp4"; size: number }>;
};

type MediaHelper = {
  sniffVideoType(bytes: Uint8Array): string;
  downloadVideo(value: string, fetchImpl: typeof fetch, timeoutMs?: number): Promise<{
    bytes: Uint8Array;
    contentType: string;
    size: number;
  }>;
};

function loadLive(): LiveHelper {
  assert.equal(existsSync(modulePath), true, "Xiaohongshu Live helper must exist");
  return require(modulePath) as LiveHelper;
}

function loadMedia(): MediaHelper {
  return require(path.resolve("browser-extension/shared/library2-media.js")) as MediaHelper;
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

test("accepts only a real MP4 response from an official media host", async () => {
  const media = loadMedia();
  const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  assert.equal(media.sniffVideoType(mp4), "video/mp4");
  assert.equal(media.sniffVideoType(new Uint8Array(12)), "");

  const downloaded = await media.downloadVideo(
    "https://sns-video-v3.xhscdn.com/live.mp4?sign=ok",
    async () => new Response(mp4, { headers: { "content-type": "video/mp4" } })
  );
  assert.deepEqual(downloaded, { bytes: mp4, contentType: "video/mp4", size: mp4.byteLength });

  await assert.rejects(media.downloadVideo(
    "https://sns-video-v3.xhscdn.com/not-video.mp4",
    async () => new Response("<html></html>", { headers: { "content-type": "text/html" } })
  ), /Live 视频格式无效/);
});

test("streams a page blob as bounded ordered chunks", async () => {
  const live = loadLive();
  const messages: any[] = [];
  const bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4]);
  const result = await live.streamBlob({ postMessage(message) { messages.push(message); } }, "blob:https://www.xiaohongshu.com/live", {
    fetchImpl: async () => new Response(bytes, { headers: { "content-type": "video/mp4" } }),
    chunkBytes: 5
  });

  assert.deepEqual(result, { byteLength: bytes.byteLength, chunkCount: 3 });
  assert.deepEqual(messages.map((message) => [message.type, message.chunkIndex, message.byteLength]), [
    ["start", undefined, undefined],
    ["chunk", 0, 5],
    ["chunk", 1, 5],
    ["chunk", 2, 2],
    ["complete", undefined, 12]
  ]);
  assert.deepEqual(
    Buffer.concat(messages.filter((message) => message.type === "chunk").map((message) => Buffer.from(message.data, "base64"))),
    Buffer.from(bytes)
  );
});

test("reports a blob read error without sending completion", async () => {
  const live = loadLive();
  const messages: any[] = [];
  await assert.rejects(live.streamBlob({ postMessage(message) { messages.push(message); } }, "blob:https://www.xiaohongshu.com/missing", {
    fetchImpl: async () => new Response(null, { status: 404 })
  }), /页面 Live 视频读取失败/);
  assert.equal(messages.some((message) => message.type === "error"), true);
  assert.equal(messages.some((message) => message.type === "complete"), false);
});

test("reassembles consecutive blob port chunks and validates MP4", async () => {
  const live = loadLive();
  const listeners: Array<(message: any) => void> = [];
  const disconnected: Array<() => void> = [];
  const port = {
    onMessage: { addListener(listener: (message: any) => void) { listeners.push(listener); } },
    onDisconnect: { addListener(listener: () => void) { disconnected.push(listener); } },
    postMessage(message: any) {
      assert.deepEqual(message, { type: "read", url: "blob:https://www.xiaohongshu.com/live" });
      queueMicrotask(() => {
        listeners.forEach((listener) => listener({ type: "start", contentType: "video/mp4" }));
        listeners.forEach((listener) => listener({ type: "chunk", chunkIndex: 0, data: "AAAAGGZ0eXA=", byteLength: 8 }));
        listeners.forEach((listener) => listener({ type: "chunk", chunkIndex: 1, data: "aXNvbQ==", byteLength: 4 }));
        listeners.forEach((listener) => listener({ type: "complete", byteLength: 12, chunkCount: 2 }));
      });
    },
    disconnect() { disconnected.forEach((listener) => listener()); }
  };

  const result = await live.readBlobFromTab(() => port, 7, "blob:https://www.xiaohongshu.com/live", { timeoutMs: 100 });
  assert.equal(result.contentType, "video/mp4");
  assert.equal(result.size, 12);
  assert.equal(Buffer.from(result.bytes).toString("hex"), "000000186674797069736f6d");
});
