import "./style.css";
import { Buffer } from "buffer/";
import { ccc } from "@ckb-ccc/ccc";
import { signRawTransaction } from "@joyid/ckb";
import type {
  CkbJsonRpcTransaction,
  Channel,
  OpenChannelWithExternalFundingParams,
  OpenChannelWithExternalFundingResult
} from "@nervosnetwork/fiber-js";
import {
  CccWalletManager,
  type CkbSignerInfo,
  toFiberScript,
  toCccTransaction,
  withFundingTxWitnesses
} from "@fiber-wallet/shared";

if (!("global" in globalThis)) {
  (globalThis as typeof globalThis & { global: typeof globalThis }).global = globalThis;
}

if (!("Buffer" in globalThis)) {
  (
    globalThis as typeof globalThis & {
      Buffer: typeof Buffer;
    }
  ).Buffer = Buffer;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}

const fiberWasmStatus = "status: not initialized";
const channelListHtml = "<li>No channels</li>";
const DEFAULT_APP_ICON = "/favicon.ico";
app.innerHTML = `
  <main class="page">
    <header class="hero">
      <div class="hero-row">
        <h1>Fiber Wallet Demo</h1>
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
    </header>

    <section class="grid">
      <article class="card workspace" data-node="left">
        <div class="card-head workspace-head">
          <div class="workspace-title-actions">
            <h2>WASM Node</h2>
          </div>
          <span class="workspace-sub" data-role="fiber-status">${fiberWasmStatus}</span>
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
          ${channelListHtml}
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
              data-role="native-rpc-url"
              value="/ip4/127.0.0.1/tcp/8248/ws/p2p/QmT1zngL9JthgGNkGoFnVhKcob1NEcBHiLmDqtCbfxa7DL"
            />
          </div>
        </section>
      </article>
    </section>
  </main>
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
const nativeAddressInput = getEl<HTMLInputElement>("[data-node='right'] .native-address:nth-of-type(2) input");
const ckbPrivateKeyInput = getEl<HTMLInputElement>("[data-role='fiber-ckb-private-key']");
const initFiberButton = getEl<HTMLButtonElement>("[data-role='init-fiber']");
const openChannelButton = getEl<HTMLButtonElement>("[data-role='open-channel']");
const newInvoiceButton = getEl<HTMLButtonElement>("[data-role='new-invoice']");
const paymentButton = getEl<HTMLButtonElement>("[data-role='payment']");
const updateChannelsButton = getEl<HTMLButtonElement>("[data-role='update-channels']");
const fiberChannelsEl = getEl<HTMLUListElement>("[data-role='fiber-channels']");
const fiberStatusEl = getEl<HTMLSpanElement>("[data-role='fiber-status']");
const walletConnectButton = getEl<HTMLButtonElement>("[data-role='wallet-connect']");
const walletMainLabelEl = getEl<HTMLSpanElement>("[data-role='wallet-main-label']");
const walletStatusEl = getEl<HTMLParagraphElement>("[data-role='wallet-status']");
const walletSummaryEl = getEl<HTMLDivElement>("[data-role='wallet-summary']");
const walletIconEl = getEl<HTMLImageElement>("[data-role='wallet-icon']");
const walletBalanceEl = getEl<HTMLParagraphElement>("[data-role='wallet-balance']");
const walletBalanceRefreshButton = getEl<HTMLButtonElement>("[data-role='wallet-balance-refresh']");
const walletAddressEl = getEl<HTMLParagraphElement>("[data-role='wallet-address']");
const walletModalEl = getEl<HTMLDivElement>("[data-role='wallet-modal']");
const walletModalBackdropEl = getEl<HTMLButtonElement>("[data-role='wallet-modal-backdrop']");
const walletModalCloseEl = getEl<HTMLButtonElement>("[data-role='wallet-modal-close']");
const walletOptionsEl = getEl<HTMLUListElement>("[data-role='wallet-options']");
const SHANNONS_PER_CKB = 100000000n;
const DEFAULT_FUNDING_AMOUNT_SHANNONS = 1000n * SHANNONS_PER_CKB;
const OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS = 120n * SHANNONS_PER_CKB;
// Fee rate in shannons/KB
// Note: Must be high enough to cover the transaction size including all cell deps
// JoyID requires 5 cell deps which increases transaction size
const OPEN_CHANNEL_FUNDING_FEE_RATE = 3000n;
const walletManager = new CccWalletManager({
  appName: "Fiber Wallet Demo"
});
const walletState = {
  signerInfos: [] as CkbSignerInfo[],
  signer: undefined as ccc.Signer | undefined,
  address: "",
  balance: "",
  signerInfo: undefined as CkbSignerInfo | undefined
};
const CKB_PRIVATE_KEY_STORAGE_KEY = "fiber-wallet-demo:ckb-secret-key";

type FiberHostAction =
  | "startFiberNode"
  | "listChannels"
  | "shutdownChannel"
  | "openChannelWithExternalFunding"
  | "submitSignedFundingTx";

type FiberHostControlMessage = {
  kind: "dispose";
};

type FiberHostRequestMap = {
  startFiberNode: {
    payload: { nativeAddress: string };
    result: { channels: Channel[] };
  };
  listChannels: {
    payload: undefined;
    result: { channels: Channel[] };
  };
  shutdownChannel: {
    payload: { channelId: string };
    result: { ok: true };
  };
  openChannelWithExternalFunding: {
    payload: OpenChannelWithExternalFundingParams;
    result: OpenChannelWithExternalFundingResult;
  };
  submitSignedFundingTx: {
    payload: {
      channelId: string;
      signedTx: CkbJsonRpcTransaction;
    };
    result: { ok: true };
  };
};
type FiberHostRequest = {
  kind: "request";
  requestId: string;
  action: FiberHostAction;
  payload?: unknown;
};

type FiberHostResponse = {
  kind: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type FiberHostReady = {
  kind: "ready";
};

const createFiberHostRequestId = (prefix: string): string => {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
    }`;
};

