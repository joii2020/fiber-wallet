/**
 * Fiber Host - WASM Fiber Node Runtime Environment
 * 
 * Supports two modes:
 * 1. Popup Mode: Runs in independent window, communicates via BroadcastChannel
 * 2. Iframe Mode (DIP): Embedded as iframe, uses postMessage + BroadcastChannel
 * 
 * Mode Detection:
 * - Automatically detects if running in iframe (window.self !== window.top)
 * - DIP mode supports cross-origin isolation environment (crossOriginIsolated)
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
 * Detect if running in iframe
 */
const isIframeMode = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // Also consider iframe in cross-origin cases
  }
};

/**
 * Fiber Host main class
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
    // Detect running mode
    this.iframeMode = isIframeMode();

    // Initialize UI
    this.consoleUI = new ConsoleUI({
      mode: this.iframeMode ? "iframe" : "popup",
      showIsolationStatus: this.iframeMode
    });

    // Get channel name
    const channelName = new URL(window.location.href).searchParams.get("channel");
    if (!channelName) {
      throw new Error("Missing fiber host channel");
    }
    this.channelName = channelName;

    this.consoleUI.setChannel(channelName);
    this.consoleUI.setStatus("listening");

    // Initialize Fiber
    this.fiber = new FiberWasmManager({
      secretStorageKey: "fiber-wallet-demo:fiber-key-pair",
      databasePrefix: this.iframeMode ? "/wasm-fiber-wallet-dip" : "/wasm-fiber-wallet-demo",
      logLevel: "info"
    });

    // Setup message handler
    this.setupMessageHandler();

    // Send ready signal
    this.sendReady();
  }

  /**
   * Send ready signal
   */
  private sendReady(): void {
    console.log(`[fiber-host] posting ready (mode: ${this.iframeMode ? "iframe" : "popup"})`);
    const readyMessage = { kind: "ready" as const };

    if (this.iframeMode && window.parent) {
      // Iframe mode: Use postMessage to notify parent window
      window.parent.postMessage(
        { ...readyMessage, channel: this.channelName, source: this.messageSource },
        "*"
      );
    }

    // Also try BroadcastChannel (compatible with popup mode)
    if (!this.channel) {
      this.channel = new BroadcastChannel(this.channelName);
    }
    this.channel.postMessage(readyMessage);
  }

  /**
   * Setup message handler
   */
  private setupMessageHandler(): void {
    // Iframe mode: Listen for postMessage
    if (this.iframeMode) {
      window.addEventListener("message", (event) => {
        // Security check: Verify message source
        if (event.origin !== window.location.origin) {
          console.warn("[fiber-host] Ignored message from:", event.origin);
          return;
        }

        const message = event.data;
        if (!message || message.source === "fiber-host") return;

        this.handleMessage(message as FiberHostRequest | FiberHostControlMessage);
      });
    }

    // BroadcastChannel listener (compatible with popup mode)
    if (!this.channel) {
      this.channel = new BroadcastChannel(this.channelName);
    }
    this.channel.addEventListener("message", (event: MessageEvent<FiberHostRequest | FiberHostControlMessage>) => {
      const message = event.data;
      this.handleMessage(message);
    });
  }

  /**
   * Handle message
   */
  private handleMessage(message: FiberHostRequest | FiberHostControlMessage): void {
    if (!message) return;

    if (message.kind === "dispose") {
      console.log("[fiber-host] received dispose signal");
      if (this.iframeMode) {
        // Iframe mode: Notify parent window to cleanup
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
   * Handle request
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
   * Send response
   */
  private sendResponse(response: FiberHostResponse): void {
    console.log("[fiber-host] sendResponse", response);

    if (this.iframeMode && window.parent) {
      // Iframe mode
      window.parent.postMessage(
        { ...response, channel: this.channelName, source: this.messageSource },
        "*"
      );
    }

    // BroadcastChannel
    this.channel?.postMessage(response);
  }

  /**
   * Execute action
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
   * Start Fiber node
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
      // Wait for startup to complete
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
 * Check cross-origin isolation status (only show warning in iframe mode)
 */
const checkIsolation = (): void => {
  // Check if SharedArrayBuffer is supported (either DIP or traditional crossOriginIsolated)
  let isIsolated = window.crossOriginIsolated;
  
  // If crossOriginIsolated is false, test if SharedArrayBuffer is actually available (DIP mode)
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

    // Display warning on page
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
      <strong>⚠️ Document-Isolation-Policy not activated</strong><br>
      Chrome 137+ is required to enable DIP. Some features may not work properly.
      <a href="chrome://flags/#document-isolation-policy" target="_blank" style="color: #856404; text-decoration: underline;">
        Click to enable experimental flag
      </a>
      or
      <a href="./" style="color: #856404; text-decoration: underline;">Switch back to popup mode</a>
    `;
    document.body.appendChild(warningDiv);

    // Adjust app position
    const app = document.querySelector<HTMLDivElement>("#app");
    if (app) {
      app.style.marginTop = "60px";
    }
  }
};

// Start
try {
  checkIsolation();
  new FiberHost();
} catch (error) {
  console.error("[fiber-host] initialization failed:", error);
  document.body.innerHTML = `<pre style="color:red;padding:20px;">Failed to initialize Fiber Host: ${error instanceof Error ? error.message : String(error)}</pre>`;
}
