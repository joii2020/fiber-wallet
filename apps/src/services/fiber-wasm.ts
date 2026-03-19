import { FiberWasmManager } from "../shared";
import { Buffer } from "buffer/";
import {
  DEFAULT_FIBER_CONFIG_PATH,
  DEFAULT_FIBER_DATABASE_PREFIX,
  DEFAULT_FIBER_SECRET_STORAGE_KEY
} from "../config";

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

const assertFiberRuntimeReady = (): void => {
  if (hasSharedArrayBufferSupport()) {
    return;
  }

  throw new FiberWasmRuntimeError(
    "SharedArrayBuffer is unavailable. Deploy this page with cross-origin isolation headers (for Vercel: Document-Isolation-Policy or COOP/COEP)."
  );
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
