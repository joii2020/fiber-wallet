/**
 * Fiber Wallet Demo - Document-Isolation-Policy (DIP) Iframe 版本
 * 
 * 此版本使用 DIP + iframe 方案替代传统的弹窗方案：
 * - fiber-host 作为 iframe 嵌入，而非弹窗
 * - 使用 Document-Isolation-Policy 头部启用跨源隔离
 * - 使用 postMessage 进行跨窗口通信
 * 
 * 优势：
 * 1. 无弹窗拦截问题
 * 2. 更好的用户体验
 * 3. 支持 SharedArrayBuffer 等需要跨源隔离的 API
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
import { FiberPanelDip } from "./components/fiber-panel-dip";

// 服务
import { FiberHostIframeBridge } from "./services/fiber-host-iframe-bridge";

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

  app.innerHTML = `
    <main class="page">
      <header class="hero">
        <div class="hero-row">
          <h1>Fiber Wallet Demo <span class="badge badge-dip">DIP Iframe</span></h1>
          <button data-role="wallet-connect" class="wallet-button">
            <span data-role="wallet-main-label">Connect Wallet</span>
          </button>
        </div>
        <p class="sub" data-role="wallet-status">Wallet: not connected</p>
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
        
        <!-- DIP 状态指示器 -->
        <div class="dip-status-bar">
          <span class="dip-indicator" data-role="dip-status">
            <span class="dip-dot"></span>
            <span class="dip-text">Checking DIP...</span>
          </span>
          <a href="./" class="dip-switch">Switch to Popup Mode</a>
        </div>
      </header>

      <section class="grid">
        <article class="card workspace" data-node="left">
          <div class="card-head workspace-head">
            <div class="workspace-title-actions">
              <h2>WASM Node <span class="badge badge-iframe">Iframe</span></h2>
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
      
      <!-- DIP Iframe 容器 -->
      <div id="fiber-host-container" class="fiber-host-container" style="display: none;">
        <div class="fiber-host-header">
          <span>Fiber Host Console</span>
          <button type="button" data-role="toggle-fiber-host" class="icon-button" aria-label="Toggle console">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M19 9l-7 7-7-7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button type="button" data-role="close-fiber-host" class="icon-button" aria-label="Close console">×</button>
        </div>
      </div>
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

  // 添加 DIP 相关样式
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
    .badge-dip {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .badge-iframe {
      background: #238636;
      color: white;
    }
    .dip-status-bar {
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
    .dip-switch {
      font-size: 0.85rem;
      color: #58a6ff;
      text-decoration: none;
      margin-left: auto;
    }
    .dip-switch:hover {
      text-decoration: underline;
    }
    .fiber-host-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 600px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 40px);
      z-index: 9999;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      background: #0d1117;
      border: 1px solid #30363d;
      display: flex;
      flex-direction: column;
    }
    .fiber-host-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      font-size: 0.85rem;
      color: #c9d1d9;
    }
    .fiber-host-header span {
      flex: 1;
    }
    .fiber-host-header button {
      background: transparent;
      border: none;
      color: #8b949e;
      cursor: pointer;
      font-size: 1.2rem;
      line-height: 1;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .fiber-host-header button:hover {
      background: #30363d;
      color: #c9d1d9;
    }
    .fiber-host-container.collapsed iframe {
      display: none;
    }
    .fiber-host-container.collapsed {
      height: auto !important;
    }
    @media (max-width: 768px) {
      .fiber-host-container {
        width: calc(100vw - 40px);
        height: 50vh;
        bottom: 10px;
        right: 10px;
        left: 10px;
        max-width: none;
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * 更新 DIP 状态显示
 */
function updateDipStatus(): void {
  const statusEl = document.querySelector("[data-role='dip-status']");
  const dotEl = statusEl?.querySelector(".dip-dot");
  const textEl = statusEl?.querySelector(".dip-text");
  
  if (!statusEl || !dotEl || !textEl) return;

  const isIsolated = window.crossOriginIsolated;
  
  if (isIsolated) {
    dotEl.classList.add("active");
    textEl.textContent = "DIP Active (crossOriginIsolated)";
  } else {
    dotEl.classList.remove("active");
    textEl.textContent = "DIP Inactive (Chrome 137+ required)";
    
    // 显示提示信息
    showDipHelpMessage();
  }

  console.log("[DIP Demo] Cross-Origin Isolated:", isIsolated);
}