const fiberHostChannelName = createFiberHostRequestId("fiber-wallet-demo:fiber-host");
const fiberHostChannel = new BroadcastChannel(fiberHostChannelName);
const fiberHostUrlObject = new URL("../fiber-host.html", import.meta.url);
fiberHostUrlObject.searchParams.set("channel", fiberHostChannelName);
const fiberHostUrl = fiberHostUrlObject.toString();

const pendingFiberHostRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }
>();

let fiberHostReadyResolve: (() => void) | null = null;
let fiberHostReadyReject: ((reason?: unknown) => void) | null = null;
const fiberHostReadyPromise = new Promise<void>((resolve, reject) => {
  fiberHostReadyResolve = resolve;
  fiberHostReadyReject = reject;
});
let isFiberHostReady = false;
let fiberHostPopup: Window | null = null;

const openFiberHostPopup = (): Window => {
  console.log("[demo] opening fiber host window", {
    fiberHostUrl
  });
  const popup = window.open(fiberHostUrl, "fiber-host", "popup=yes,width=520,height=640");
  if (!popup) {
    throw new Error("Unable to open Fiber host window. Please allow popups and try again.");
  }

  fiberHostPopup = popup;
  console.log("[demo] fiber host window opened");
  return popup;
};

fiberHostChannel.addEventListener("message", (event: MessageEvent<FiberHostResponse | FiberHostReady>) => {
  const message = event.data;
  if (!message) {
    return;
  }

  console.log("[demo] fiber host message", message);

  if (message.kind === "ready") {
    isFiberHostReady = true;
    fiberHostReadyResolve?.();
    fiberHostReadyResolve = null;
    fiberHostReadyReject = null;
    return;
  }

  if (message.kind !== "response") {
    return;
  }

  const pending = pendingFiberHostRequests.get(message.requestId);
  if (!pending) {
    return;
  }

  pendingFiberHostRequests.delete(message.requestId);

  if (message.ok) {
    pending.resolve(message.result);
    return;
  }

  pending.reject(new Error(message.error ?? "Fiber host request failed"));
});

const waitForFiberHostReady = async (): Promise<void> => {
  if (isFiberHostReady) {
    console.log("[demo] fiber host already ready");
    return;
  }

  console.log("[demo] waiting for fiber host ready");

  await Promise.race([
    fiberHostReadyPromise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error("Fiber host did not become ready. Check the Fiber host window for errors."));
      }, 10000);
    })
  ]);
};

