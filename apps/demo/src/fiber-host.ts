/**
 * Fiber Host - WASM Fiber 节点运行环境
 * 
 * 独立窗口运行，通过 BroadcastChannel 与主页面通信
 */

import "./styles/fiber-host.css";
import { Buffer } from "buffer/";
import { FiberWasmManager } from "@fiber-wallet/shared";
import type {
  FiberHostAction,
  FiberHostRequestMap,
  FiberHostRequest,
  FiberHostResponse,
  FiberHostReady,
  FiberHostControlMessage
} from "./types/fiber";

// Polyfills
if (!("global" in globalThis)) {
  (globalThis as typeof globalThis & { global: typeof globalThis }).global = globalThis;
}
if (!("Buffer" in globalThis)) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

/**
 * Console UI 管理器
 */
class ConsoleUI {
  private logsEl: HTMLDivElement;
  private statusEl: HTMLParagraphElement;
  private channelEl: HTMLSpanElement;
  private maxEntries = 400;
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };

  constructor() {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) {
      throw new Error("Missing #app element");
    }

    app.innerHTML = `
      <main class="host-shell">
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

    this.logsEl = app.querySelector<HTMLDivElement>("[data-role='host-logs']")!;
    this.statusEl = app.querySelector<HTMLParagraphElement>("[data-role='host-status']")!;
    this.channelEl = app.querySelector<HTMLSpanElement>("[data-role='host-channel']")!;

    // 绑定清除按钮
    app.querySelector<HTMLButtonElement>("[data-role='clear-logs']")?.addEventListener("click", () => {
      this.clear();
    });

    // 保存原始 console
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console)
    };

    // 劫持 console
    this.hijackConsole();

    // 全局错误处理
    window.addEventListener("error", (event) => {
      const error = event.error instanceof Error ? event.error : event.message;
      this.append("error", ["[window.error]", error]);
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.append("error", ["[unhandledrejection]", event.reason]);
    });
  }

  setStatus(status: string): void {
    this.statusEl.textContent = status;
  }

  setChannel(name: string): void {
    this.channelEl.textContent = name;
  }

  clear(): void {
    this.logsEl.innerHTML = '<div data-role="empty-state" class="console-empty">No messages yet.</div>';
  }

  private hijackConsole(): void {
    const mirror = (level: keyof typeof this.originalConsole) => (...values: unknown[]) => {
      this.originalConsole[level](...values);
      this.append(level, values);
    };

    console.log = mirror("log");
    console.info = mirror("info");
    console.warn = mirror("warn");
    console.error = mirror("error");
    console.debug = mirror("debug");
  }

  private append(level: "log" | "info" | "warn" | "error" | "debug", values: unknown[]): void {
    this.logsEl.querySelector<HTMLElement>("[data-role='empty-state]")?.remove();

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

    const message = values.map((v) => this.formatValue(v)).join(" ");
    const icons: Record<typeof level, string> = {
      log: ">",
      info: "i",
      warn: "!",
      error: "x",
      debug: "~"
    };

    entry.className = `console-row ${level}`;
    icon.className = "console-icon";
    icon.textContent = icons[level];
    timeEl.className = "console-time";
    timeEl.textContent = time;
    messageEl.className = "console-message";
    messageEl.textContent = message;

    entry.append(icon, timeEl, messageEl);
    this.logsEl.append(entry);

    // 限制条目数
    while (this.logsEl.childElementCount > this.maxEntries) {
      this.logsEl.firstElementChild?.remove();
    }

    this.logsEl.scrollTop = this.logsEl.scrollHeight;
  }

  private formatValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    if (typeof value === "bigint") return `${value}n`;

    try {
      return JSON.stringify(
        value,
        (_, v) => (typeof v === "bigint" ? `${v}n` : v),
        2
      );
    } catch {
      return String(value);
    }
  }
}

/**
 * Fiber Host 主类
 */
class FiberHost {
  private consoleUI: ConsoleUI;
  private channel: BroadcastChannel;
  private fiber: FiberWasmManager;
  private isStarted = false;
  private isStarting = false;

  constructor() {
    // 初始化 UI
    this.consoleUI = new ConsoleUI();

    // 获取 channel name
    const channelName = new URL(window.location.href).searchParams.get("channel");
    if (!channelName) {
      throw new Error("Missing fiber host channel");
    }

    this.consoleUI.setChannel(channelName);
    this.consoleUI.setStatus("listening");

    // 初始化 channel
    this.channel = new BroadcastChannel(channelName);

    // 初始化 Fiber
    this.fiber = new FiberWasmManager({
      secretStorageKey: "fiber-wallet-demo:fiber-key-pair",
      databasePrefix: "/wasm-fiber-wallet-demo",
      logLevel: "info"
    });

    // 设置消息监听
    this.setupMessageHandler();

    // 发送 ready 信号
    console.log("[fiber-host] posting ready");
    const readyMessage: FiberHostReady = { kind: "ready" };
    this.channel.postMessage(readyMessage);
  }

  private setupMessageHandler(): void {
    this.channel.addEventListener("message", (event: MessageEvent<FiberHostRequest | FiberHostControlMessage>) => {
      const message = event.data;
      if (!message) return;

      if (message.kind === "dispose") {
        console.log("[fiber-host] received dispose signal");
        window.close();
        return;
      }

      if (message.kind !== "request") return;

      console.log("[fiber-host] received request", message);
      this.handleRequest(message);
    });
  }

  private async handleRequest(request: FiberHostRequest): Promise<void> {
    try {
      const result = await this.executeAction(request.action, request.payload);
      this.sendResponse({
        kind: "response",
        requestId: request.requestId,
        ok: true,
        result
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendResponse({
        kind: "response",
        requestId: request.requestId,
        ok: false,
        error: errorMessage
      });
      console.error("[fiber-host] request failed", {
        requestId: request.requestId,
        action: request.action,
        error
      });
    }
  }

  private sendResponse(response: FiberHostResponse): void {
    console.log("[fiber-host] sendResponse", response);
    this.channel.postMessage(response);
  }

  private async executeAction(
    action: FiberHostAction,
    payload: unknown
  ): Promise<unknown> {
    switch (action) {
      case "startFiberNode":
        return this.startFiberNode((payload as { nativeAddress: string }).nativeAddress);
      case "listChannels":
        return { channels: await this.fiber.listChannels() };
      case "shutdownChannel":
        await this.fiber.shutdownChannel((payload as { channelId: string }).channelId);
        return { ok: true };
      case "openChannelWithExternalFunding":
        return this.fiber.openChannelWithExternalFunding(payload as FiberHostRequestMap["openChannelWithExternalFunding"]["payload"]);
      case "submitSignedFundingTx": {
        const p = payload as { channelId: string; signedTx: import("@nervosnetwork/fiber-js").CkbJsonRpcTransaction };
        await this.fiber.submitSignedFundingTx(p.channelId, p.signedTx);
        return { ok: true };
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async startFiberNode(nativeAddress: string): Promise<{ channels: import("@nervosnetwork/fiber-js").Channel[] }> {
    console.log("[fiber-host] startFiberNode called", { nativeAddress, isStarted: this.isStarted, isStarting: this.isStarting });

    if (this.isStarted) {
      return { channels: await this.fiber.listChannels() };
    }

    if (this.isStarting) {
      // 等待启动完成
      while (this.isStarting) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { channels: await this.fiber.listChannels() };
    }

    this.isStarting = true;
    try {
      console.log("[fiber-host] starting wasm fiber");
      await this.fiber.start();
      console.log("[fiber-host] wasm fiber started");

      const relayInfo = this.fiber.parseRelayInfo(nativeAddress);
      console.log("[fiber-host] connecting peer", relayInfo);
      await this.fiber.connectPeer(relayInfo);
      console.log("[fiber-host] peer connected", relayInfo);

      this.isStarted = true;
      return { channels: await this.fiber.listChannels() };
    } finally {
      this.isStarting = false;
    }
  }
}

// 启动
try {
  new FiberHost();
} catch (error) {
  console.error("[fiber-host] initialization failed:", error);
  document.body.innerHTML = `<pre style="color:red;padding:20px;">Failed to initialize Fiber Host: ${error instanceof Error ? error.message : String(error)}</pre>`;
}
