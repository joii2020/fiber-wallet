import type { Fiber } from "@nervosnetwork/fiber-js";
import { FiberWasmManager } from "../shared";
import { Buffer } from "buffer/";
import {
  DEFAULT_FIBER_CONFIG_PATH,
  DEFAULT_FIBER_DATABASE_PREFIX,
  DEFAULT_FIBER_SECRET_STORAGE_KEY
} from "../config";

declare global {
  interface Window {
    fiber?: Fiber;
    fiberReady: Promise<void>;
  }
}

export class FiberWasmRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiberWasmRuntimeError";
  }
}

// Polyfills for WASM
if (!("global" in globalThis)) {
  (globalThis as typeof globalThis & { global: typeof globalThis }).global = globalThis;
}
if (!("Buffer" in globalThis)) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

const hasSharedArrayBufferSupport = (): boolean => {
  try {
    return typeof SharedArrayBuffer !== "undefined" && SharedArrayBuffer instanceof Function;
  } catch {
    return false;
  }
};

const isWindowSecureContext = (): boolean => {
  if (typeof window === "undefined") {
    return true;
  }

  return window.isSecureContext === true;
};

const isWindowCrossOriginIsolated = (): boolean => {
  if (typeof window === "undefined") {
    return true;
  }

  return window.crossOriginIsolated === true;
};

const getSharedArrayBufferUnavailableReason = (): string => {
  const reasons: string[] = [];

  if (!isWindowSecureContext()) {
    reasons.push(
      "This page is not running in a secure context. When opening the dev server from another device on your LAN, use HTTPS instead of plain HTTP."
    );
  }

  if (!isWindowCrossOriginIsolated()) {
    reasons.push(
      "This page is not cross-origin isolated. Open the isolated entry page (DIP or COOP/COEP) and reload."
    );
  }

  if (!hasSharedArrayBufferSupport()) {
    reasons.push("SharedArrayBuffer is unavailable in this browser context.");
  }

  if (reasons.length === 0) {
    return "SharedArrayBuffer is unavailable in this browser context.";
  }

  return reasons.join(" ");
};

const assertFiberRuntimeReady = (): void => {
  if (hasSharedArrayBufferSupport()) {
    return;
  }

  throw new FiberWasmRuntimeError(getSharedArrayBufferUnavailableReason());
};

// Initialize WASM fiber on page load
export const fiber = new FiberWasmManager({
  configPath: DEFAULT_FIBER_CONFIG_PATH,
  secretStorageKey: DEFAULT_FIBER_SECRET_STORAGE_KEY,
  databasePrefix: DEFAULT_FIBER_DATABASE_PREFIX,
  logLevel: "info"
});
const startWasmFiber = async (): Promise<void> => {
  const startTime = performance.now();
  try {
    assertFiberRuntimeReady();
    await fiber.start();
    const duration = performance.now() - startTime;
    console.log(`[fiber-wasm] WASM fiber auto-started successfully (took ${duration.toFixed(2)}ms)`);
  } catch (error) {
    const duration = performance.now() - startTime;
    if (error instanceof FiberWasmRuntimeError) {
      console.warn(`[fiber-wasm] WASM fiber runtime unavailable after ${duration.toFixed(2)}ms:`, error.message);
    } else {
      console.error(`[fiber-wasm] WASM fiber auto-start failed after ${duration.toFixed(2)}ms:`, error);
    }
    throw error;
  }
};

export const fiberReady = startWasmFiber();

if (typeof window !== "undefined") {
  window.fiberReady = fiberReady;
  void fiberReady.then(() => {
    const fiberInstance = fiber.getFiberInstance();
    if (!fiberInstance) {
      throw new Error("[fiber-wasm] Fiber instance is unavailable after startup");
    }
    window.fiber = fiberInstance;
  });
}
