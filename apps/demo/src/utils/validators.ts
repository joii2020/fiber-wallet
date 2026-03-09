/**
 * 校验工具函数
 */

import { isHex32, extractPeerId } from "./format";

/**
 * 验证 CKB 私钥格式
 */
export const validateCkbPrivateKey = (privateKey: string): string | null => {
  if (!privateKey) {
    return "CKB private key is required";
  }
  if (!isHex32(privateKey)) {
    return "CKB private key must be 0x + 64 hex chars";
  }
  return null;
};

/**
 * 验证目标节点地址格式
 */
export const validateNativeAddress = (address: string): string | null => {
  const trimmed = address.trim();
  if (!trimmed) {
    return "Target node address is required";
  }
  const peerId = extractPeerId(trimmed);
  if (!peerId) {
    return "Target node address must include /p2p/<peer-id>";
  }
  return null;
};

/**
 * 验证 funding 金额是否足够
 */
export const validateFundingAmount = (
  amount: bigint
): string | null => {
  if (amount <= 0n) {
    return `Insufficient capacity. Keep at least enough CKB for channel cell and tx fee`;
  }
  return null;
};

/**
 * 检查错误是否是用户取消操作
 */
export const isWalletConnectCanceled = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    message.includes("popup closed") ||
    message.includes("user rejected") ||
    message.includes("rejected") ||
    message.includes("canceled") ||
    message.includes("cancelled")
  ) {
    return true;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 4001
  ) {
    return true;
  }

  return false;
};
