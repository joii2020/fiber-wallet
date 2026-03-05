/**
 * 应用状态管理
 * 轻量级响应式状态管理，基于订阅模式
 */

import type { ccc } from "@ckb-ccc/ccc";
import type { Channel } from "@nervosnetwork/fiber-js";
import type { CkbSignerInfo } from "@fiber-wallet/shared";

// 状态定义
export interface AppState {
  wallet: {
    signerInfos: CkbSignerInfo[];
    signer: ccc.Signer | undefined;
    address: string;
    balance: bigint | null;
    signerInfo: CkbSignerInfo | undefined;
    status: string;
  };
  fiber: {
    isStarted: boolean;
    isStarting: boolean;
    channels: Channel[];
    status: string;
  };
  nativeNode: {
    rpcUrl: string;
    address: string;
  };
}

// 初始状态
const initialState: AppState = {
  wallet: {
    signerInfos: [],
    signer: undefined,
    address: "",
    balance: null,
    signerInfo: undefined,
    status: "not connected"
  },
  fiber: {
    isStarted: false,
    isStarting: false,
    channels: [],
    status: "not initialized"
  },
  nativeNode: {
    rpcUrl: "127.0.0.1:8247",
    address: "/ip4/127.0.0.1/tcp/8248/ws/p2p/QmVtWP2GFauRK31YFPQT1yW1KmyytA3j7PHwk9YjeE9hU9"
  }
};

// 订阅者类型
type Subscriber<T> = (value: T, prevValue: T) => void;

// 存储类
class Store {
  private state: AppState;
  private subscribers: Map<string, Set<Subscriber<unknown>>> = new Map();

  constructor() {
    this.state = JSON.parse(JSON.stringify(initialState)) as AppState;
  }

  /**
   * 获取状态（浅拷贝）
   */
  getState(): Readonly<AppState> {
    return this.state;
  }

  /**
   * 订阅状态变化
   * @param key 状态路径，如 "wallet.signer" 或 "fiber.channels"
   * @param callback 回调函数
   * @returns 取消订阅函数
   */
  subscribe<K extends keyof AppState>(
    key: K,
    callback: Subscriber<AppState[K]>
  ): () => void {
    const keyStr = key as string;
    if (!this.subscribers.has(keyStr)) {
      this.subscribers.set(keyStr, new Set());
    }
    this.subscribers.get(keyStr)!.add(callback as Subscriber<unknown>);

    return () => {
      this.subscribers.get(keyStr)?.delete(callback as Subscriber<unknown>);
    };
  }

  /**
   * 嵌套订阅（用于对象属性）
   */
  subscribeNested<K extends keyof AppState, NK extends keyof AppState[K]>(
    key: K,
    nestedKey: NK,
    callback: Subscriber<AppState[K][NK]>
  ): () => void {
    const fullKey = `${key as string}.${nestedKey as string}`;
    if (!this.subscribers.has(fullKey)) {
      this.subscribers.set(fullKey, new Set());
    }
    this.subscribers.get(fullKey)!.add(callback as Subscriber<unknown>);

    return () => {
      this.subscribers.get(fullKey)?.delete(callback as Subscriber<unknown>);
    };
  }

  /**
   * 设置状态（会触发订阅）
   */
  setState<K extends keyof AppState>(key: K, value: AppState[K]): void {
    const prevValue = this.state[key];
    this.state = { ...this.state, [key]: value };
    this.notify(key, value, prevValue);
  }

  /**
   * 更新嵌套状态
   */
  setNestedState<K extends keyof AppState, NK extends keyof AppState[K]>(
    key: K,
    nestedKey: NK,
    value: AppState[K][NK]
  ): void {
    const prevParent = this.state[key];
    const prevValue = prevParent[nestedKey];
    
    const newParent = { ...prevParent, [nestedKey]: value } as AppState[K];
    this.state = { ...this.state, [key]: newParent };
    
    this.notify(key, newParent, prevParent);
    this.notifyNested(key, nestedKey, value, prevValue);
  }

  /**
   * 批量更新状态（只触发一次通知）
   */
  batchUpdate(updates: Partial<AppState>): void {
    const prevState = { ...this.state };
    this.state = { ...this.state, ...updates };

    for (const key of Object.keys(updates) as (keyof AppState)[]) {
      this.notify(key, this.state[key], prevState[key]);
    }
  }

  /**
   * 通知订阅者
   */
  private notify<K extends keyof AppState>(
    key: K,
    value: AppState[K],
    prevValue: AppState[K]
  ): void {
    const callbacks = this.subscribers.get(key as string);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(value, prevValue);
        } catch (error) {
          console.error(`[Store] subscriber error for ${key}:`, error);
        }
      }
    }
  }

  /**
   * 通知嵌套订阅者
   */
  private notifyNested<K extends keyof AppState, NK extends keyof AppState[K]>(
    key: K,
    nestedKey: NK,
    value: AppState[K][NK],
    prevValue: AppState[K][NK]
  ): void {
    const fullKey = `${key as string}.${nestedKey as string}`;
    const callbacks = this.subscribers.get(fullKey);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(value, prevValue);
        } catch (error) {
          console.error(`[Store] subscriber error for ${fullKey}:`, error);
        }
      }
    }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.state = JSON.parse(JSON.stringify(initialState)) as AppState;
    // 通知所有订阅者
    for (const key of Object.keys(this.state) as (keyof AppState)[]) {
      this.notify(key, this.state[key], undefined as unknown as AppState[keyof AppState]);
    }
  }
}

// 导出单例
export const appStore = new Store();

// 便捷 hooks（用于组件）
export function useStore<K extends keyof AppState>(
  key: K,
  callback: Subscriber<AppState[K]>
): () => void {
  return appStore.subscribe(key, callback);
}

export function useNestedStore<K extends keyof AppState, NK extends keyof AppState[K]>(
  key: K,
  nestedKey: NK,
  callback: Subscriber<AppState[K][NK]>
): () => void {
  return appStore.subscribeNested(key, nestedKey, callback);
}