const callFiberHost = async <K extends FiberHostAction>(
  action: K,
  payload: FiberHostRequestMap[K]["payload"]
): Promise<FiberHostRequestMap[K]["result"]> => {
  await waitForFiberHostReady();

  const requestId = createFiberHostRequestId(action);
  const request: FiberHostRequest = {
    kind: "request",
    requestId,
    action,
    payload
  };

  console.log("[demo] callFiberHost request", request);

  return new Promise<FiberHostRequestMap[K]["result"]>((resolve, reject) => {
    pendingFiberHostRequests.set(requestId, {
      resolve: (value) => resolve(value as FiberHostRequestMap[K]["result"]),
      reject
    });
    fiberHostChannel.postMessage(request);
  });
};

const setFiberActionsEnabled = (enabled: boolean) => {
  openChannelButton.disabled = !enabled;
  newInvoiceButton.disabled = !enabled;
  paymentButton.disabled = !enabled;
  updateChannelsButton.disabled = !enabled;
};

const isJoyIdSigner = (signer: ccc.Signer): boolean => {
  return signer.signType === ccc.SignerSignType.JoyId;
};

const openJoyIdPopup = (): Window => {
  const popup = window.open("", "joyid-sign", "popup=yes,width=420,height=720");
  if (!popup) {
    throw new Error("Unable to open JoyID popup. Please allow popups and try again.");
  }
  return popup;
};

const closePopupQuietly = (popup: Window | null | undefined) => {
  if (!popup || popup.closed) {
    return;
  }

  try {
    popup.close();
  } catch {
    // Ignore close failures for cross-origin popup windows.
  }
};

const closeFiberHostPopupOnPageExit = () => {
  fiberHostChannel.postMessage({
    kind: "dispose"
  } satisfies FiberHostControlMessage);
  closePopupQuietly(fiberHostPopup);
  fiberHostPopup = null;
};

window.addEventListener("pagehide", closeFiberHostPopupOnPageExit);
window.addEventListener("beforeunload", closeFiberHostPopupOnPageExit);

const getJoyIdAppUrl = (signer: ccc.Signer): string => {
  return signer.client.addressPrefix === "ckb" ? "https://app.joy.id" : "https://testnet.joyid.dev";
};

const isHex32 = (value: string): boolean => {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
};

const restoreStoredCkbPrivateKey = () => {
  const saved = window.localStorage.getItem(CKB_PRIVATE_KEY_STORAGE_KEY)?.trim() ?? "";
  if (saved && isHex32(saved)) {
    ckbPrivateKeyInput.value = saved;
  }
};

const saveCkbPrivateKeyForLaterSigning = () => {
  const privateKey = ckbPrivateKeyInput.value.trim();
  if (!privateKey) {
    return;
  }
  if (!isHex32(privateKey)) {
    throw new Error("CKB private key must be 0x + 64 hex chars");
  }
  window.localStorage.setItem(CKB_PRIVATE_KEY_STORAGE_KEY, privateKey);
};

let isFiberStarting = false;
let isFiberStarted = false;

const startFiberNode = async () => {
  if (isFiberStarting || isFiberStarted) {
    return;
  }

  isFiberStarting = true;
  initFiberButton.disabled = true;
  fiberStatusEl.textContent = "status: initializing...";
  try {
    const result = await callFiberHost("startFiberNode", { nativeAddress: nativeAddressInput.value.trim() });

    isFiberStarted = true;
    fiberStatusEl.textContent = "status: running";
    setFiberActionsEnabled(true);
    renderChannels(result.channels);
  } catch (error) {
    console.error(`fiber start failed: ${error}`);
    const message = error instanceof Error ? error.message : String(error);
    fiberStatusEl.textContent = `status: ${message}`;
    setFiberActionsEnabled(false);
  } finally {
    isFiberStarting = false;
    initFiberButton.disabled = false;
  }
};

const renderChannelMessage = (message: string) => {
  fiberChannelsEl.innerHTML = "";
  const li = document.createElement("li");
  li.className = "channel-item channel-item-message";
  li.textContent = message;
  fiberChannelsEl.appendChild(li);
};

