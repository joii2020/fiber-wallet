import "./style.css";
import { CccWalletManager, type CkbSignerInfo } from "@fiber-wallet/shared";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}

app.innerHTML = `
  <main class="shell">
    <section class="card">
      <p class="badge">Fiber Wallet</p>
      <h1>Wallet + Demo Shared Lib</h1>
      <p class="desc">This page shares the same CCC wallet connection management library with /demo, facilitating demonstration of fiber and wallet interaction.</p>

      <div class="actions">
        <button data-role="wallet-refresh">Refresh Wallets</button>
      </div>

      <label>
        <span>Available CKB Signer</span>
        <select data-role="wallet-select"></select>
      </label>

      <div class="actions">
        <button data-role="wallet-connect">Connect Signer</button>
        <button data-role="wallet-sign">Sign Message Test</button>
      </div>

      <p class="status" data-role="wallet-status">Not connected</p>
      <pre class="logs" data-role="logs"></pre>
    </section>
  </main>
`;

const walletSelect = getEl<HTMLSelectElement>("[data-role='wallet-select']");
const walletStatusEl = getEl<HTMLParagraphElement>("[data-role='wallet-status']");
const logsEl = getEl<HTMLPreElement>("[data-role='logs']");

const walletManager = new CccWalletManager({
  appName: "Fiber Wallet"
});

const state = {
  signerInfos: [] as CkbSignerInfo[],
  signer: undefined as CkbSignerInfo["signer"] | undefined
};

function getEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }
  return el;
}

function stringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v),
    2
  );
}

function log(line: string, data?: unknown) {
  const msg = data === undefined ? line : `${line}\n${stringify(data)}`;
  const ts = new Date().toLocaleTimeString();
  logsEl.textContent = `[${ts}] ${msg}\n${logsEl.textContent}`;
}

function setWalletStatus(text: string) {
  walletStatusEl.textContent = text;
}

async function refreshWallets() {
  setWalletStatus("Refreshing wallets...");
  walletSelect.innerHTML = "";
  state.signerInfos = await walletManager.refreshCkbSigners();

  if (state.signerInfos.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No CKB wallet signer found";
    walletSelect.appendChild(option);
    setWalletStatus("No available CKB signer");
    return;
  }

  for (const info of state.signerInfos) {
    const option = document.createElement("option");
    option.value = info.id;
    option.textContent = info.label;
    walletSelect.appendChild(option);
  }

  setWalletStatus(`Found ${state.signerInfos.length} CKB signer(s)`);
}

async function connectSigner() {
  const picked = state.signerInfos.find((item) => item.id === walletSelect.value);
  if (!picked) {
    throw new Error("Please select a signer first");
  }

  const connected = await walletManager.connectSigner(picked.signer);
  state.signer = connected.signer;
  setWalletStatus(`Connected: ${connected.address}`);
  log("Connected wallet signer", {
    signerType: connected.signer.type,
    address: connected.address
  });
}

async function signMessageTest() {
  if (!state.signer) {
    throw new Error("Wallet signer not connected");
  }

  const signature = await walletManager.signMessage(state.signer, "fiber-wallet-main-sign-test");
  log("signMessage result", signature);
}

function bindButton(selector: string, handler: () => Promise<void>) {
  const button = getEl<HTMLButtonElement>(selector);
  button.addEventListener("click", () => {
    void (async () => {
      button.disabled = true;
      try {
        await handler();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setWalletStatus(`Error: ${message}`);
        log("Error", { message });
      } finally {
        button.disabled = false;
      }
    })();
  });
}

bindButton("[data-role='wallet-refresh']", refreshWallets);
bindButton("[data-role='wallet-connect']", connectSigner);
bindButton("[data-role='wallet-sign']", signMessageTest);

setWalletStatus("Not connected");
void refreshWallets();
