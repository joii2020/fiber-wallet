/**
 * Global constants and configuration
 */

// CKB unit conversion
export const SHANNONS_PER_CKB = 100000000n;

// Channel related constants
export const DEFAULT_FUNDING_AMOUNT_SHANNONS = 1000n * SHANNONS_PER_CKB;
export const OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS = 120n * SHANNONS_PER_CKB;

// Fee rate (shannons/KB)
// Note: Must be high enough to cover transaction size including all cell deps
// JoyID requires 5 cell deps which increases transaction size
export const OPEN_CHANNEL_FUNDING_FEE_RATE = 3000n;

// Storage Keys
export const CKB_PRIVATE_KEY_STORAGE_KEY = "fiber-wallet-demo:ckb-secret-key";

// Default icon
export const DEFAULT_APP_ICON = "/favicon.ico";

// JoyID related
export const JOY_ID_TESTNET_APP_URL = "https://testnet.joyid.dev";
export const JOY_ID_MAINNET_APP_URL = "https://app.joy.id";

// Testnet JoyID cell deps (expanded from dep_group 0x4dcf...9263)
export const JOY_ID_TESTNET_CELL_DEPS = [
  {
    dep_type: "code" as const,
    out_point: {
      tx_hash: "0x8b3255491f3c4dcc1cfca33d5c6bcaec5409efe4bbda243900f9580c47e0242e" as `0x${string}`,
      index: "0x1" as `0x${string}`,
    },
  },
  {
    dep_type: "code" as const,
    out_point: {
      tx_hash: "0x4a596d31dc35e88fb1591debbf680b04a44b4a434e3a94453c21ea8950ffb4d9" as `0x${string}`,
      index: "0x1" as `0x${string}`,
    },
  },
  {
    dep_type: "code" as const,
    out_point: {
      tx_hash: "0x4a596d31dc35e88fb1591debbf680b04a44b4a434e3a94453c21ea8950ffb4d9" as `0x${string}`,
      index: "0x0" as `0x${string}`,
    },
  },
  {
    dep_type: "code" as const,
    out_point: {
      tx_hash: "0x95ecf9b41701b45d431657a67bbfa3f07ef7ceb53bf87097f3674e1a4a19ce62" as `0x${string}`,
      index: "0x1" as `0x${string}`,
    },
  },
  {
    dep_type: "code" as const,
    out_point: {
      tx_hash: "0xf2c9dbfe7438a8c622558da8fa912d36755271ea469d3a25cb8d3373d35c8638" as `0x${string}`,
      index: "0x1" as `0x${string}`,
    },
  },
];

// Fiber Host configuration
export const FIBER_HOST_CHANNEL_PREFIX = "fiber-wallet-demo:fiber-host";
export const FIBER_HOST_READY_TIMEOUT = 10000; // ms
export const FIBER_HOST_POPUP_WIDTH = 520;
export const FIBER_HOST_POPUP_HEIGHT = 640;
export const JOY_ID_POPUP_WIDTH = 420;
export const JOY_ID_POPUP_HEIGHT = 720;

// Default RPC configuration
export const DEFAULT_NATIVE_RPC_URL = "127.0.0.1:8247";
export const DEFAULT_NATIVE_ADDRESS = "/ip4/127.0.0.1/tcp/8248/ws/p2p/QmcMXciBEWiJjCnNCmNEy4sCdKASFWNnmBvU4BZHRd4sGT";
