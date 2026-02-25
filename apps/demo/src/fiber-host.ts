import { Buffer } from "buffer/";
import type {
  CkbJsonRpcTransaction,
  Channel,
  OpenChannelWithExternalFundingParams,
  OpenChannelWithExternalFundingResult
} from "@nervosnetwork/fiber-js";
import { FiberWasmManager } from "@fiber-wallet/shared";

if (!("global" in globalThis)) {
  (globalThis as typeof globalThis & { global: typeof globalThis }).global = globalThis;
}

if (!("Buffer" in globalThis)) {
  (
    globalThis as typeof globalThis & {
      Buffer: typeof Buffer;
    }
  ).Buffer = Buffer;
}

type FiberHostAction =
  | "startFiberNode"
  | "listChannels"
  | "shutdownChannel"
  | "openChannelWithExternalFunding"
  | "submitSignedFundingTx";

type FiberHostRequestMap = {
  startFiberNode: {
    payload: { nativeAddress: string };
    result: { channels: Channel[] };
  };
  listChannels: {
    payload: undefined;
    result: { channels: Channel[] };
  };
  shutdownChannel: {
    payload: { channelId: string };
    result: { ok: true };
  };
  openChannelWithExternalFunding: {
    payload: OpenChannelWithExternalFundingParams;
    result: OpenChannelWithExternalFundingResult;
  };
  submitSignedFundingTx: {
    payload: {
      channelId: string;
      signedTx: CkbJsonRpcTransaction;
    };
    result: { ok: true };
  };
};

type FiberHostRequest = {
  kind: "request";
  requestId: string;
  action: FiberHostAction;
  payload?: unknown;
};

