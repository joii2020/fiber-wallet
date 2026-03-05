/**
 * 格式化工具函数
 */

import { ccc } from "@ckb-ccc/ccc";
import { SHANNONS_PER_CKB } from "../config/constants";

/**
 * 将 CKB 金额转换为 shannons 的 hex 字符串
 */
export const toRpcHexAmount = (amount: bigint): `0x${string}` => {
  return `0x${amount.toString(16)}`;
};

/**
 * 将 shannons 转换为 CKB 字符串
 */
export const shannonsToCkbString = (shannons: bigint): string => {
  return ccc.fixedPointToString(shannons);
};

/**
 * 缩短地址显示
 */
export const truncateAddress = (address: string, start = 10, end = 6): string => {
  if (address.length <= start + end + 3) {
    return address;
  }
  return `${address.slice(0, start)}...${address.slice(-end)}`;
};

/**
 * 格式化余额显示
 */
export const formatBalance = (shannons: bigint | null | undefined): string => {
  if (shannons === null || shannons === undefined) {
    return "--";
  }
  return `${shannonsToCkbString(shannons)} CKB`;
};

/**
 * 从多地址字符串中提取 peer ID
 */
export const extractPeerId = (address: string): string => {
  return address.trim().match(/\/p2p\/([^/]+)(?:\/|$)/)?.[1] ?? "";
};

/**
 * 生成唯一请求 ID
 */
export const createRequestId = (prefix: string): string => {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
};

/**
 * 检查是否为有效的 32 字节 hex 字符串
 */
export const isHex32 = (value: string): boolean => {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
};

/**
 * 计算最大可 funding 金额（保留必要余额）
 */
export const calculateMaxFundingAmount = (
  totalCapacity: bigint,
  reserve: bigint = OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
): bigint => {
  return totalCapacity > reserve ? totalCapacity - reserve : 0n;
};

// 重新导出常量以便使用
import { OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS } from "../config/constants";
