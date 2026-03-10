/**
 * Application State Management
 * Lightweight reactive state management based on subscription pattern
 */

import type { ccc } from "@ckb-ccc/ccc";
import type { Channel } from "@nervosnetwork/fiber-js";
import type { CkbSignerInfo } from "@fiber-wallet/shared";
import {
  DEFAULT_NATIVE_ADDRESS,
  DEFAULT_NATIVE_RPC_URL
} from "../config/constants";

// State definition
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

// Initial state
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
    rpcUrl: DEFAULT_NATIVE_RPC_URL,
    address: DEFAULT_NATIVE_ADDRESS
  }
};

// Subscriber type
type Subscriber<T> = (value: T, prevValue: T) => void;

// Store class
class Store {
  private state: AppState;
  private subscribers: Map<string, Set<Subscriber<unknown>>> = new Map();

  constructor() {
    this.state = JSON.parse(JSON.stringify(initialState)) as AppState;
  }

  /**
   * Get state (shallow copy)
   */
  getState(): Readonly<AppState> {
    return this.state;
  }

  /**
   * Subscribe to state changes
   * @param key State path, e.g., "wallet.signer" or "fiber.channels"
   * @param callback Callback function
   * @returns Unsubscribe function
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
   * Nested subscription (for object properties)
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
   * Set state (triggers subscriptions)
   */
  setState<K extends keyof AppState>(key: K, value: AppState[K]): void {
    const prevValue = this.state[key];
    this.state = { ...this.state, [key]: value };
    this.notify(key, value, prevValue);
  }

  /**
   * Update nested state
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
   * Notify subscribers
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
   * Notify nested subscribers
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

}

// Export singleton
export const appStore = new Store();
