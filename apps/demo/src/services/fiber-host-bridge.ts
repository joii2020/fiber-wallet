/**
 * Fiber Host Bridge 服务
 * 负责与 fiber-host 窗口的通信
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
  FIBER_HOST_READY_TIMEOUT,
  FIBER_HOST_POPUP_WIDTH,
  FIBER_HOST_POPUP_HEIGHT
} from "../config/constants";
import { createRequestId } from "../utils/format";
import { closePopupQuietly } from "../utils/dom";

export class FiberHostBridge {
  private channel: BroadcastChannel;
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
  private popup: Window | null = null;
  private fiberHostUrl: string;

  constructor() {
    this.channelName = createRequestId(FIBER_HOST_CHANNEL_PREFIX);
    this.channel = new BroadcastChannel(this.channelName);
    
    const fiberHostUrlObject = new URL("../fiber-host.html", import.meta.url);
    fiberHostUrlObject.searchParams.set("channel", this.channelName);
    this.fiberHostUrl = fiberHostUrlObject.toString();

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.setupChannelListener();
    this.setupPageLifecycleHandlers();
  }

  /**
   * 设置 BroadcastChannel 消息监听
   */
  private setupChannelListener(): void {
    this.channel.addEventListener("message", (event: MessageEvent<FiberHostResponse | FiberHostReady>) => {
      const message = event.data;
      if (!message) return;

      console.log("[FiberHostBridge] received message", message);

      if (message.kind === "ready") {
        this.isReady = true;
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
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
    });
  }

  /**
   * 设置页面生命周期监听，用于关闭弹窗
   */
  private setupPageLifecycleHandlers(): void {
    const cleanup = () => {
      this.dispose();
    };
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("beforeunload", cleanup);
  }

  /**
   * 打开 Fiber Host 弹窗
   */
  openPopup(): Window {
    console.log("[FiberHostBridge] opening fiber host window", { url: this.fiberHostUrl });
    
    const width = FIBER_HOST_POPUP_WIDTH;
    const height = FIBER_HOST_POPUP_HEIGHT;
    const popup = window.open(this.fiberHostUrl, "fiber-host", `popup=yes,width=${width},height=${height}`);
    
    if (!popup) {
      throw new Error("Unable to open Fiber host window. Please allow popups and try again.");
    }

    this.popup = popup;
    console.log("[FiberHostBridge] fiber host window opened");
    return popup;
  }

  /**
   * 等待 Fiber Host 准备就绪
   */
  private async waitForReady(): Promise<void> {
    if (this.isReady) {
      console.log("[FiberHostBridge] fiber host already ready");
      return;
    }

    console.log("[FiberHostBridge] waiting for fiber host ready");

    await Promise.race([
      this.readyPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Fiber host did not become ready. Check the Fiber host window for errors."));
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
    await this.waitForReady();

    const requestId = createRequestId(action);
    const request: FiberHostRequest = {
      kind: "request",
      requestId,
      action,
      payload
    };

    console.log("[FiberHostBridge] sending request", request);

    return new Promise<FiberHostRequestMap[K]["result"]>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as FiberHostRequestMap[K]["result"]),
        reject
      });
      this.channel.postMessage(request);
    });
  }

  /**
   * 获取弹窗引用（用于外部关闭）
   */
  getPopup(): Window | null {
    return this.popup;
  }

  /**
   * 清理资源
   */
  dispose(): void {
    const message: FiberHostControlMessage = { kind: "dispose" };
    this.channel.postMessage(message);
    closePopupQuietly(this.popup);
    this.popup = null;
  }

  /**
   * 获取 channel 名称（用于调试）
   */
  getChannelName(): string {
    return this.channelName;
  }
}

// 单例实例
let bridgeInstance: FiberHostBridge | null = null;

export function getFiberHostBridge(): FiberHostBridge {
  if (!bridgeInstance) {
    bridgeInstance = new FiberHostBridge();
  }
  return bridgeInstance;
}

export function resetFiberHostBridge(): void {
  bridgeInstance?.dispose();
  bridgeInstance = null;
}
