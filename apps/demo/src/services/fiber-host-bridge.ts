/**
 * Fiber Host Bridge 服务 - BroadcastChannel 实现
 * 
 * 使用 BroadcastChannel 与 fiber-host 窗口通信
 * 适用于同源的弹窗模式
 */

import { FiberHostBridgeBase } from "./fiber-host-bridge-base";
import type {
  FiberHostResponse,
  FiberHostReady
} from "../types/fiber";
import {
  FIBER_HOST_CHANNEL_PREFIX,
  FIBER_HOST_POPUP_WIDTH,
  FIBER_HOST_POPUP_HEIGHT
} from "../config/constants";
import { closePopupQuietly } from "../utils/dom";

export interface PopupBridgeOptions {
  /** fiber-host 页面 URL */
  hostUrl?: string;
  /** 弹窗宽度 */
  width?: number;
  /** 弹窗高度 */
  height?: number;
}

export class FiberHostBridge extends FiberHostBridgeBase {
  private channel: BroadcastChannel;
  private popup: Window | null = null;
  private fiberHostUrl: string;
  private popupOptions: Required<PopupBridgeOptions>;

  constructor(options: PopupBridgeOptions = {}) {
    super({ channelPrefix: FIBER_HOST_CHANNEL_PREFIX });

    this.popupOptions = {
      hostUrl: "../fiber-host.html",
      width: FIBER_HOST_POPUP_WIDTH,
      height: FIBER_HOST_POPUP_HEIGHT,
      ...options
    };

    // 初始化 BroadcastChannel
    this.channel = new BroadcastChannel(this.channelName);

    // 构建 fiber-host URL
    const fiberHostUrlObject = new URL(this.popupOptions.hostUrl, import.meta.url);
    fiberHostUrlObject.searchParams.set("channel", this.channelName);
    this.fiberHostUrl = fiberHostUrlObject.toString();

    this.setupChannelListener();
  }

  /**
   * 设置 BroadcastChannel 消息监听
   */
  private setupChannelListener(): void {
    this.channel.addEventListener("message", (event: MessageEvent<FiberHostResponse | FiberHostReady>) => {
      const message = event.data;
      if (!message) return;

      console.log("[FiberHostBridge] received message", message);

      this.handleReadyMessage(message as FiberHostReady);
      this.handleResponseMessage(message as FiberHostResponse);
    });
  }

  /**
   * 打开 Fiber Host 弹窗
   */
  openPopup(): Window {
    console.log("[FiberHostBridge] opening fiber host window", { url: this.fiberHostUrl });
    
    const { width, height } = this.popupOptions;
    const popup = window.open(this.fiberHostUrl, "fiber-host", `popup=yes,width=${width},height=${height}`);
    
    if (!popup) {
      throw new Error("Unable to open Fiber host window. Please allow popups and try again.");
    }

    this.popup = popup;
    console.log("[FiberHostBridge] fiber host window opened");
    return popup;
  }

  /**
   * 发送请求
   */
  protected sendRequest(request: import("../types/fiber").FiberHostRequest): void {
    this.channel.postMessage(request);
  }
  /**
   * 清理资源
   */
  dispose(): void {
    // 发送 dispose 信号
    const message: import("../types/fiber").FiberHostControlMessage = { kind: "dispose" };
    this.channel.postMessage(message);
    
    closePopupQuietly(this.popup);
    this.popup = null;
    
    this.channel.close();
    
    super.dispose();
  }
}
