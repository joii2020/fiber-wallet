/**
 * Fiber Host Bridge Abstract Base Class
 * 
 * Defines common interfaces and behaviors for Bridge, supporting multiple communication methods:
 * - BroadcastChannel
 * - postMessage (iframe/cross-window)
 * 
 * Subclasses need to implement specific communication mechanisms.
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
 * Bridge configuration options
 */
export interface FiberHostBridgeOptions {
  /** Ready timeout (milliseconds) */
  readyTimeout?: number;
  /** Channel name prefix */
  channelPrefix?: string;
}

/**
 * Fiber Host Bridge Abstract Base Class
 * 
 * Provides unified request-response pattern, state management, and lifecycle management.
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
   * Setup ready timeout
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
   * Setup page lifecycle handlers
   */
  protected setupPageLifecycleHandlers(): void {
    const cleanup = () => {
      this.dispose();
    };
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("beforeunload", cleanup);
  }

  /**
   * Handle ready message
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
   * Handle response message
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
   * Wait for Fiber Host to be ready
   */
  protected async waitForReady(): Promise<void> {
    if (this.isReady) {
      return;
    }
    await this.readyPromise;
  }

  /**
   * Call Fiber Host method
   * 
   * Subclasses need to implement specific sending logic
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
   * Send request (must be implemented by subclasses)
   */
  protected abstract sendRequest(request: FiberHostRequest): void;

  /**
   * Clean up resources (subclasses should override to release specific resources)
   */
  dispose(): void {
    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error("Fiber host disposed"));
    }
    this.pendingRequests.clear();
    
    this.isReady = false;
  }
}
