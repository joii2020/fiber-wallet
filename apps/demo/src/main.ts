/**
 * Fiber Wallet Demo - unified entry
 * 
 * 自动检测 DIP 状态并选择合适的模式：
 * - DIP Active: 使用 FiberHostIframeBridge + FiberPanel (DIP 模式)
 * - DIP Inactive: 使用 FiberHostBridge + FiberPanel (Popup 模式)
 */

import "./style.css";
import { Buffer } from "buffer/";

// Polyfills
if (!("global" in globalThis)) {
  (globalThis as typeof globalThis & { global: typeof globalThis }).global = globalThis;
}
if (!("Buffer" in globalThis)) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

import { WalletPanel } from "./components/wallet-panel";
import { FiberPanel, type FiberPanelMode } from "./components/fiber-panel";

import { FiberHostBridge } from "./services/fiber-host-bridge";
import { FiberHostIframeBridge } from "./services/fiber-host-iframe-bridge";

import { appStore } from "./stores/app-store";

import {
  DEFAULT_APP_ICON,
  DEFAULT_NATIVE_ADDRESS,
  DEFAULT_NATIVE_RPC_URL
} from "./config/constants";

const isDipActive = (): boolean => {
  // 检查传统的 crossOriginIsolated
  if (window.crossOriginIsolated) return true;
  
  // 检查 DIP (Document Isolation Policy)
  // Chrome 137+ 支持 DIP，它允许使用 SharedArrayBuffer 但 crossOriginIsolated 仍为 false
  try {
    // 实际测试 SharedArrayBuffer 是否可用
    new SharedArrayBuffer(1);
    return true;
  } catch {
    return false;
  }
};

const getModeLabel = (): string => (isDipActive() ? "DIP Iframe" : "Popup");

/**
 * 获取当前运行模式
 */
const getMode = (): FiberPanelMode => (isDipActive() ? "dip" : "popup");

/**
 * 渲染应用 HTML 结构
 */
function renderApp(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app element");
  }

  const style = document.createElement("style");
  const heroBadge = isDipActive()
    ? '<span class="badge badge-dip">DIP Iframe</span>'
    : '<span class="badge badge-popup">Popup</span>';
  const wasmBadge = isDipActive()
    ? '<span class="badge badge-dip">Iframe</span>'
    : "";

  style.textContent = `
    .badge {
      font-size: 0.6em;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-dip {
      background: linear-gradient(135deg, #238636 0%, #1f6feb 100%);
      color: white;
    }
    .badge-popup {
      background: #6e7681;
      color: white;
    }
    .mode-status-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #30363d;
    }
    .dip-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: #8b949e;
    }
    .dip-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #da3633;
      transition: background 0.3s;
    }
    .dip-dot.active {
      background: #238636;
      box-shadow: 0 0 8px #238636;
    }
    .mode-indicator {
      margin-left: auto;
      font-size: 0.85rem;
      color: #8b949e;
    }
    .fiber-host-container {
      position: fixed;
      width: 1px;
      height: 1px;
      right: 0;
      bottom: 0;
      opacity: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: -1;
    }
    .dip-help {
      margin-top: 12px;
      padding: 12px 16px;
      background: rgba(218, 54, 51, 0.1);
      border: 1px solid rgba(218, 54, 51, 0.3);
      border-radius: 8px;
      font-size: 0.9rem;
    }
    .dip-help p {
      margin: 0;
      color: #c9d1d9;
    }
  `;
  document.head.appendChild(style);

  app.innerHTML = `
    <main class="page">
      <header class="hero">
        <div class="hero-row">
          <h1>Fiber Wallet Demo ${heroBadge}</h1>
          <button data-role="wallet-connect" class="wallet-button">
            <span data-role="wallet-main-label">Connect Wallet</span>
          </button>
        </div>
        <p class="sub" data-role="wallet-status">Wallet: not connected</p>
        <div class="mode-status-bar">
          <span class="dip-indicator" data-role="dip-status">
            <span class="dip-dot"></span>
            <span class="dip-text">Checking DIP...</span>
          </span>
          <span class="mode-indicator">Using ${getModeLabel()} mode</span>
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
              <h2>WASM Node ${wasmBadge}</h2>
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
                value="${DEFAULT_NATIVE_RPC_URL}"
              />
            </div>
            <div class="native-address">
              <p>Address:</p>
              <input
                data-role="native-address"
                value="${DEFAULT_NATIVE_ADDRESS}"
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

    <div id="fiber-host-container" class="fiber-host-container" aria-hidden="true"></div>
  `;
}

function updateDipStatus(): void {
  const statusEl = document.querySelector("[data-role='dip-status']");
  const dotEl = statusEl?.querySelector(".dip-dot");
  const textEl = statusEl?.querySelector(".dip-text");

  if (!statusEl || !dotEl || !textEl) return;

  if (isDipActive()) {
    dotEl.classList.add("active");
    textEl.textContent = "DIP Active";
    return;
  }

  dotEl.classList.remove("active");
  textEl.textContent = "DIP Unsupported / Inactive";
  showDipHelpMessage();
}

function showDipHelpMessage(): void {
  const hero = document.querySelector(".hero");
  if (!hero || hero.querySelector(".dip-help")) return;

  const helpDiv = document.createElement("div");
  helpDiv.className = "dip-help";
  helpDiv.innerHTML = `
    <p>Current browser did not enable DIP, so this page falls back to popup mode.</p>
  `;
  hero.appendChild(helpDiv);
}

/**
 * 初始化应用
 */
async function initApp(): Promise<void> {
  renderApp();
  updateDipStatus();

  // 根据模式创建对应的 Bridge 和 FiberPanel
  const mode = getMode();
  const bridge = isDipActive()
    ? new FiberHostIframeBridge({
        containerSelector: "#fiber-host-container",
        width: "100%",
        height: "100%"
      })
    : new FiberHostBridge();

  // 先声明 fiberPanel 变量，以便在 walletPanel 的 onConnect 中使用
  let fiberPanel: FiberPanel;

  const walletPanel = new WalletPanel("#app", {
    onConnect: () => {
      console.log("[App] Wallet connected");
      // 钱包连接后自动初始化 Fiber Node
      void fiberPanel.startFiberNode();
    },
    onError: (message) => {
      console.error("[App] Wallet error:", message);
    }
  });

  fiberPanel = new FiberPanel("#app", bridge, {
    mode,
    walletPanel: {
      getSigner: () => walletPanel.getSigner()
    },
    onError: (message) => {
      console.error("[App] Fiber error:", message);
      appStore.setNestedState("wallet", "status", message);
    }
  });

  walletPanel.init();
  fiberPanel.init();

  console.log(`[App] Fiber Wallet Demo initialized in ${getModeLabel()} mode`);
}

// 启动应用
document.addEventListener("DOMContentLoaded", () => {
  void initApp();
});
