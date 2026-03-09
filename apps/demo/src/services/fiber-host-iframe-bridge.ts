/**
 * Fiber Host Iframe Bridge 服务 - Document-Isolation-Policy (DIP) 实现
 * 
 * 使用 Document-Isolation-Policy (DIP) + iframe 方案
 * 替代传统的 window.open 弹窗方案
 * 
 * 优势：
 * 1. 无弹窗拦截问题
 * 2. 更好的用户体验（内嵌在主页面中）
 * 3. 使用 DIP 头部启用跨源隔离，支持 SharedArrayBuffer
 * 4. 保持与 fiber-host 的通信能力
 */

import { FiberHostBridgeBase } from "./fiber-host-bridge-base";
import { FIBER_HOST_CHANNEL_PREFIX } from "../config/constants";
import type {
  FiberHostRequest,
  FiberHostResponse,
  FiberHostReady
} from "../types/fiber";

export interface IframeBridgeOptions {
  /** iframe 容器元素选择器 */
  containerSelector?: string;
  /** iframe 宽度 */
  width?: string;
  /** iframe 高度 */
  height?: string;
  /** fiber-host 页面 URL */
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

    // 构建 fiber-host URL
    const fiberHostUrlObject = new URL(this.iframeOptions.hostUrl, window.location.href);
    fiberHostUrlObject.searchParams.set("channel", this.channelName);
    this.fiberHostUrl = fiberHostUrlObject.toString();

    // 绑定消息处理器
    this.messageHandler = this.handlePostMessage.bind(this);
    this.setupMessageListener();
  }

  /**
   * 设置 postMessage 消息监听
   */
  private setupMessageListener(): void {
    window.addEventListener("message", this.messageHandler);
  }

  /**
   * 处理 postMessage 消息
   */
  private handlePostMessage(event: MessageEvent): void {
    // 安全检查：验证消息来源
    if (!this.iframe?.contentWindow) return;
    if (event.source !== this.iframe.contentWindow) return;

    const message = event.data;
    if (!message || message.source !== "fiber-host-dip") return;

    console.log("[FiberHostIframeBridge] received message", message);

    // 处理 ready 消息
    if (message.kind === "ready") {
      this.handleReadyMessage(message as FiberHostReady);
      return;
    }

    // 处理 disposed 消息
    if (message.kind === "disposed") {
      this.cleanup();
      return;
    }

    // 处理响应消息
    this.handleResponseMessage(message as FiberHostResponse);
  }

  /**
   * 创建并显示 iframe
   */
  createIframe(): HTMLIFrameElement {
    console.log("[FiberHostIframeBridge] creating iframe", { url: this.fiberHostUrl });

    // 查找或创建容器
    let container = document.querySelector<HTMLElement>(this.iframeOptions.containerSelector);
    if (!container) {
      // 自动创建容器
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

    // 创建 iframe
    this.iframe = document.createElement("iframe");
    this.iframe.src = this.fiberHostUrl;
    this.iframe.style.cssText = `
      width: ${this.iframeOptions.width};
      height: ${this.iframeOptions.height};
      border: none;
      display: block;
    `;
    this.iframe.title = "Fiber Host";

    // 添加到容器
    container.appendChild(this.iframe);

    console.log("[FiberHostIframeBridge] iframe created");
    return this.iframe;
  }

  /**
   * 显示 iframe（如果不存在则创建）
   */
  show(): void {
    if (!this.iframe) {
      this.createIframe();
    }
  }

  /**
   * 发送请求
   */
  protected sendRequest(request: FiberHostRequest): void {
    this.iframe?.contentWindow?.postMessage(
      { ...request, source: "fiber-host-parent" },
      "*"
    );
  }
  /**
   * 清理资源
   */
  dispose(): void {
    // 发送 dispose 信号
    this.iframe?.contentWindow?.postMessage(
      { kind: "dispose", source: "fiber-host-parent" },
      "*"
    );
    
    this.cleanup();
    super.dispose();
  }

  /**
   * 内部清理
   */
  private cleanup(): void {
    window.removeEventListener("message", this.messageHandler);
    
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
  }
}
