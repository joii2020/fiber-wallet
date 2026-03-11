import { FiberWasmManager } from "@fiber-wallet/shared";
import { Buffer } from "buffer/";

// Polyfills for WASM
if (!("global" in globalThis)) {
  (globalThis as typeof globalThis & { global: typeof globalThis }).global = globalThis;
}
if (!("Buffer" in globalThis)) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

// Initialize WASM fiber on page load
export const fiber = new FiberWasmManager({
  secretStorageKey: "fiber-wallet-app:fiber-key-pair",
  databasePrefix: "/wasm-fiber-wallet-app",
  logLevel: "info"
});
const startWasmFiber = async (): Promise<void> => {
  const startTime = performance.now();
  try {
    await fiber.start();
    const duration = performance.now() - startTime;
    console.log(`[fiber-wasm] WASM fiber auto-started successfully (took ${duration.toFixed(2)}ms)`);
  } catch (error) {
    const duration = performance.now() - startTime;
    console.error(`[fiber-wasm] WASM fiber auto-start failed after ${duration.toFixed(2)}ms:`, error);
    throw error;
  }
};

export const fiberReady = startWasmFiber();
