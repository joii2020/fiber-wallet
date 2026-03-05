/**
 * Fiber Wallet Demo - 入口文件
 * 
 * 重构后的架构：
 * - 类型定义: types/
 * - 配置常量: config/
 * - 服务层: services/
 * - 状态管理: stores/
 * - UI组件: components/
 * - 工具函数: utils/
 */

import "./style.css";
import { Buffer } from "buffer/";
import { ccc } from "@ckb-ccc/ccc";

// Polyfills
if (!("global" in globalThis)) {
  (globalThis as typeof globalThis & { global: typeof globalThis }).global = globalThis;
}
if (!("Buffer" in globalThis)) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

// 组件
import { WalletPanel } from "./components/wallet-panel";
import { FiberPanel } from "./components/fiber-panel";

// 服务
import { FiberHostBridge } from "./services/fiber-host-bridge";

// 状态
import { appStore } from "./stores/app-store";

// 工具
import { getEl } from "./utils/dom";
import { DEFAULT_APP_ICON } from "./config/constants";

/**
 * 渲染应用 HTML 结构
 */
function renderApp(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app element");
  }

  // 添加模式切换样式
  const style = document.createElement("style");
  style.textContent = `
    .badge {
      font-size: 0.6em;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-popup {
      background: #8957e5;
      color: white;
    }
    .mode-switch-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #30363d;
    }
    .mode-indicator {
      font-size: 0.85rem;
      color: #8b949e;
    }
    .mode-switch {
      font-size: 0.85rem;
      color: #58a6ff;
      text-decoration: none;
      margin-left: auto;
    }
    .mode-switch:hover {
      text-decoration: underline;
    }
  `;
  document.head.appendChild(style);

  app.innerHTML = `
    <main class="page">
      <header class="hero">
        <div class="hero-row">
          <h1>Fiber Wallet Demo <span class="badge badge-popup">Popup</span></h1>
          <button data-role="wallet-connect" class="wallet-button">
            <span data-role="wallet-main-label">Connect Wallet</span>
          </button>
        </div>
        <p class="sub" data-role="wallet-status">Wallet: not connected</p>
        
        <!-- 模式切换栏 -->
        <div class="mode-switch-bar">
          <span class="mode-indicator">Using window.open() popup mode</span>
          <a href="./index-dip.html" class="mode-switch">Try DIP Iframe Mode →</a>
        </div>
        
        <div class="wallet-summary" data-role="wallet-summary" hidden>
          <img data-role="wallet-icon" class="wallet-summary-icon" src="${DEFAULT_APP_ICON}" alt="wallet icon" />
          <div class="wallet-summary-meta">
            <div class="wallet-summary-balance-row">
              <p class="wallet-summary-balance" data-role="wallet-balance">Loading balance...</p>
              <button
                type="button"
                data-role="wallet-balance-refresh"
                class="icon-button wallet-balance-refresh"
                aria-label="Refresh wallet balance"
                title="Refresh wallet balance"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M20 6v5h-5M4 18v-5h5M19 11a7 7 0 0 0-12-3L4 11M5 13a7 7 0 0 0 12 3l3-3"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
            <p class="wallet-summary-address" data-role="wallet-address">-</p>
          </div>
        </div>
      </header>

      <section class="grid">
        <article class="card workspace" data-node="left">
          <div class="card-head workspace-head">
            <div class="workspace-title-actions">
              <h2>WASM Node</h2>
            </div>
            <span class="workspace-sub" data-role="fiber-status">status: not initialized</span>
          </div>

          <section class="workspace-section">
            <div class="fiber-init">
              <input
                data-role="fiber-ckb-private-key"
                placeholder="CKB private key (0x...)"
                autocomplete="off"
                spellcheck="false"
              />
              <button data-role="init-fiber" class="primary">Init Fiber Node</button>
            </div>
            <div class="actions">
              <button data-role="open-channel">Open Channel</button>
              <button data-role="new-invoice">New Invoice</button>
              <button data-role="payment">Payment</button>
            </div>
            <div class="actions channels-head">
              <p class="hint">Channels</p>
              <button
                data-role="update-channels"
                class="icon-button"
                aria-label="Update channels"
                title="Update channels"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M20 6v5h-5M4 18v-5h5M19 11a7 7 0 0 0-12-3L4 11M5 13a7 7 0 0 0 12 3l3-3"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
            <ul class="channels" data-role="fiber-channels">
              <li class="channel-item-message">No channels</li>
            </ul>
          </section>
        </article>

        <article class="card workspace" data-node="right">
          <div class="card-head workspace-head">
            <h2>Native Node</h2>
            <span class="workspace-sub">rpc direct</span>
          </div>

          <section class="workspace-section">
            <div class="native-address">
              <p>RPC:</p>
              <input
                data-role="native-rpc-url"
                value="127.0.0.1:8247"
              />
            </div>
            <div class="native-address">
              <p>Address:</p>
              <input
                data-role="native-address"
                value="/ip4/127.0.0.1/tcp/8248/ws/p2p/QmVtWP2GFauRK31YFPQT1yW1KmyytA3j7PHwk9YjeE9hU9"
              />
            </div>
          </section>
        </article>
      </section>
    </main>

    <!-- Wallet Modal -->
    <div class="wallet-modal hidden" data-role="wallet-modal" aria-hidden="true">
      <button
        type="button"
        class="wallet-modal-backdrop"
        data-role="wallet-modal-backdrop"
        aria-label="Close wallet selector"
      ></button>
      <section class="wallet-modal-panel" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
        <div class="wallet-modal-head">
          <h2 id="wallet-modal-title">Select Wallet</h2>
          <button
            type="button"
            class="wallet-close-button"
            data-role="wallet-modal-close"
            aria-label="Close wallet selector"
          >
            ×
          </button>
        </div>
        <p class="wallet-modal-sub">Choose one available CKB signer</p>
        <ul class="wallet-options" data-role="wallet-options"></ul>
      </section>
    </div>
  `;
}

/**
 * 初始化应用
 */
async function initApp(): Promise<void> {
  // 渲染 HTML
  renderApp();

  // 创建 Fiber Host Bridge
  const bridge = new FiberHostBridge();

  // 创建 Wallet Panel
  const walletPanel = new WalletPanel("#app", {
    onConnect: () => {
      console.log("[App] Wallet connected");
      // 钱包连接后，可以自动启动 Fiber（可选）
      // fiberPanel.autoStart();
    },
    onError: (message) => {
      console.error("[App] Wallet error:", message);
    }
  });

  // 创建 Fiber Panel
  const fiberPanel = new FiberPanel("#app", bridge, {
    walletPanel: {
      getSigner: () => walletPanel.getSigner()
    },
    onError: (message) => {
      console.error("[App] Fiber error:", message);
      // 显示错误状态
      appStore.setNestedState("wallet", "status", message);
    }
  });

  // 初始化组件
  walletPanel.init();
  fiberPanel.init();

  // 订阅全局状态变化（用于调试或全局处理）
  appStore.subscribe("wallet", (newState, prevState) => {
    if (newState.signer !== prevState.signer) {
      console.log("[App] Wallet signer changed:", newState.signer ? "connected" : "disconnected");
    }
  });

  appStore.subscribe("fiber", (newState, prevState) => {
    if (newState.isStarted !== prevState.isStarted) {
      console.log("[App] Fiber node:", newState.isStarted ? "started" : "stopped");
    }
  });

  console.log("[App] Fiber Wallet Demo initialized");
}

// 启动应用
document.addEventListener("DOMContentLoaded", () => {
  void initApp();
});
