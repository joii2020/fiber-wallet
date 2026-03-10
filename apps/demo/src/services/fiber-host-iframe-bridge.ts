/**
 * Fiber Host Iframe Bridge Service - Document-Isolation-Policy (DIP) Implementation
 * 
 * Uses Document-Isolation-Policy (DIP) + iframe solution
 * Alternative to traditional window.open popup solution
 * 
 * Advantages:
 * 1. No popup blocking issues
 * 2. Better user experience (embedded in main page)
 * 3. Uses DIP headers to enable cross-origin isolation, supporting SharedArrayBuffer
 * 4. Maintains communication capability with fiber-host
 */

import { FiberHostBridgeBase } from "./fiber-host-bridge-base";
import { FIBER_HOST_CHANNEL_PREFIX } from "../config/constants";
import type {
  FiberHostRequest,
  FiberHostResponse,
  FiberHostReady
} from "../types/fiber";

export interface IframeBridgeOptions {
  /** iframe container element selector */
  containerSelector?: string;
  /** iframe width */
  width?: string;
  /** iframe height */
  height?: string;
  /** fiber-host page URL */
  hostUrl?: string;
}

export class FiberHostIframeBridge extends FiberHostBridgeBase {
  private iframe: HTMLIFrameElement | null = null;
  private fiberHostUrl: string;
  private iframeOptions: Required<IframeBridgeOptions>;
  private messageHandler: (event: MessageEvent) => void;

  constructor(options: IframeBridgeOptions = {}) {
    super({ channelPrefix: `${FIBER_HOST_CHANNEL_PREFIX}-dip` });

    this.iframeOptions = {
      containerSelector: "#fiber-host-container",
      width: "100%",
      height: "400px",
      hostUrl: "./fiber-host-dip.html",
      ...options
    };

    // Build fiber-host URL
    const fiberHostUrlObject = new URL(this.iframeOptions.hostUrl, window.location.href);
    fiberHostUrlObject.searchParams.set("channel", this.channelName);
    this.fiberHostUrl = fiberHostUrlObject.toString();

    // Bind message handler
    this.messageHandler = this.handlePostMessage.bind(this);
    this.setupMessageListener();
  }

  /**
   * Setup postMessage message listener
   */
  private setupMessageListener(): void {
    window.addEventListener("message", this.messageHandler);
  }

  /**
   * Handle postMessage
   */
  private handlePostMessage(event: MessageEvent): void {
    // Security check: verify message source
    if (!this.iframe?.contentWindow) return;
    if (event.source !== this.iframe.contentWindow) return;

    const message = event.data;
    if (!message || message.source !== "fiber-host-dip") return;

    console.log("[FiberHostIframeBridge] received message", message);

    // Handle ready message
    if (message.kind === "ready") {
      this.handleReadyMessage(message as FiberHostReady);
      return;
    }

    // Handle disposed message
    if (message.kind === "disposed") {
      this.cleanup();
      return;
    }

    // Handle response message
    this.handleResponseMessage(message as FiberHostResponse);
  }

  /**
   * Create and display iframe
   */
  createIframe(): HTMLIFrameElement {
    console.log("[FiberHostIframeBridge] creating iframe", { url: this.fiberHostUrl });

    // Find or create container
    let container = document.querySelector<HTMLElement>(this.iframeOptions.containerSelector);
    if (!container) {
      // Auto-create container
      container = document.createElement("div");
      container.id = this.iframeOptions.containerSelector.replace("#", "");
      container.style.cssText = `
        position: fixed;
        right: 0;
        bottom: 0;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
        z-index: -1;
        overflow: hidden;
      `;
      container.setAttribute("aria-hidden", "true");
      document.body.appendChild(container);
    }

    // Create iframe
    this.iframe = document.createElement("iframe");
    this.iframe.src = this.fiberHostUrl;
    this.iframe.style.cssText = `
      width: ${this.iframeOptions.width};
      height: ${this.iframeOptions.height};
      border: none;
      display: block;
    `;
    this.iframe.title = "Fiber Host";

    // Add to container
    container.appendChild(this.iframe);

    console.log("[FiberHostIframeBridge] iframe created");
    return this.iframe;
  }

  /**
   * Show iframe (create if not exists)
   */
  show(): void {
    if (!this.iframe) {
      this.createIframe();
    }
  }

  /**
   * Send request
   */
  protected sendRequest(request: FiberHostRequest): void {
    this.iframe?.contentWindow?.postMessage(
      { ...request, source: "fiber-host-parent" },
      "*"
    );
  }
  /**
   * Clean up resources
   */
  dispose(): void {
    // Send dispose signal
    this.iframe?.contentWindow?.postMessage(
      { kind: "dispose", source: "fiber-host-parent" },
      "*"
    );
    
    this.cleanup();
    super.dispose();
  }

  /**
   * Internal cleanup
   */
  private cleanup(): void {
    window.removeEventListener("message", this.messageHandler);
    
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
  }
}