/**
 * 显示 DIP 帮助信息
 */
function showDipHelpMessage(): void {
  const hero = document.querySelector(".hero");
  if (!hero || hero.querySelector(".dip-help")) return;

  const helpDiv = document.createElement("div");
  helpDiv.className = "dip-help";
  helpDiv.innerHTML = `
    <div class="dip-help-content">
      <p><strong>⚠️ Document-Isolation-Policy 未激活</strong></p>
      <p>DIP 需要 Chrome 137+ (2025年5月发布) 才能生效。</p>
      <details>
        <summary>如何启用 DIP？</summary>
        <ol>
          <li>升级 Chrome 到 137+ 版本</li>
          <li>或访问 chrome://flags/#document-isolation-policy 启用实验标志</li>
          <li>重启浏览器后刷新页面</li>
        </ol>
        <p>在此期间，你可以：</p>
        <ul>
          <li>继续使用此页面（iframe 模式仍可用，只是没有跨源隔离）</li>
          <li>或<a href="./">切换回弹窗模式</a>（使用 COOP/COEP）</li>
        </ul>
      </details>
    </div>
  `;
  
  // 添加样式
  const style = document.createElement("style");
  style.textContent = `
    .dip-help {
      margin-top: 12px;
      padding: 12px 16px;
      background: rgba(218, 54, 51, 0.1);
      border: 1px solid rgba(218, 54, 51, 0.3);
      border-radius: 8px;
      font-size: 0.9rem;
    }
    .dip-help p {
      margin: 0 0 8px 0;
      color: #c9d1d9;
    }
    .dip-help p:last-child {
      margin-bottom: 0;
    }
    .dip-help details {
      margin-top: 8px;
    }
    .dip-help summary {
      color: #58a6ff;
      cursor: pointer;
      user-select: none;
    }
    .dip-help ol, .dip-help ul {
      margin: 8px 0;
      padding-left: 20px;
      color: #8b949e;
    }
    .dip-help li {
      margin: 4px 0;
    }
    .dip-help a {
      color: #58a6ff;
    }
  `;
  document.head.appendChild(style);
  
  hero.appendChild(helpDiv);
}

/**
 * 设置 Fiber Host 容器控制
 */
function setupFiberHostControls(): void {
  const container = document.getElementById("fiber-host-container");
  const toggleBtn = document.querySelector("[data-role='toggle-fiber-host']");
  const closeBtn = document.querySelector("[data-role='close-fiber-host']");

  toggleBtn?.addEventListener("click", () => {
    container?.classList.toggle("collapsed");
  });

  closeBtn?.addEventListener("click", () => {
    if (container) {
      container.style.display = "none";
    }
  });
}

/**
 * 初始化应用
 */
async function initApp(): Promise<void> {
  // 渲染 HTML
  renderApp();

  // 更新 DIP 状态
  updateDipStatus();
  
  // 设置容器控制
  setupFiberHostControls();

  // 创建 Fiber Host Iframe Bridge
  const bridge = new FiberHostIframeBridge({
    containerSelector: "#fiber-host-container",
    width: "100%",
    height: "calc(100% - 37px)" // 减去 header 高度
  });

  // 创建 Wallet Panel
  const walletPanel = new WalletPanel("#app", {
    onConnect: () => {
      console.log("[App] Wallet connected");
    },
    onError: (message) => {
      console.error("[App] Wallet error:", message);
    }
  });

  // 创建 Fiber Panel (DIP 版本)
  const fiberPanel = new FiberPanelDip("#app", bridge, {
    walletPanel: {
      getSigner: () => walletPanel.getSigner()
    },
    onError: (message) => {
      console.error("[App] Fiber error:", message);
      appStore.setNestedState("wallet", "status", message);
    }
  });

  // 初始化组件
  walletPanel.init();
  fiberPanel.init();

  // 订阅全局状态变化
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

  console.log("[App] Fiber Wallet Demo (DIP Iframe) initialized");
}

// 启动应用
document.addEventListener("DOMContentLoaded", () => {
  void initApp();
});