const renderChannels = (channels: Channel[]) => {
  fiberChannelsEl.innerHTML = "";

  if (!channels.length) {
    renderChannelMessage("No channels");
    return;
  }

  for (const channel of channels) {
    const state = (channel as { state?: { state_name?: string } }).state?.state_name ?? "unknown";

    const li = document.createElement("li");
    li.className = "channel-item";

    const info = document.createElement("span");
    info.className = "channel-item-info";

    const channelId = document.createElement("span");
    channelId.className = "channel-item-id";
    channelId.textContent = channel.channel_id;
    channelId.title = channel.channel_id;

    const stateEl = document.createElement("span");
    stateEl.className = "channel-item-state";
    stateEl.textContent = `| ${state}`;

    info.append(channelId, stateEl);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "channel-close-button";
    closeButton.dataset.channelId = channel.channel_id;
    closeButton.setAttribute("aria-label", "Close channel");
    closeButton.title = "Close channel";
    closeButton.textContent = "x";

    li.append(info, closeButton);
    fiberChannelsEl.appendChild(li);
  }
};

const setWalletStatus = (status: string) => {
  walletStatusEl.textContent = status;
};

const setWalletButtonLabel = (label: string) => {
  walletMainLabelEl.textContent = label;
};

const closeWalletModal = () => {
  walletModalEl.classList.add("hidden");
  walletModalEl.setAttribute("aria-hidden", "true");
};

const openWalletModal = () => {
  walletModalEl.classList.remove("hidden");
  walletModalEl.setAttribute("aria-hidden", "false");
};

const truncateAddress = (address: string, start = 10, end = 6): string => {
  if (address.length <= start + end + 3) {
    return address;
  }
  return `${address.slice(0, start)}...${address.slice(-end)}`;
};

const setWalletIcon = (iconSrc: string, iconAlt: string) => {
  walletIconEl.onerror = () => {
    walletIconEl.onerror = null;
    walletIconEl.src = DEFAULT_APP_ICON;
  };
  walletIconEl.src = iconSrc || DEFAULT_APP_ICON;
  walletIconEl.alt = iconAlt;
};

const renderWalletSummary = () => {
  const signerInfo = walletState.signerInfo;
  if (!walletState.signer || !signerInfo || !walletState.address) {
    walletSummaryEl.hidden = true;
    walletBalanceRefreshButton.disabled = true;
    setWalletButtonLabel("Connect Wallet");
    return;
  }

  setWalletButtonLabel("Change Wallet");
  setWalletIcon(signerInfo.walletIcon, `${signerInfo.walletName} icon`);
  walletBalanceEl.textContent = walletState.balance ? `${walletState.balance} CKB` : "Loading balance...";
  walletAddressEl.textContent = truncateAddress(walletState.address);
  walletBalanceRefreshButton.disabled = false;
  walletSummaryEl.hidden = false;
};

const loadWalletCapacity = async (signer: ccc.Signer): Promise<bigint> => {
  const addressObjs = await signer.getAddressObjs();
  let totalCapacity = 0n;
  for (const { script } of addressObjs) {
    const capacity = await signer.client.getCellsCapacity({
      script,
      scriptType: "lock",
      scriptSearchMode: "exact"
    });
    totalCapacity += capacity;
  }
  return totalCapacity;
};

const loadWalletBalance = async (signer: ccc.Signer): Promise<string> => {
  const totalCapacity = await loadWalletCapacity(signer);
  return ccc.fixedPointToString(totalCapacity);
};

const refreshWalletBalance = async () => {
  const signer = walletState.signer;
  if (!signer) {
    return;
  }

  walletState.balance = "";
  walletBalanceRefreshButton.disabled = true;
  renderWalletSummary();

  try {
    walletState.balance = await loadWalletBalance(signer);
  } catch (error) {
    walletState.balance = "--";
    console.warn("Failed to load wallet balance", error);
  } finally {
    renderWalletSummary();
  }
};

const applyConnectedWallet = async (
  picked: CkbSignerInfo,
  connected: { signer: ccc.Signer; address: string }
) => {
  walletState.signer = connected.signer;
  walletState.address = connected.address;
  walletState.balance = "";
  walletState.signerInfo = picked;
  renderWalletSummary();
  setWalletStatus(`Wallet: connected (${picked.label})`);
  await refreshWalletBalance();
  await startFiberNode();
};

