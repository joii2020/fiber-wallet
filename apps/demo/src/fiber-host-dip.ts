/**
 * Fiber Host - Document-Isolation-Policy (DIP) 版本
 * 
 * 此版本使用 DIP 替代 COOP/COEP，支持两种模式：
 * 1. Iframe 模式：作为 iframe 嵌入父页面，无弹窗拦截问题
 * 2. 弹窗模式：传统 window.open，但保持 opener 引用
 * 
 * 通信方式：
 * - Iframe 模式：使用 window.parent.postMessage
 * - 弹窗模式：使用 BroadcastChannel 或 window.opener.postMessage
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

// 检测运行模式
const isIframeMode = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // 跨域情况下也认为是 iframe
  }
};

/**
 * Console UI 管理器
 */
class ConsoleUI {
  private logsEl: HTMLDivElement;
  private statusEl: HTMLParagraphElement;
  private channelEl: HTMLSpanElement;
  private modeEl: HTMLSpanElement;
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

    const mode = isIframeMode() ? "iframe" : "popup";
    const dipStatus = window.crossOriginIsolated ? "isolated" : "not-isolated";

    app.innerHTML = `
      <main class="host-shell">
        <section class="console-panel">
          <div class="console-toolbar">
            <span class="console-title">Console</span>
            <div class="bar-actions">
              <span class="pill" data-role="host-mode" title="Running mode">${mode}</span>
              <span class="pill" data-role="dip-status" title="Cross-Origin Isolation">${dipStatus}</span>
              <span class="pill" data-role="host-channel">Waiting for channel...</span>
              <button type="button" data-role="clear-logs" class="tool-button">Clear console</button>
            </div>
          </div>
          <div class="console-meta">
            <span><strong>Fiber Host (DIP)</strong> runtime output</span>
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
    this.modeEl = app.querySelector<HTMLSpanElement>("[data-role='host-mode']")!;

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

    // 打印 DIP 状态信息
    console.log("[fiber-host-dip] Mode:", mode);
    console.log("[fiber-host-dip] Cross-Origin Isolated:", window.crossOriginIsolated);
    console.log("[fiber-host-dip] Document-Isolation-Policy active");
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
    this.logsEl.querySelector<HTMLElement>("[data-role='empty-state']")?.remove();

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
 * Fiber Host DIP 主类
 */
class FiberHostDip {
  private consoleUI: ConsoleUI;
  private channel: BroadcastChannel | null = null;
  private channelName: string;
  private fiber: FiberWasmManager;
  private isStarted = false;
  private isStarting = false;
  private iframeMode: boolean;

  constructor() {
    // 检测运行模式
    this.iframeMode = isIframeMode();

    // 初始化 UI
    this.consoleUI = new ConsoleUI();

    // 获取 channel name
    const channelName = new URL(window.location.href).searchParams.get("channel");
    if (!channelName) {
      throw new Error("Missing fiber host channel");
    }
    this.channelName = channelName;

    this.consoleUI.setChannel(channelName);
    this.consoleUI.setStatus("listening");

    // 初始化 Fiber
    this.fiber = new FiberWasmManager({
      secretStorageKey: "fiber-wallet-demo:fiber-key-pair",
      databasePrefix: "/wasm-fiber-wallet-demo-dip",
      logLevel: "info"
    });

    // 设置消息监听
    this.setupMessageHandler();

    // 发送 ready 信号
    this.sendReady();
  }

  /**
   * 发送 ready 信号
   */
  private sendReady(): void {
    console.log("[fiber-host-dip] posting ready");
    const readyMessage: FiberHostReady = { kind: "ready" };

    if (this.iframeMode && window.parent) {
      // Iframe 模式：使用 postMessage 通知父窗口
      window.parent.postMessage(
        { ...readyMessage, channel: this.channelName, source: "fiber-host-dip" },
        "*"
      );
    }

    // 同时尝试 BroadcastChannel（兼容弹窗模式）
    if (!this.channel) {
      this.channel = new BroadcastChannel(this.channelName);
    }
    this.channel.postMessage(readyMessage);
  }

  /**
   * 设置消息监听
   */
  private setupMessageHandler(): void {
    // Iframe 模式：监听 postMessage
    if (this.iframeMode) {
      window.addEventListener("message", (event) => {
        // 安全检查：验证消息来源
        if (event.origin !== window.location.origin) {
          console.warn("[fiber-host-dip] Ignored message from:", event.origin);
          return;
        }

        const message = event.data;
        if (!message || message.source === "fiber-host-dip") return;

        this.handleMessage(message as FiberHostRequest | FiberHostControlMessage);
      });
    }

    // BroadcastChannel 监听（兼容弹窗模式）
    if (!this.channel) {
      this.channel = new BroadcastChannel(this.channelName);
    }
    this.channel.addEventListener("message", (event: MessageEvent<FiberHostRequest | FiberHostControlMessage>) => {
      const message = event.data;
      this.handleMessage(message);
    });
  }

  /**
   * 处理消息
   */
  private handleMessage(message: FiberHostRequest | FiberHostControlMessage): void {
    if (!message) return;

    if (message.kind === "dispose") {
      console.log("[fiber-host-dip] received dispose signal");
      if (this.iframeMode) {
        // Iframe 模式：通知父窗口清理
        window.parent?.postMessage(
          { kind: "disposed", channel: this.channelName, source: "fiber-host-dip" },
          "*"
        );
      } else {
        window.close();
      }
      return;
    }

    if (message.kind !== "request") return;

    console.log("[fiber-host-dip] received request", message);
    this.handleRequest(message);
  }

  /**
   * 处理请求
   */
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
      console.error("[fiber-host-dip] request failed", {
        requestId: request.requestId,
        action: request.action,
        error
      });
    }
  }

  /**
   * 发送响应
   */
  private sendResponse(response: FiberHostResponse): void {
    console.log("[fiber-host-dip] sendResponse", response);

    if (this.iframeMode && window.parent) {
      // Iframe 模式
      window.parent.postMessage(
        { ...response, channel: this.channelName, source: "fiber-host-dip" },
        "*"
      );
    }

    // BroadcastChannel
    this.channel?.postMessage(response);
  }

  /**
   * 执行动作
   */
  private async executeAction(
    action: FiberHostAction,
    payload: unknown
  ): Promise<unknown> {
    switch (action) {
      case "startFiberNode":
        return this.startFiberNode(
          (payload as FiberHostRequestMap["startFiberNode"]["payload"]).nativeAddress
        );
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

  /**
   * 启动 Fiber 节点
   */
  private async startFiberNode(nativeAddress: string): Promise<{ channels: import("@nervosnetwork/fiber-js").Channel[] }> {
    console.log("[fiber-host-dip] startFiberNode called", { 
      nativeAddress, 
      isStarted: this.isStarted, 
      isStarting: this.isStarting,
      crossOriginIsolated: window.crossOriginIsolated 
    });

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
      console.log("[fiber-host-dip] starting wasm fiber");
      await this.fiber.start();
      console.log("[fiber-host-dip] wasm fiber started");

      const relayInfo = this.fiber.parseRelayInfo(nativeAddress);
      console.log("[fiber-host-dip] connecting peer", relayInfo);
      await this.fiber.connectPeer(relayInfo);
      console.log("[fiber-host-dip] peer connected", relayInfo);

      this.isStarted = true;
      return { channels: await this.fiber.listChannels() };
    } finally {
      this.isStarting = false;
    }
  }
}

// 检查是否需要跨源隔离
const checkIsolation = (): boolean => {
  const isIsolated = window.crossOriginIsolated;
  
  if (!isIsolated) {
    console.warn("[fiber-host-dip] ==================================================");
    console.warn("[fiber-host-dip] ⚠️  WARNING: Not cross-origin isolated!");
    console.warn("[fiber-host-dip] Document-Isolation-Policy may not be active.");
    console.warn("[fiber-host-dip] Some features (like SharedArrayBuffer) may fail.");
    console.warn("[fiber-host-dip] ==================================================");
    
    // 在页面显示警告
    const warningDiv = document.createElement("div");
    warningDiv.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #fff3cd;
      color: #856404;
      padding: 12px 20px;
      font-size: 14px;
      z-index: 10000;
      border-bottom: 1px solid #ffc107;
    `;
    warningDiv.innerHTML = `
      <strong>⚠️ Document-Isolation-Policy 未激活</strong><br>
      需要 Chrome 137+ 才能启用 DIP。某些功能可能无法正常工作。
      <a href="chrome://flags/#document-isolation-policy" target="_blank" style="color: #856404; text-decoration: underline;">
        点击启用实验标志
      </a>
      或
      <a href="./" style="color: #856404; text-decoration: underline;">切换回弹窗模式</a>
    `;
    document.body.appendChild(warningDiv);
    
    // 调整 app 位置
    const app = document.querySelector<HTMLDivElement>("#app");
    if (app) {
      app.style.marginTop = "60px";
    }
  }
  
  return isIsolated;
};

// 启动
try {
  checkIsolation();
  new FiberHostDip();
} catch (error) {
  console.error("[fiber-host-dip] initialization failed:", error);
  document.body.innerHTML = `<pre style="color:red;padding:20px;">Failed to initialize Fiber Host (DIP): ${error instanceof Error ? error.message : String(error)}</pre>`;
}