type FiberHostResponse = {
  kind: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type FiberHostReady = {
  kind: "ready";
};

type FiberHostControlMessage = {
  kind: "dispose";
};

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <main class="host-shell">
      <style>
        :root {
          color-scheme: light;
        }

        body {
          margin: 0;
          background: #ffffff;
          color: #111111;
          font-family: Menlo, Monaco, "Courier New", monospace;
        }

        .host-shell {
          min-height: 100vh;
          background: #ffffff;
        }

        .console-panel {
          height: 100vh;
          display: grid;
          grid-template-rows: auto auto minmax(0, 1fr);
          width: 100%;
          overflow: hidden;
          background: #ffffff;
        }

        .console-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: 44px;
          padding: 0 12px;
          border-bottom: 1px solid #dadce0;
          background: #ffffff;
          color: #111111;
        }

        .console-title {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .bar-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .pill {
          max-width: min(45vw, 420px);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border: 1px solid #dadce0;
          border-radius: 999px;
          padding: 5px 10px;
          background: #f8f9fa;
          color: #1a73e8;
          font-size: 11px;
        }

        .tool-button {
          border: 1px solid #dadce0;
          border-radius: 6px;
          padding: 6px 10px;
          background: #ffffff;
          color: #111111;
          font: inherit;
          font-size: 12px;
          cursor: pointer;
        }

        .tool-button:hover {
          background: #f3f4f6;
        }

        .console-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: 30px;
          padding: 0 12px;
          border-bottom: 1px solid #eceff1;
          background: #fafafa;
          font-size: 11px;
          color: #5f6368;
        }

        .console-meta strong {
          color: #111111;
          font-weight: 500;
        }

        .console-view {
          overflow: auto;
          background: #ffffff;
        }

        .console-empty {
          padding: 18px 16px;
          color: #80868b;
          font-size: 12px;
          border-bottom: 1px solid #f1f3f4;
        }

        .console-row {
          display: grid;
          grid-template-columns: 18px 72px 1fr;
          gap: 10px;
          align-items: start;
          padding: 7px 12px;
          border-bottom: 1px solid #f1f3f4;
          font-size: 12px;
          line-height: 1.45;
        }

        .console-row:hover {
          background: #f8f9fa;
        }

        .console-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          margin-top: 1px;
          border-radius: 50%;
          font-size: 10px;
          font-weight: 700;
        }

        .console-time {
          color: #80868b;
          white-space: nowrap;
        }

        .console-message {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          color: #111111;
        }

        .console-row.log .console-icon {
          color: #1a73e8;
        }

        .console-row.info .console-icon {
          color: #1a73e8;
        }

        .console-row.debug .console-icon {
          color: #7e57c2;
        }

        .console-row.warn {
          background: #fffaf0;
        }

        .console-row.warn .console-icon,
        .console-row.warn .console-message {
          color: #b06000;
        }

        .console-row.error {
          background: #fef1f1;
        }

        .console-row.error .console-icon,
        .console-row.error .console-message {
          color: #c5221f;
        }
      </style>

      <section class="console-panel">
        <div class="console-toolbar">
          <span class="console-title">Console</span>
          <div class="bar-actions">
            <span class="pill" data-role="host-channel">Waiting for channel...</span>
            <button type="button" data-role="clear-logs" class="tool-button">Clear console</button>
          </div>
        </div>
        <div class="console-meta">
          <span><strong>Fiber Host</strong> runtime output</span>
          <span data-role="host-status">idle</span>
        </div>
        <div data-role="host-logs" class="console-view">
          <div data-role="empty-state" class="console-empty">No messages yet.</div>
        </div>
      </section>
    </main>
  `;
}

const statusEl = app?.querySelector<HTMLParagraphElement>("[data-role='host-status']");
const channelEl = app?.querySelector<HTMLSpanElement>("[data-role='host-channel']");
const logsEl = app?.querySelector<HTMLDivElement>("[data-role='host-logs']");
const clearLogsButton = app?.querySelector<HTMLButtonElement>("[data-role='clear-logs']");

const MAX_LOG_ENTRIES = 400;

const formatConsoleValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  if (typeof value === "bigint") {
    return `${value}n`;
  }

  try {
    return JSON.stringify(
      value,
      (_, nestedValue) => (typeof nestedValue === "bigint" ? `${nestedValue}n` : nestedValue),
      2
    );
  } catch {
    return String(value);
  }
};

const appendLogEntry = (level: "log" | "info" | "warn" | "error" | "debug", values: unknown[]) => {
  if (!logsEl) {
    return;
  }

  logsEl.querySelector<HTMLElement>("[data-role='empty-state']")?.remove();

  const entry = document.createElement("div");
  const icon = document.createElement("span");
  const timeEl = document.createElement("span");
  const messageEl = document.createElement("pre");
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const message = values.map((value) => formatConsoleValue(value)).join(" ");
  const levelIconMap: Record<typeof level, string> = {
    log: ">",
    info: "i",
    warn: "!",
    error: "x",
    debug: "~"
  };

  entry.className = `console-row ${level}`;
  icon.className = "console-icon";
  icon.textContent = levelIconMap[level];
  timeEl.className = "console-time";
  timeEl.textContent = time;
  messageEl.className = "console-message";
  messageEl.textContent = message;

  entry.append(icon, timeEl, messageEl);

  logsEl.append(entry);
  while (logsEl.childElementCount > MAX_LOG_ENTRIES) {
    logsEl.firstElementChild?.remove();
  }
  logsEl.scrollTop = logsEl.scrollHeight;
};

clearLogsButton?.addEventListener("click", () => {
  if (logsEl) {
    logsEl.innerHTML = '<div data-role="empty-state" class="console-empty">No messages yet.</div>';
  }
});

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console)
};

const mirrorConsole =
  (level: keyof typeof originalConsole) =>
  (...values: unknown[]) => {
    originalConsole[level](...values);
    appendLogEntry(level, values);
  };

console.log = mirrorConsole("log");
console.info = mirrorConsole("info");
console.warn = mirrorConsole("warn");
console.error = mirrorConsole("error");
console.debug = mirrorConsole("debug");

window.addEventListener("error", (event) => {
  const error = event.error instanceof Error ? event.error : event.message;
  appendLogEntry("error", ["[window.error]", error]);
});

window.addEventListener("unhandledrejection", (event) => {
  appendLogEntry("error", ["[unhandledrejection]", event.reason]);
});

const channelName = new URL(window.location.href).searchParams.get("channel");
if (!channelName) {
  throw new Error("Missing fiber host channel");
}

if (statusEl) {
  statusEl.textContent = "listening";
}

if (channelEl) {
  channelEl.textContent = channelName;
}

console.log("[fiber-host] page loaded", {
  href: window.location.href,
  channelName
});

const channel = new BroadcastChannel(channelName);
const fiber = new FiberWasmManager({
  secretStorageKey: "fiber-wallet-demo:fiber-key-pair",
  databasePrefix: "/wasm-fiber-wallet-demo",
  logLevel: "debug"
});

let isFiberStarted = false;
let isFiberStarting = false;

const ensureStarted = async (nativeAddress: string): Promise<void> => {
  console.log("[fiber-host] ensureStarted called", {
    nativeAddress,
    isFiberStarted,
    isFiberStarting
  });

  if (isFiberStarted || isFiberStarting) {
    while (isFiberStarting) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return;
  }

  isFiberStarting = true;
  try {
    console.log("[fiber-host] starting wasm fiber");
    await fiber.start();
    console.log("[fiber-host] wasm fiber started");
    const relayInfo = fiber.parseRelayInfo(nativeAddress);
    console.log("[fiber-host] connecting peer", relayInfo);
    await fiber.connectPeer(relayInfo);
    console.log("[fiber-host] peer connected", relayInfo);
    isFiberStarted = true;
  } finally {
    isFiberStarting = false;
  }
};

const sendResponse = (response: FiberHostResponse) => {
  console.log("[fiber-host] sendResponse", response);
  channel.postMessage(response);
};

const handlers: {
  [K in FiberHostAction]: (payload: FiberHostRequestMap[K]["payload"]) => Promise<FiberHostRequestMap[K]["result"]>;
} = {
  async startFiberNode(payload) {
    await ensureStarted(payload.nativeAddress);
    return {
      channels: await fiber.listChannels()
    };
  },
  async listChannels() {
    return {
      channels: await fiber.listChannels()
    };
  },
  async shutdownChannel(payload) {
    await fiber.shutdownChannel(payload.channelId);
    return { ok: true };
  },
  async openChannelWithExternalFunding(payload) {
    return fiber.openChannelWithExternalFunding(payload);
  },
  async submitSignedFundingTx(payload) {
    await fiber.submitSignedFundingTx(payload.channelId, payload.signedTx);
    return { ok: true };
  }
};

channel.addEventListener("message", (event: MessageEvent<FiberHostRequest | FiberHostControlMessage>) => {
  const message = event.data;
  if (!message) {
    return;
  }

  if (message.kind === "dispose") {
    console.log("[fiber-host] received dispose signal");
    window.close();
    return;
  }

  if (message.kind !== "request") {
    return;
  }

  console.log("[fiber-host] received request", message);

  void (async () => {
    try {
      const handler = handlers[message.action];
      const result = await handler(message.payload as never);
      sendResponse({
        kind: "response",
        requestId: message.requestId,
        ok: true,
        result
      });
    } catch (error) {
      sendResponse({
        kind: "response",
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
      console.error("[fiber-host] request failed", {
        requestId: message.requestId,
        action: message.action,
        error
      });
    }
  })();
});

console.log("[fiber-host] posting ready");
channel.postMessage({
  kind: "ready"
} satisfies FiberHostReady);
