(function () {
  const HOST_ID = "studio-library2-bar-host";
  const extract = globalThis.StudioPageExtract;
  const live = globalThis.Library2Live;
  if (!extract) return;

  chrome.runtime.onConnect.addListener((port) => {
    if (!live || port.name !== "library2-live-blob") return;
    let handled = false;
    port.onMessage.addListener((message) => {
      if (handled || !message || message.type !== "read" || typeof message.url !== "string") return;
      handled = true;
      void live.streamBlob(port, message.url).catch(() => {});
    });
  });

  let lastHref = "";
  let lastKind = "";
  let uploading = false;

  function host() {
    return document.getElementById(HOST_ID);
  }

  function removeBar() {
    const current = host();
    if (current) current.remove();
    lastKind = "";
  }

  function setStatus(message, tone) {
    const status = host() && host().querySelector("[data-library2-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone || "info";
  }

  function renderBar(note) {
    let root = host();
    if (!root) {
      root = document.createElement("div");
      root.id = HOST_ID;
      root.style.cssText = "all:initial;position:fixed;left:0;right:0;bottom:0;z-index:2147483646;font-family:ui-sans-serif,system-ui,sans-serif;";
      document.documentElement.appendChild(root);
      root.innerHTML = `
        <div style="margin:0 16px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-radius:16px;background:#1c1917;color:#fff7ed;box-shadow:0 12px 40px rgba(0,0,0,.28);">
          <div>
            <div style="font-size:14px;font-weight:700;">上传到爆款选题库2</div>
            <div data-library2-status style="margin-top:4px;font-size:12px;opacity:.82;">把当前图文的图片和文案存进图文生产中台</div>
          </div>
          <button data-library2-upload type="button" style="border:0;border-radius:999px;background:#ea580c;color:white;font-size:13px;font-weight:700;padding:10px 16px;cursor:pointer;">上传资料库</button>
        </div>
      `;
      root.querySelector("[data-library2-upload]").addEventListener("click", () => {
        void uploadCurrent();
      });
    }
    const count = Array.isArray(note.imageUrls) ? note.imageUrls.length : 0;
    setStatus(note.isLive
      ? `${note.platform} · ${count} 组 Live${note.body ? " · 已识别文案" : ""}`
      : `${note.platform} · ${count} 张图${note.body ? " · 已识别文案" : ""}`, "info");
  }

  async function uploadCurrent() {
    if (uploading) return;
    const href = location.href;
    const note = extract.extract(document, href);
    if (!note.ok || note.kind !== "image") {
      setStatus("当前不是可上传的图文页", "error");
      return;
    }
    uploading = true;
    try {
      let imageUrls = note.imageUrls;
      let livePhotos = [];
      if (note.platform === "小红书" && note.isLive) {
        if (!live || typeof live.collectXhsLivePhotos !== "function") throw new Error("Live 读取模块未加载");
        setStatus("正在逐组读取小红书 Live…", "info");
        const pairs = await live.collectXhsLivePhotos(document);
        imageUrls = pairs.map((pair) => pair.coverUrl);
        livePhotos = pairs.map((pair, coverIndex) => ({
          order: pair.order,
          coverIndex,
          videoSource: pair.videoSource
        }));
      }
      if (note.platform === "抖音" && typeof extract.collectDouyinCarouselImages === "function") {
        setStatus("正在逐张读取当前抖音图文…", "info");
        imageUrls = await extract.collectDouyinCarouselImages(document, href, note);
      }
      setStatus(`已读取 ${imageUrls.length} 张图，正在上传…`, "info");
      const response = await chrome.runtime.sendMessage({
        type: "library2:upload",
        payload: {
          platform: note.platform,
          sourceUrl: note.sourceUrl,
          title: note.title,
          body: note.body,
          imageUrls,
          livePhotos
        }
      });
      if (!response || response.ok !== true) {
        setStatus((response && response.message) || "上传失败", "error");
        return;
      }
      setStatus("已保存到爆款选题库2", "ok");
    } catch (error) {
      setStatus(error && error.message ? error.message : "上传失败", "error");
    } finally {
      uploading = false;
    }
  }

  function syncBar() {
    if (uploading) return;
    const href = location.href;
    lastHref = href;
    const note = extract.extract(document, href);
    if (note.ok && note.kind === "image") {
      lastKind = "image";
      renderBar(note);
      return;
    }
    const itemId = extract.douyinNoteId ? extract.douyinNoteId(href) : "";
    if (extract.detectPlatform(href) === "抖音" && itemId) {
      lastKind = note.reason || "incomplete";
      renderBar({ platform: "抖音", imageUrls: [], body: "" });
      setStatus(note.reason === "video" ? "已识别这条详情，但当前是视频" : "已识别这条详情，但还没取到图片和文案", "error");
      return;
    }
    if (host()) removeBar();
    lastKind = note.ok ? note.kind : note.reason;
  }

  syncBar();
  setInterval(syncBar, 800);
  document.addEventListener("visibilitychange", syncBar);
})();
