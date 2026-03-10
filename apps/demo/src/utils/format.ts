/**
 * Formatting utility functions
 */

import { ccc } from "@ckb-ccc/ccc";

/**
 * Convert CKB amount to shannons hex string
 */
export const toRpcHexAmount = (amount: bigint): `0x${string}` => {
  return `0x${amount.toString(16)}`;
};

/**
 * Convert shannons to CKB string
 */
export const shannonsToCkbString = (shannons: bigint): string => {
  return ccc.fixedPointToString(shannons);
};

/**
 * Truncate address display
 */
export const truncateAddress = (address: string, start = 10, end = 6): string => {
  if (address.length <= start + end + 3) {
    return address;
  }
  return `${address.slice(0, start)}...${address.slice(-end)}`;
};

/**
 * Format balance display
 */
export const formatBalance = (shannons: bigint | null | undefined): string => {
  if (shannons === null || shannons === undefined) {
    return "--";
  }
  return `${shannonsToCkbString(shannons)} CKB`;
};

/**
 * Extract peer ID from multi-address string
 */
export const extractPeerId = (address: string): string => {
  return address.trim().match(/\/p2p\/([^/]+)(?:\/|$)/)?.[1] ?? "";
};

/**
 * Generate unique request ID
 */
export const createRequestId = (prefix: string): string => {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
};

/**
 * Check if it's a valid 32-byte hex string
 */
export const isHex32 = (value: string): boolean => {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
};