const isWalletConnectCanceled = (error: unknown): boolean => {
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

const renderWalletSignerOptions = (infos: CkbSignerInfo[]) => {
  walletOptionsEl.innerHTML = "";
  if (!infos.length) {
    const empty = document.createElement("li");
    empty.className = "wallet-empty";
    empty.textContent = "No CKB wallet signer found";
    walletOptionsEl.appendChild(empty);
    return;
  }

  for (const info of infos) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wallet-option";
    button.dataset.signerId = info.id;

    const icon = document.createElement("img");
    icon.className = "wallet-option-icon";
    icon.src = info.walletIcon || DEFAULT_APP_ICON;
    icon.alt = `${info.walletName} icon`;
    icon.loading = "lazy";
    icon.addEventListener("error", () => {
      icon.src = DEFAULT_APP_ICON;
    });

    const meta = document.createElement("div");
    meta.className = "wallet-option-meta";

    const title = document.createElement("p");
    title.className = "wallet-option-title";
    title.textContent = info.walletName;

    const sub = document.createElement("p");
    sub.className = "wallet-option-sub";
    sub.textContent = info.signerName;

    meta.appendChild(title);
    meta.appendChild(sub);
    button.appendChild(icon);
    button.appendChild(meta);
    li.appendChild(button);
    walletOptionsEl.appendChild(li);
  }
};

const connectPickedSigner = async (picked: CkbSignerInfo) => {
  walletConnectButton.disabled = true;
  setWalletButtonLabel("Connecting...");
  closeWalletModal();
  try {
    const connected = await walletManager.connectSigner(picked.signer);
    await applyConnectedWallet(picked, connected);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isWalletConnectCanceled(error)) {
      setWalletStatus("Wallet: connection canceled");
    } else {
      setWalletStatus(`Wallet error: ${message}`);
      console.error(`connect wallet failed: ${message}`);
    }
  } finally {
    walletConnectButton.disabled = false;
    renderWalletSummary();
  }
};

const openWalletSelector = async () => {
  walletConnectButton.disabled = true;
  setWalletButtonLabel("Scanning...");
  setWalletStatus("Wallet: scanning available signers...");
  try {
    walletState.signerInfos = await walletManager.refreshCkbSigners();
    if (!walletState.signerInfos.length) {
      throw new Error("No CKB wallet signer found");
    }

    renderWalletSignerOptions(walletState.signerInfos);
    openWalletModal();
    setWalletStatus("Wallet: select a signer to connect");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setWalletStatus(`Wallet error: ${message}`);
    console.error(`load wallet signer failed: ${message}`);
  } finally {
    walletConnectButton.disabled = false;
    renderWalletSummary();
  }
};

walletConnectButton.addEventListener("click", () => {
  void openWalletSelector();
});

walletModalBackdropEl.addEventListener("click", () => {
  closeWalletModal();
});

walletModalCloseEl.addEventListener("click", () => {
  closeWalletModal();
});

walletOptionsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button[data-signer-id]");
  if (!button) {
    return;
  }

  const signerId = button.dataset.signerId;
  if (!signerId) {
    return;
  }

  const picked = walletState.signerInfos.find((info) => info.id === signerId);
  if (!picked) {
    return;
  }

  try {
    openFiberHostPopup();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setWalletStatus(`Wallet error: ${message}`);
    console.error("open fiber host failed:", error);
    return;
  }

  void connectPickedSigner(picked);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeWalletModal();
  }
});

const refreshChannels = async () => {
  updateChannelsButton.disabled = true;
  try {
    const { channels } = await callFiberHost("listChannels", undefined);
    renderChannels(channels);
  } catch (error) {
    console.error(`list channels failed: ${error}`);
    renderChannelMessage("Failed to load channels");
  } finally {
    updateChannelsButton.disabled = false;
  }
};

setFiberActionsEnabled(false);
restoreStoredCkbPrivateKey();

initFiberButton.addEventListener("click", () => {
  void (async () => {
    try {
      openFiberHostPopup();
      saveCkbPrivateKeyForLaterSigning();
      await startFiberNode();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fiberStatusEl.textContent = `status: ${message}`;
      console.error("init fiber node failed:", error);
    }
  })();
});

