/**
 * Fiber Host Bridge 抽象基类
 * 
 * 定义 Bridge 的通用接口和行为，支持多种通信方式：
 * - BroadcastChannel
 * - postMessage (iframe/跨窗口)
 * 
 * 子类需要实现具体的通信机制。
 */

import type {
  FiberHostAction,
  FiberHostRequestMap,
  FiberHostRequest,
  FiberHostResponse,
  FiberHostReady
} from "../types/fiber";
import { FIBER_HOST_READY_TIMEOUT } from "../config/constants";
import { createRequestId } from "../utils/format";

/**
 * Bridge 配置选项
 */
export interface FiberHostBridgeOptions {
  /** 准备就绪超时时间（毫秒） */
  readyTimeout?: number;
  /** Channel 名称前缀 */
  channelPrefix?: string;
}

/**
 * Fiber Host Bridge 抽象基类
 * 
 * 提供统一的请求-响应模式、状态管理和生命周期管理。
 */
export abstract class FiberHostBridgeBase {
  protected channelName: string;
  protected pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  protected isReady = false;
  protected readyResolve: (() => void) | null = null;
  protected readyReject: ((reason?: unknown) => void) | null = null;
  protected readyPromise: Promise<void>;
  protected options: Required<FiberHostBridgeOptions>;

  constructor(options: FiberHostBridgeOptions = {}) {
    this.options = {
      readyTimeout: FIBER_HOST_READY_TIMEOUT,
      channelPrefix: "fiber-host",
      ...options
    };

    this.channelName = createRequestId(this.options.channelPrefix);
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    this.setupReadyTimeout();
    this.setupPageLifecycleHandlers();
  }

  /**
   * 设置准备就绪超时
   */
  private setupReadyTimeout(): void {
    setTimeout(() => {
      if (!this.isReady && this.readyReject) {
        this.readyReject(new Error("Fiber host did not become ready. Check the Fiber host for errors."));
        this.readyReject = null;
        this.readyResolve = null;
      }
    }, this.options.readyTimeout);
  }

  /**
   * 设置页面生命周期监听
   */
  protected setupPageLifecycleHandlers(): void {
    const cleanup = () => {
      this.dispose();
    };
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("beforeunload", cleanup);
  }

  /**
   * 处理 ready 消息
   */
  protected handleReadyMessage(message: FiberHostReady): void {
    if (message.kind === "ready") {
      this.isReady = true;
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      console.log(`[${this.constructor.name}] fiber host ready`);
    }
  }

  /**
   * 处理响应消息
   */
  protected handleResponseMessage(message: FiberHostResponse): void {
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
   * 等待 Fiber Host 准备就绪
   */
  protected async waitForReady(): Promise<void> {
    if (this.isReady) {
      return;
    }
    await this.readyPromise;
  }

  /**
   * 调用 Fiber Host 方法
   * 
   * 子类需要实现具体的发送逻辑
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

    console.log(`[${this.constructor.name}] sending request`, request);

    return new Promise<FiberHostRequestMap[K]["result"]>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as FiberHostRequestMap[K]["result"]),
        reject
      });
      this.sendRequest(request);
    });
  }

  /**
   * 发送请求（子类必须实现）
   */
  protected abstract sendRequest(request: FiberHostRequest): void;

  /**
   * 清理资源（子类应重写以释放特定资源）
   */
  dispose(): void {
    // 拒绝所有待处理的请求
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error("Fiber host disposed"));
    }
    this.pendingRequests.clear();
    
    this.isReady = false;
  }
}
