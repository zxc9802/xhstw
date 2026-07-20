import { CDPBridge } from "@jackwener/opencli/browser/cdp";

type DirectCdpPage = {
  goto(url: string, options?: { settleMs?: number }): Promise<void>;
  evaluate<T>(script: string): Promise<T>;
};

type DirectCdpBridgeLike = {
  setCommandTimeout?(timeoutMs: number): void;
  connect(options: { cdpEndpoint?: string; timeout?: number }): Promise<DirectCdpPage>;
  close(): Promise<void>;
};

type DirectCdpTarget = {
  id: string;
  webSocketDebuggerUrl: string;
};

type DirectCdpDependencies = {
  createBridge?: () => DirectCdpBridgeLike;
  fetch?: typeof fetch;
};

type OpenCliCommandRunner = (args: string[], timeout: number) => Promise<string>;

export class DirectCdpBridge extends CDPBridge {
  private commandTimeoutMs?: number;

  setCommandTimeout(timeoutMs: number) {
    this.commandTimeoutMs = timeoutMs;
  }

  override async send(method: string, params: Record<string, unknown> = {}, timeoutMs?: number) {
    if (method === "Page.addScriptToEvaluateOnNewDocument") {
      return { identifier: "direct-cdp-stealth-skipped" };
    }
    return super.send(method, params, timeoutMs ?? this.commandTimeoutMs);
  }
}

export function createOpenCliCommandRouter(
  endpoint: string,
  runDirect: OpenCliCommandRunner,
  runFallback: OpenCliCommandRunner
) {
  return (args: string[], timeout: number) => endpoint && args[0] === "browser"
    ? runDirect(args, timeout)
    : runFallback(args, timeout);
}

export function createDirectCdpBrowserCommandRunner(endpoint: string, dependencies: DirectCdpDependencies = {}) {
  const baseUrl = endpoint.replace(/\/$/, "");
  const createBridge = dependencies.createBridge ?? (() => new DirectCdpBridge());
  const fetchImpl = dependencies.fetch ?? fetch;
  const targets = new Map<string, DirectCdpTarget>();

  async function closeTarget(session: string) {
    const target = targets.get(session);
    if (!target) return;
    targets.delete(session);
    const response = await fetchImpl(`${baseUrl}/json/close/${encodeURIComponent(target.id)}`);
    if (!response.ok) {
      throw new Error(`Failed to close CDP target ${target.id}: HTTP ${response.status}`);
    }
  }

  async function withPage<T>(session: string, timeout: number, operation: (page: DirectCdpPage) => Promise<T>) {
    const target = targets.get(session);
    if (!target) throw new Error(`CDP browser session "${session}" is not open`);
    const bridge = createBridge();
    bridge.setCommandTimeout?.(timeout);
    try {
      const page = await bridge.connect({ cdpEndpoint: target.webSocketDebuggerUrl, timeout: 10 });
      return await operation(page);
    } finally {
      await bridge.close();
    }
  }

  return async function runDirectCdpBrowserCommand(args: string[], timeout = 90_000) {
    if (args[0] !== "browser") throw new Error("Direct CDP runner only supports browser commands");
    const session = args[1];
    const command = args[2];
    if (!session || !command) throw new Error("Direct CDP browser command requires a session and command");

    if (command === "open") {
      const url = args[3];
      if (!url) throw new Error("Direct CDP browser open requires a URL");
      await closeTarget(session);
      const response = await fetchImpl(`${baseUrl}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
      if (!response.ok) throw new Error(`Failed to create CDP target: HTTP ${response.status}`);
      const target = await response.json() as Partial<DirectCdpTarget>;
      if (!target.id || !target.webSocketDebuggerUrl) throw new Error("CDP target response is missing id or webSocketDebuggerUrl");
      targets.set(session, target as DirectCdpTarget);
      try {
        await withPage(session, timeout, (page) => page.goto(url, { settleMs: 2_000 }));
      } catch (error) {
        await closeTarget(session).catch(() => undefined);
        throw error;
      }
      return JSON.stringify({ url, page: target.id });
    }

    if (command === "eval") {
      const script = args[3];
      if (!script) throw new Error("Direct CDP browser eval requires a script");
      const result = await withPage(session, timeout, (page) => page.evaluate(script));
      return JSON.stringify(result);
    }

    if (command === "close") {
      await closeTarget(session);
      return JSON.stringify({ closed: true, session });
    }

    throw new Error(`Unsupported direct CDP browser command: ${command}`);
  };
}