updateChannelsButton.addEventListener("click", () => {
  void refreshChannels();
});

fiberChannelsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const closeButton = target.closest<HTMLButtonElement>(".channel-close-button");
  if (!closeButton) {
    return;
  }

  const { channelId } = closeButton.dataset;
  if (!channelId) {
    return;
  }

  void (async () => {
    closeButton.disabled = true;
    try {
      await callFiberHost("shutdownChannel", { channelId });
      await refreshChannels();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWalletStatus(`Close channel error: ${message}`);
      console.error("close channel failed:", error);
      closeButton.disabled = false;
    }
  })();
});

walletBalanceRefreshButton.addEventListener("click", () => {
  void refreshWalletBalance();
});

function getEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }
  return el;
}

const toRpcHexAmount = (amount: bigint): `0x${string}` => {
  return `0x${amount.toString(16)}`;
};

const signJoyIdFundingTx = async (
  unsignedTx: CkbJsonRpcTransaction,
  signer: ccc.Signer,
  popup: Window,
  client: ccc.Client
): Promise<CkbJsonRpcTransaction> => {
  const tx = ccc.Transaction.from(toCccTransaction(unsignedTx));
  const signerAddressObj = await signer.getRecommendedAddressObj();
  const signerAddress = await signer.getRecommendedAddress();

  const witnessIndexes: number[] = [];
  for (const [index, input] of tx.inputs.entries()) {
    const { cellOutput } = await input.getCell(client);
    if (cellOutput.lock.eq(signerAddressObj.script)) {
      witnessIndexes.push(index);
    }
  }

  if (!witnessIndexes.length) {
    throw new Error("No JoyID inputs found in unsigned funding transaction");
  }

  await tx.prepareSighashAllWitness(signerAddressObj.script, 0, client);
  tx.inputs.forEach((input) => {
    input.cellOutput = undefined;
    input.outputData = undefined;
  });

  const joyIdSignedTx = await signRawTransaction(
    JSON.parse(tx.stringify()) as Parameters<typeof signRawTransaction>[0],
    signerAddress,
    {
      joyidAppURL: getJoyIdAppUrl(signer),
      name: "Fiber Wallet Demo",
      logo: DEFAULT_APP_ICON,
      popup,
      witnessIndexes
    }
  );

  return withFundingTxWitnesses(unsignedTx, joyIdSignedTx.witnesses);
};

