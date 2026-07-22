(function () {
  const XhsExtensionProtocol = globalThis.XhsExtensionProtocol;
  if (!XhsExtensionProtocol) return;

  const port = chrome.runtime.connect({ name: "xhs-app-bridge" });
  let activeRequestId = null;
  let disconnected = false;

  function extensionEnvelope(type, requestId, payload) {
    return {
      channel: XhsExtensionProtocol.CHANNEL,
      protocolVersion: XhsExtensionProtocol.PROTOCOL_VERSION,
      direction: "extension-to-page",
      type,
      requestId,
      payload
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (!XhsExtensionProtocol.isEnvelope(event.data, "page-to-extension") || disconnected) return;
    if (event.data.type === "collect" && activeRequestId === null) activeRequestId = event.data.requestId;
    if (event.data.type === "cancel" && event.data.requestId === activeRequestId) activeRequestId = null;
    port.postMessage(event.data);
  });

  port.onMessage.addListener((message) => {
    if (!XhsExtensionProtocol.isEnvelope(message, "extension-to-page")) return;
    window.postMessage(message, location.origin);
    if ((message.type === "result" || message.type === "error") && message.requestId === activeRequestId) {
      activeRequestId = null;
    }
  });

  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (!activeRequestId) return;
    const message = extensionEnvelope("error", activeRequestId, {
      code: "EXTENSION_DISCONNECTED",
      message: "本机抓取扩展连接已断开"
    });
    activeRequestId = null;
    if (XhsExtensionProtocol.isEnvelope(message, "extension-to-page")) window.postMessage(message, location.origin);
  });

  window.addEventListener("pagehide", () => {
    activeRequestId = null;
    port.disconnect();
  }, { once: true });
})();
