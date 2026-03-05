/**
 * Fiber Host Iframe Bridge 服务
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

import type {
  FiberHostAction,
  FiberHostRequestMap,
  FiberHostRequest,
  FiberHostResponse,
  FiberHostReady,
  FiberHostControlMessage
} from "../types/fiber";
import {
  FIBER_HOST_CHANNEL_PREFIX,
  FIBER_HOST_READY_TIMEOUT
} from "../config/constants";
import { createRequestId } from "../utils/format";

export interface IframeBridgeOptions {
  /** iframe 容器元素选择器 */
  containerSelector?: string;
  /** iframe 宽度 */
  width?: string;
  /** iframe 高度 */
  height?: string;
  /** iframe 加载超时时间（毫秒） */
  loadTimeout?: number;
  /** 
   * 是否在 DIP 未激活时仍然尝试运行
   * @default true
   */
  allowWithoutIsolation?: boolean;
}

export class FiberHostIframeBridge {
  private channelName: string;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private isReady = false;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((reason?: unknown) => void) | null = null;
  private readyPromise: Promise<void>;
  private iframe: HTMLIFrameElement | null = null;
  private fiberHostUrl: string;
  private options: Required<IframeBridgeOptions>;
  private messageHandler: (event: MessageEvent) => void;

  constructor(options: IframeBridgeOptions = {}) {
    this.options = {
      containerSelector: "#fiber-host-container",
      width: "100%",
      height: "400px",
      loadTimeout: 30000,
      allowWithoutIsolation: true,
      ...options
    };

    this.channelName = createRequestId(FIBER_HOST_CHANNEL_PREFIX);
    
    const fiberHostUrlObject = new URL("./fiber-host-dip.html", window.location.href);
    fiberHostUrlObject.searchParams.set("channel", this.channelName);
    this.fiberHostUrl = fiberHostUrlObject.toString();

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    // 绑定消息处理器
    this.messageHandler = this.handleMessage.bind(this);
    this.setupMessageListener();
    this.setupPageLifecycleHandlers();
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
  private handleMessage(event: MessageEvent): void {
    // 安全检查：验证消息来源
    if (!this.iframe?.contentWindow) return;
    if (event.source !== this.iframe.contentWindow) return;

    const message = event.data;
    if (!message || message.source !== "fiber-host-dip") return;

    console.log("[FiberHostIframeBridge] received message", message);

    if (message.kind === "ready") {
      this.isReady = true;
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }

    if (message.kind === "disposed") {
      this.cleanup();
      return;
    }

    if (message.kind !== "response") return;

    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;

    this.pendingRequests.delete(message.requestId);

    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error ?? "Fiber host request failed"));
    }
  }

  /**
   * 设置页面生命周期监听
   */
  private setupPageLifecycleHandlers(): void {
    const cleanup = () => {
      this.dispose();
    };
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("beforeunload", cleanup);
  }

  /**
   * 创建并显示 iframe
   */
  createIframe(): HTMLIFrameElement {
    console.log("[FiberHostIframeBridge] creating iframe", { url: this.fiberHostUrl });

    // 查找或创建容器
    let container = document.querySelector<HTMLElement>(this.options.containerSelector);
    if (!container) {
      // 自动创建容器
      container = document.createElement("div");
      container.id = this.options.containerSelector.replace("#", "");
      container.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 600px;
        height: 400px;
        z-index: 9999;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        background: #0d1117;
        border: 1px solid #30363d;
      `;
      document.body.appendChild(container);
    }

    // 创建 iframe
    this.iframe = document.createElement("iframe");
    this.iframe.src = this.fiberHostUrl;
    this.iframe.style.cssText = `
      width: ${this.options.width};
      height: ${this.options.height};
      border: none;
      display: block;
    `;
    this.iframe.title = "Fiber Host";
    
    // 添加加载超时处理
    const loadTimeout = setTimeout(() => {
      if (!this.isReady) {
        this.readyReject?.(new Error("Fiber host iframe load timeout"));
        this.cleanup();
      }
    }, this.options.loadTimeout);

    // 监听加载完成
    this.iframe.addEventListener("load", () => {
      clearTimeout(loadTimeout);
      console.log("[FiberHostIframeBridge] iframe loaded");
    });

    // 添加到容器
    container.appendChild(this.iframe);
    container.style.display = "block";

    console.log("[FiberHostIframeBridge] iframe created");
    return this.iframe;
  }

  /**
   * 隐藏 iframe（不销毁）
   */
  hide(): void {
    const container = document.querySelector<HTMLElement>(this.options.containerSelector);
    if (container) {
      container.style.display = "none";
    }
  }

  /**
   * 显示 iframe
   */
  show(): void {
    const container = document.querySelector<HTMLElement>(this.options.containerSelector);
    if (container) {
      container.style.display = "block";
    }
    if (!this.iframe) {
      this.createIframe();
    }
  }

  /**
   * 等待 Fiber Host 准备就绪
   */
  private async waitForReady(): Promise<void> {
    if (this.isReady) {
      console.log("[FiberHostIframeBridge] fiber host already ready");
      return;
    }

    console.log("[FiberHostIframeBridge] waiting for fiber host ready");

    await Promise.race([
      this.readyPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Fiber host did not become ready. Check the iframe for errors."));
        }, FIBER_HOST_READY_TIMEOUT);
      })
    ]);
  }

  /**
   * 调用 Fiber Host 方法
   */
  async call<K extends FiberHostAction>(
    action: K,
    payload: FiberHostRequestMap[K]["payload"]
  ): Promise<FiberHostRequestMap[K]["result"]> {
    // 确保 iframe 已创建
    if (!this.iframe) {
      this.createIframe();
    }

    await this.waitForReady();

    const requestId = createRequestId(action);
    const request: FiberHostRequest = {
      kind: "request",
      requestId,
      action,
      payload
    };

    console.log("[FiberHostIframeBridge] sending request", request);

    return new Promise<FiberHostRequestMap[K]["result"]>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as FiberHostRequestMap[K]["result"]),
        reject
      });

      // 使用 postMessage 发送请求
      this.iframe?.contentWindow?.postMessage(
        { ...request, source: "fiber-host-parent" },
        "*"
      );
    });
  }

  /**
   * 获取 iframe 元素
   */
  getIframe(): HTMLIFrameElement | null {
    return this.iframe;
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

    // 拒绝所有待处理的请求
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error("Fiber host disposed"));
    }
    this.pendingRequests.clear();
    
    this.isReady = false;
  }

  /**
   * 获取 channel 名称（用于调试）
   */
  getChannelName(): string {
    return this.channelName;
  }
}

// 单例实例
let iframeBridgeInstance: FiberHostIframeBridge | null = null;

export function getFiberHostIframeBridge(options?: IframeBridgeOptions): FiberHostIframeBridge {
  if (!iframeBridgeInstance) {
    iframeBridgeInstance = new FiberHostIframeBridge(options);
  }
  return iframeBridgeInstance;
}

export function resetFiberHostIframeBridge(): void {
  iframeBridgeInstance?.dispose();
  iframeBridgeInstance = null;
}