openChannelButton.addEventListener("click", () => {
  const signer = walletState.signer;
  const joyIdPopup = signer && isJoyIdSigner(signer) ? openJoyIdPopup() : null;

  void (async () => {
    openChannelButton.disabled = true;
    try {
      if (!signer) {
        throw new Error("Please connect wallet first");
      }
      if (!isFiberStarted) {
        throw new Error("Please click Init Fiber Node first");
      }

      const fundingAddressObj = await signer.getRecommendedAddressObj();

      const lockScript = toFiberScript(fundingAddressObj.script);
      const fundingScriptCapacity = await signer.client.getCellsCapacity({
        script: fundingAddressObj.script,
        scriptType: "lock",
        scriptSearchMode: "exact"
      });

      const maxFundingAmount =
        fundingScriptCapacity > OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
          ? fundingScriptCapacity - OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
          : 0n;

      if (maxFundingAmount <= 0n) {
        throw new Error(
          `Insufficient capacity. Keep at least ${ccc.fixedPointToString(
            OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
          )} CKB for channel cell and tx fee`
        );
      }

      const fundingAmount =
        maxFundingAmount < DEFAULT_FUNDING_AMOUNT_SHANNONS
          ? maxFundingAmount
          : DEFAULT_FUNDING_AMOUNT_SHANNONS;

      if (fundingAmount < DEFAULT_FUNDING_AMOUNT_SHANNONS) {
        console.warn(
          `Funding amount adjusted to ${ccc.fixedPointToString(
            fundingAmount
          )} CKB due to wallet balance`
        );
      }

      const relayAddress = nativeAddressInput.value.trim();
      const relayPeerId = relayAddress.match(/\/p2p\/([^/]+)(?:\/|$)/)?.[1] ?? "";
      if (!relayPeerId) {
        throw new Error("Target node address must include /p2p/<peer-id>");
      }

      // Build external funding params with optional cell deps for custom wallet locks
      const openChannelParams: OpenChannelWithExternalFundingParams = {
        peer_id: relayPeerId,
        funding_amount: toRpcHexAmount(fundingAmount),
        public: true,
        shutdown_script: lockScript,
        funding_lock_script: lockScript,
        funding_fee_rate: toRpcHexAmount(OPEN_CHANNEL_FUNDING_FEE_RATE),
      };

      // Add funding_lock_script_cell_deps for JoyID wallet
      // JoyID lock script requires 5 underlying cell deps
      // Instead of using the dep_group (which may reference an unavailable internal dep group),
      // we directly add all 5 cell deps that JoyID needs
      if (isJoyIdSigner(signer)) {
        // Testnet JoyID cell deps (expanded from dep_group 0x4dcf...9263)
        openChannelParams.funding_lock_script_cell_deps = [
          {
            dep_type: "code",
            out_point: {
              tx_hash: "0x8b3255491f3c4dcc1cfca33d5c6bcaec5409efe4bbda243900f9580c47e0242e" as `0x${string}`,
              index: "0x1" as `0x${string}`,
            },
          },
          {
            dep_type: "code",
            out_point: {
              tx_hash: "0x4a596d31dc35e88fb1591debbf680b04a44b4a434e3a94453c21ea8950ffb4d9" as `0x${string}`,
              index: "0x1" as `0x${string}`,
            },
          },
          {
            dep_type: "code",
            out_point: {
              tx_hash: "0x4a596d31dc35e88fb1591debbf680b04a44b4a434e3a94453c21ea8950ffb4d9" as `0x${string}`,
              index: "0x0" as `0x${string}`,
            },
          },
          {
            dep_type: "code",
            out_point: {
              tx_hash: "0x95ecf9b41701b45d431657a67bbfa3f07ef7ceb53bf87097f3674e1a4a19ce62" as `0x${string}`,
              index: "0x1" as `0x${string}`,
            },
          },
          {
            dep_type: "code",
            out_point: {
              tx_hash: "0xf2c9dbfe7438a8c622558da8fa912d36755271ea469d3a25cb8d3373d35c8638" as `0x${string}`,
              index: "0x1" as `0x${string}`,
            },
          },
        ];
        console.log(`[JoyID] Added ${openChannelParams.funding_lock_script_cell_deps.length} cell deps`);
      }

      const result = await callFiberHost("openChannelWithExternalFunding", openChannelParams);

      console.log(`openChannelWithExternalFunding unsigned_funding_tx: ${ccc.stringify(result.unsigned_funding_tx)}`);
      console.log(`unsignedTxHash: ${ccc.Transaction.from(toCccTransaction(result.unsigned_funding_tx)).hash()}`);

      // Use a testnet client for all operations since fiber is only deployed on testnet
      const testnetClient = new ccc.ClientPublicTestnet();

      // Sign the final negotiated funding tx as-is. Only witnesses are updated afterward.
      let signedFundingTx: CkbJsonRpcTransaction;
      if (isJoyIdSigner(signer)) {
        if (!joyIdPopup) {
          throw new Error("JoyID popup was not opened");
        }
        signedFundingTx = await signJoyIdFundingTx(result.unsigned_funding_tx, signer, joyIdPopup, testnetClient);
      } else {
        signedFundingTx = await walletManager.signFundingTx(result.unsigned_funding_tx, signer);
      }
      const signedTx = ccc.Transaction.from(toCccTransaction(signedFundingTx));

      console.log(`signedJsonTx: ${ccc.stringify(signedTx)}`);
      console.log(`signedTxHash: ${signedTx.hash()}`);

      // console.log(await testnetClient.sendTransactionDry(signedTx));

      await callFiberHost("submitSignedFundingTx", {
        channelId: result.channel_id,
        signedTx: signedFundingTx
      });

      closePopupQuietly(joyIdPopup);

      await refreshChannels();
    } catch (error) {
      closePopupQuietly(joyIdPopup);
      const message = error instanceof Error ? error.message : String(error);
      setWalletStatus(`Open channel error: ${message}`);
      console.error("open channel failed:", error);
    } finally {
      openChannelButton.disabled = false;
    }
  })();
});
