(function () {
  const XhsExtensionProtocol = globalThis.XhsExtensionProtocol;
  if (!XhsExtensionProtocol) return;

  let port = null;
  let activeRequestId = null;

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

  function connectPort() {
    if (port) return port;
    const nextPort = chrome.runtime.connect({ name: "xhs-app-bridge" });
    port = nextPort;
    nextPort.onMessage.addListener((message) => {
      if (port !== nextPort || !XhsExtensionProtocol.isEnvelope(message, "extension-to-page")) return;
      window.postMessage(message, location.origin);
      if ((message.type === "result" || message.type === "error") && message.requestId === activeRequestId) {
        activeRequestId = null;
      }
    });
    nextPort.onDisconnect.addListener(() => {
      if (port === nextPort) port = null;
      if (!activeRequestId) return;
      const message = extensionEnvelope("error", activeRequestId, {
        code: "EXTENSION_DISCONNECTED",
        message: "本机抓取扩展连接已断开"
      });
      activeRequestId = null;
      if (XhsExtensionProtocol.isEnvelope(message, "extension-to-page")) window.postMessage(message, location.origin);
    });
    return nextPort;
  }

  connectPort();

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (!XhsExtensionProtocol.isEnvelope(event.data, "page-to-extension")) return;
    if (event.data.type === "collect" && activeRequestId === null) activeRequestId = event.data.requestId;
    if (event.data.type === "cancel" && event.data.requestId === activeRequestId) activeRequestId = null;
    connectPort().postMessage(event.data);
  });

  window.addEventListener("pagehide", () => {
    activeRequestId = null;
    if (port) port.disconnect();
    port = null;
  }, { once: true });
})();
