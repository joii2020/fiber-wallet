/**
 * Fiber Host - WASM Fiber 节点运行环境
 * 
 * 支持两种模式：
 * 1. 弹窗模式（Popup）：独立窗口运行，通过 BroadcastChannel 通信
 * 2. Iframe 模式（DIP）：作为 iframe 嵌入，使用 postMessage + BroadcastChannel
 * 
 * 模式检测：
 * - 自动检测是否在 iframe 中运行（window.self !== window.top）
 * - DIP 模式支持跨源隔离环境（crossOriginIsolated）
 */

import "./styles/fiber-host.css";
import { Buffer } from "buffer/";
import { FiberWasmManager } from "@fiber-wallet/shared";
import type {
  FiberHostAction,
  FiberHostRequestMap,
  FiberHostRequest,
  FiberHostResponse,
  FiberHostControlMessage
} from "./types/fiber";
import { ConsoleUI } from "./components/console-ui";

// Polyfills
if (!("global" in globalThis)) {
  (globalThis as typeof globalThis & { global: typeof globalThis }).global = globalThis;
}
if (!("Buffer" in globalThis)) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

/**
 * 检测是否在 iframe 中运行
 */
const isIframeMode = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // 跨域情况下也认为是 iframe
  }
};

/**
 * Fiber Host 主类
 */
class FiberHost {
  private consoleUI: ConsoleUI;
  private channel: BroadcastChannel | null = null;
  private channelName: string;
  private fiber: FiberWasmManager;
  private isStarted = false;
  private isStarting = false;
  private iframeMode: boolean;

  private get messageSource(): string {
    return this.iframeMode ? "fiber-host-dip" : "fiber-host";
  }

  constructor() {
    // 检测运行模式
    this.iframeMode = isIframeMode();

    // 初始化 UI
    this.consoleUI = new ConsoleUI({
      mode: this.iframeMode ? "iframe" : "popup",
      showIsolationStatus: this.iframeMode
    });

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
      databasePrefix: this.iframeMode ? "/wasm-fiber-wallet-dip" : "/wasm-fiber-wallet-demo",
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
    console.log(`[fiber-host] posting ready (mode: ${this.iframeMode ? "iframe" : "popup"})`);
    const readyMessage = { kind: "ready" as const };

    if (this.iframeMode && window.parent) {
      // Iframe 模式：使用 postMessage 通知父窗口
      window.parent.postMessage(
        { ...readyMessage, channel: this.channelName, source: this.messageSource },
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
          console.warn("[fiber-host] Ignored message from:", event.origin);
          return;
        }

        const message = event.data;
        if (!message || message.source === "fiber-host") return;

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
      console.log("[fiber-host] received dispose signal");
      if (this.iframeMode) {
        // Iframe 模式：通知父窗口清理
        window.parent?.postMessage(
          { kind: "disposed", channel: this.channelName, source: this.messageSource },
          "*"
        );
      } else {
        window.close();
      }
      return;
    }

    if (message.kind !== "request") return;

    console.log("[fiber-host] received request", message);
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
      console.error("[fiber-host] request failed", {
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
    console.log("[fiber-host] sendResponse", response);

    if (this.iframeMode && window.parent) {
      // Iframe 模式
      window.parent.postMessage(
        { ...response, channel: this.channelName, source: this.messageSource },
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
    console.log("[fiber-host] startFiberNode called", {
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
      console.log("[fiber-host] starting wasm fiber");
      const startTime = Date.now();
      await this.fiber.start();
      console.log(`[fiber-host] wasm fiber started, took ${Date.now() - startTime}ms`);

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

/**
 * 检查跨源隔离状态（仅在 iframe 模式下显示警告）
 */
const checkIsolation = (): void => {
  // 检查是否支持 SharedArrayBuffer（DIP 或传统的 crossOriginIsolated 都可以）
  let isIsolated = window.crossOriginIsolated;
  
  // 如果 crossOriginIsolated 为 false，测试 SharedArrayBuffer 是否实际可用（DIP 模式）
  if (!isIsolated) {
    try {
      new SharedArrayBuffer(1);
      isIsolated = true;
    } catch {
      isIsolated = false;
    }
  }

  if (!isIsolated && isIframeMode()) {
    console.warn("[fiber-host] ==================================================");
    console.warn("[fiber-host] ⚠️  WARNING: Not cross-origin isolated!");
    console.warn("[fiber-host] Document-Isolation-Policy may not be active.");
    console.warn("[fiber-host] Some features (like SharedArrayBuffer) may fail.");
    console.warn("[fiber-host] ==================================================");

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
};

// 启动
try {
  checkIsolation();
  new FiberHost();
} catch (error) {
  console.error("[fiber-host] initialization failed:", error);
  document.body.innerHTML = `<pre style="color:red;padding:20px;">Failed to initialize Fiber Host: ${error instanceof Error ? error.message : String(error)}</pre>`;
}
