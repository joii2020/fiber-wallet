/**
 * Fiber Host Bridge Service - BroadcastChannel Implementation
 * 
 * Uses BroadcastChannel to communicate with fiber-host window
 * Suitable for same-origin popup mode
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
  /** fiber-host page URL */
  hostUrl?: string;
  /** Popup width */
  width?: number;
  /** Popup height */
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

    // Initialize BroadcastChannel
    this.channel = new BroadcastChannel(this.channelName);

    // Build fiber-host URL
    const fiberHostUrlObject = new URL(this.popupOptions.hostUrl, import.meta.url);
    fiberHostUrlObject.searchParams.set("channel", this.channelName);
    this.fiberHostUrl = fiberHostUrlObject.toString();

    this.setupChannelListener();
  }

  /**
   * Setup BroadcastChannel message listener
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
   * Open Fiber Host popup
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
   * Send request
   */
  protected sendRequest(request: import("../types/fiber").FiberHostRequest): void {
    this.channel.postMessage(request);
  }
  /**
   * Clean up resources
   */
  dispose(): void {
    // Send dispose signal
    const message: import("../types/fiber").FiberHostControlMessage = { kind: "dispose" };
    this.channel.postMessage(message);
    
    closePopupQuietly(this.popup);
    this.popup = null;
    
    this.channel.close();
    
    super.dispose();
  }
}
