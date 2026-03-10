/**
 * Fiber Node Panel Component
 * 
 * Unified Fiber Panel implementation supporting two modes:
 * - Popup mode: uses FiberHostBridge (BroadcastChannel + popup)
 * - DIP mode: uses FiberHostIframeBridge (postMessage + iframe)
 * 
 * Through bridge abstraction, both modes can share the same UI logic.
 */

import { ccc } from "@ckb-ccc/ccc";
import { signRawTransaction } from "@joyid/ckb";
import { toCccTransaction, withFundingTxWitnesses } from "@fiber-wallet/shared";
import { BaseComponent } from "./base-component";
import { appStore } from "../stores/app-store";
import { FiberHostBridgeBase } from "../services/fiber-host-bridge-base";
import {
  toRpcHexAmount,
  extractPeerId,
  isHex32
} from "../utils/format";
import {
  validateNativeAddress,
  validateCkbPrivateKey,
  validateFundingAmount
} from "../utils/validators";
import {
  DEFAULT_FUNDING_AMOUNT_SHANNONS,
  OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS,
  OPEN_CHANNEL_FUNDING_FEE_RATE,
  CKB_PRIVATE_KEY_STORAGE_KEY,
  JOY_ID_TESTNET_CELL_DEPS,
  JOY_ID_TESTNET_APP_URL,
  JOY_ID_MAINNET_APP_URL,
  DEFAULT_APP_ICON
} from "../config/constants";
import { openJoyIdPopup, closePopupQuietly } from "../utils/dom";
import type { Channel } from "@nervosnetwork/fiber-js";

/**
 * Fiber Panel mode
 */
export type FiberPanelMode = "popup" | "dip";

/**
 * Fiber Panel options
 */
export interface FiberPanelOptions {
  walletPanel: {
    getSigner: () => ccc.Signer | undefined;
  };
  onError?: (message: string) => void;
  /** Running mode */
  mode?: FiberPanelMode;
}

/**
 * Fiber Host Bridge interface extension
 * Defines the Bridge interface needed by Fiber Panel
 */
interface FiberPanelBridge extends FiberHostBridgeBase {
  /** Show/open Fiber Host */
  show?(): void;
  /** Open popup (Popup mode only) */
  openPopup?(): Window;
}

export class FiberPanel extends BaseComponent {
  private bridge: FiberPanelBridge;
  private options: FiberPanelOptions;
  private joyIdPopup: Window | null = null;
  private mode: FiberPanelMode;

  // DOM elements
  private ckbPrivateKeyInput: HTMLInputElement;
  private nativeAddressInput: HTMLInputElement;
  private openChannelBtn: HTMLButtonElement;
  private newInvoiceBtn: HTMLButtonElement;
  private paymentBtn: HTMLButtonElement;
  private updateChannelsBtn: HTMLButtonElement;
  private channelsEl: HTMLUListElement;
  private statusEl: HTMLSpanElement;

  constructor(
    containerSelector: string,
    bridge: FiberPanelBridge,
    options: FiberPanelOptions
  ) {
    super(containerSelector);
    this.bridge = bridge;
    this.options = options;
    this.mode = options.mode ?? "popup";

    // Initialize DOM references
    this.ckbPrivateKeyInput = this.getElement("[data-role='fiber-ckb-private-key']");
    this.nativeAddressInput = this.getElement("[data-role='native-address']");
    this.openChannelBtn = this.getElement("[data-role='open-channel']");
    this.newInvoiceBtn = this.getElement("[data-role='new-invoice']");
    this.paymentBtn = this.getElement("[data-role='payment']");
    this.updateChannelsBtn = this.getElement("[data-role='update-channels']");
    this.channelsEl = this.getElement("[data-role='fiber-channels']");
    this.statusEl = this.getElement("[data-role='fiber-status']");
  }

  init(): void {
    this.addEventListener(this.openChannelBtn, "click", () => this.openChannel());
    this.addEventListener(this.updateChannelsBtn, "click", () => this.refreshChannels());
    this.addEventListener(this.channelsEl, "click", (e) => this.handleChannelClick(e as MouseEvent));

    // Restore saved private key
    this.restoreStoredPrivateKey();

    // Listen for status changes
    appStore.subscribeNested("fiber", "isStarted", () => this.updateActionButtons());
    appStore.subscribeNested("fiber", "channels", () => this.renderChannels());
    appStore.subscribeNested("fiber", "status", () => this.updateStatus());

    // Initially disable action buttons
    this.setActionButtonsEnabled(false);
  }

  render(): void {
    this.renderChannels();
  }

  /**
   * Get current running mode
   */
  getMode(): FiberPanelMode {
    return this.mode;
  }

  /**
   * Start Fiber node (public method, for external calls)
   */
  async startFiberNode(): Promise<void> {
    const state = appStore.getState().fiber;
    if (state.isStarting || state.isStarted) return;

    // Handle private key based on mode
    if ((this.mode === "dip" ? this.getPrivateKeyForDip() : this.getPrivateKeyForPopup()) === null) {
      return;
    }

    const nativeAddress = this.nativeAddressInput.value.trim();
    const addressError = validateNativeAddress(nativeAddress);
    if (addressError) {
      this.setFiberStatus(`status: ${addressError}`);
      return;
    }

    appStore.setNestedState("fiber", "isStarting", true);
    this.setFiberStatus("status: initializing...");

    try {
      // Open/show Fiber Host based on mode
      await this.openFiberHost();

      const result = await this.bridge.call("startFiberNode", { nativeAddress });
      
      appStore.setNestedState("fiber", "isStarted", true);
      appStore.setNestedState("fiber", "channels", result.channels);
      this.setFiberStatus("status: running");
    } catch (error) {
      console.error("Fiber start failed:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.setFiberStatus(`status: ${message}`);
      this.options.onError?.(message);
    } finally {
      appStore.setNestedState("fiber", "isStarting", false);
    }
  }

  /**
   * Get private key for Popup mode (required)
   */
  private getPrivateKeyForPopup(): string | null {
    const privateKey = this.ckbPrivateKeyInput.value.trim();
    const error = validateCkbPrivateKey(privateKey);
    if (error) {
      this.setFiberStatus(`status: ${error}`);
      return null;
    }
    localStorage.setItem(CKB_PRIVATE_KEY_STORAGE_KEY, privateKey);
    return privateKey;
  }

  /**
   * Get private key for DIP mode (optional)
   */
  private getPrivateKeyForDip(): string | null {
    const rawPrivateKey = this.ckbPrivateKeyInput.value.trim();
    if (!rawPrivateKey) {
      localStorage.removeItem(CKB_PRIVATE_KEY_STORAGE_KEY);
      return "";
    }
    
    const error = validateCkbPrivateKey(rawPrivateKey);
    if (error) {
      this.setFiberStatus(`status: ${error}`);
      return null;
    }
    localStorage.setItem(CKB_PRIVATE_KEY_STORAGE_KEY, rawPrivateKey);
    return rawPrivateKey;
  }

  /**
   * Open Fiber Host based on mode
   */
  private async openFiberHost(): Promise<void> {
    if (this.mode === "popup") {
      if (this.bridge.openPopup) {
        this.bridge.openPopup();
      }
    } else {
      if (this.bridge.show) {
        this.bridge.show();
      }
    }
  }

  /**
   * Open Channel
   */
  private async openChannel(): Promise<void> {
    const signer = this.options.walletPanel.getSigner();
    
    // If JoyID, open popup in advance
    if (signer && this.isJoyIdSigner(signer)) {
      this.joyIdPopup = openJoyIdPopup();
    }

    this.openChannelBtn.disabled = true;

    try {
      if (!signer) {
        throw new Error("Please connect wallet first");
      }

      if (!appStore.getState().fiber.isStarted) {
        throw new Error("Fiber node is still initializing");
      }

      const fundingAddressObj = await signer.getRecommendedAddressObj();
      const lockScript = this.toFiberScript(fundingAddressObj.script);

      // Calculate available balance
      const fundingScriptCapacity = await signer.client.getCellsCapacity({
        script: fundingAddressObj.script,
        scriptType: "lock",
        scriptSearchMode: "exact"
      });

      const maxFundingAmount = fundingScriptCapacity > OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
        ? fundingScriptCapacity - OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
        : 0n;

      const amountError = validateFundingAmount(maxFundingAmount);
      if (amountError) {
        throw new Error(`${amountError}. Keep at least ${ccc.fixedPointToString(OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS)} CKB for channel cell and tx fee`);
      }

      const fundingAmount = maxFundingAmount < DEFAULT_FUNDING_AMOUNT_SHANNONS
        ? maxFundingAmount
        : DEFAULT_FUNDING_AMOUNT_SHANNONS;

      const nativeAddress = this.nativeAddressInput.value.trim();
      const peerId = extractPeerId(nativeAddress);
      if (!peerId) {
        throw new Error("Target node address must include /p2p/<peer-id>");
      }

      // Build parameters
      const openChannelParams = {
        peer_id: peerId,
        funding_amount: toRpcHexAmount(fundingAmount),
        public: true,
        shutdown_script: lockScript,
        funding_lock_script: lockScript,
        funding_fee_rate: toRpcHexAmount(OPEN_CHANNEL_FUNDING_FEE_RATE),
      };

      // JoyID requires adding cell deps
      if (this.isJoyIdSigner(signer)) {
        (openChannelParams as Record<string, unknown>).funding_lock_script_cell_deps = JOY_ID_TESTNET_CELL_DEPS;
      }

      const result = await this.bridge.call("openChannelWithExternalFunding", openChannelParams);

      console.log("Open channel result:", result);

      // Sign transaction
      const testnetClient = new ccc.ClientPublicTestnet();
      let signedFundingTx;

      if (this.isJoyIdSigner(signer)) {
        if (!this.joyIdPopup) {
          throw new Error("JoyID popup was not opened");
        }
        signedFundingTx = await this.signJoyIdFundingTx(
          result.unsigned_funding_tx,
          signer,
          this.joyIdPopup,
          testnetClient
        );
      } else {
        signedFundingTx = await this.signWithCcc(result.unsigned_funding_tx, signer);
      }

      await this.bridge.call("submitSignedFundingTx", {
        channelId: result.channel_id,
        signedTx: signedFundingTx
      });

      await this.refreshChannels();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onError?.(`Open channel error: ${message}`);
      console.error("Open channel failed:", error);
    } finally {
      closePopupQuietly(this.joyIdPopup);
      this.joyIdPopup = null;
      this.openChannelBtn.disabled = false;
    }
  }

  /**
   * Refresh Channel list
   */
  async refreshChannels(): Promise<void> {
    this.updateChannelsBtn.disabled = true;
    try {
      const result = await this.bridge.call("listChannels", undefined);
      appStore.setNestedState("fiber", "channels", result.channels);
    } catch (error) {
      console.error("List channels failed:", error);
      this.options.onError?.("Failed to load channels");
    } finally {
      this.updateChannelsBtn.disabled = false;
    }
  }

  /**
   * Close Channel
   */
  private async shutdownChannel(channelId: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await this.bridge.call("shutdownChannel", { channelId });
      await this.refreshChannels();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onError?.(`Close channel error: ${message}`);
      button.disabled = false;
    }
  }

  /**
   * Render Channel list
   */
  private renderChannels(): void {
    const channels = appStore.getState().fiber.channels;
    this.channelsEl.innerHTML = "";

    if (!channels.length) {
      const li = this.createElement("li", {
        className: "channel-item-message",
        textContent: "No channels"
      });
      this.channelsEl.appendChild(li);
      return;
    }

    for (const channel of channels) {
      const li = this.createChannelItem(channel);
      this.channelsEl.appendChild(li);
    }
  }

  /**
   * Create single Channel item
   */
  private createChannelItem(channel: Channel): HTMLLIElement {
    const state = (channel as { state?: { state_name?: string } }).state?.state_name ?? "unknown";

    const li = this.createElement("li", { className: "channel-item" });
    
    const info = this.createElement("span", { className: "channel-item-info" });
    const channelId = this.createElement("span", {
      className: "channel-item-id",
      textContent: channel.channel_id
    });
    channelId.title = channel.channel_id;
    
    const stateEl = this.createElement("span", {
      className: "channel-item-state",
      textContent: `| ${state}`
    });

    info.appendChild(channelId);
    info.appendChild(stateEl);

    const closeBtn = this.createElement("button", {
      className: "channel-close-button",
      textContent: "x",
      attributes: {
        type: "button",
        "data-channel-id": channel.channel_id,
        "aria-label": "Close channel",
        title: "Close channel"
      }
    });

    li.appendChild(info);
    li.appendChild(closeBtn);

    return li;
  }

  /**
   * Handle Channel list click
   */
  private handleChannelClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const closeBtn = target.closest<HTMLButtonElement>(".channel-close-button");
    if (!closeBtn) return;

    const channelId = closeBtn.dataset.channelId;
    if (!channelId) return;

    void this.shutdownChannel(channelId, closeBtn);
  }

  /**
   * Update action buttons state
   */
  private updateActionButtons(): void {
    const enabled = appStore.getState().fiber.isStarted;
    this.setActionButtonsEnabled(enabled);
  }

  private setActionButtonsEnabled(enabled: boolean): void {
    this.openChannelBtn.disabled = !enabled;
    this.newInvoiceBtn.disabled = !enabled;
    this.paymentBtn.disabled = !enabled;
    this.updateChannelsBtn.disabled = !enabled;
  }

  /**
   * Update status display
   */
  private updateStatus(): void {
    this.statusEl.textContent = appStore.getState().fiber.status;
  }

  private setFiberStatus(status: string): void {
    appStore.setNestedState("fiber", "status", status);
  }

  /**
   * Restore saved private key
   */
  private restoreStoredPrivateKey(): void {
    const saved = localStorage.getItem(CKB_PRIVATE_KEY_STORAGE_KEY)?.trim() ?? "";
    if (saved && isHex32(saved)) {
      this.ckbPrivateKeyInput.value = saved;
    }
  }

  /**
   * Check if it's JoyID Signer
   */
  private isJoyIdSigner(signer: ccc.Signer): boolean {
    return signer.signType === ccc.SignerSignType.JoyId;
  }

  /**
   * Convert script format
   */
  private toFiberScript(script: {
    codeHash: string;
    hashType: string;
    args: string;
  }) {
    return {
      code_hash: script.codeHash as `0x${string}`,
      hash_type: script.hashType as "data" | "type" | "data1" | "data2",
      args: script.args as `0x${string}`
    };
  }

  /**
   * JoyID signature
   */
  private async signJoyIdFundingTx(
    unsignedTx: import("@nervosnetwork/fiber-js").CkbJsonRpcTransaction,
    signer: ccc.Signer,
    popup: Window,
    client: ccc.Client
  ) {
    const tx = ccc.Transaction.from(toCccTransaction(unsignedTx));
    const signerAddressObj = await signer.getRecommendedAddressObj();
    const signerAddress = await signer.getRecommendedAddress();

    const witnessIndexes: number[] = [];
    for (const [index, input] of tx.inputs.entries()) {
      const { cellOutput } = await input.getCell(client);
      if (cellOutput?.lock.eq(signerAddressObj.script)) {
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

    const joyIdAppUrl = signer.client.addressPrefix === "ckb" 
      ? JOY_ID_MAINNET_APP_URL 
      : JOY_ID_TESTNET_APP_URL;

    const joyIdSignedTx = await signRawTransaction(
      JSON.parse(tx.stringify()) as Parameters<typeof signRawTransaction>[0],
      signerAddress,
      {
        joyidAppURL: joyIdAppUrl,
        name: "Fiber Wallet Demo",
        logo: DEFAULT_APP_ICON,
        popup,
        witnessIndexes
      }
    );

    return withFundingTxWitnesses(unsignedTx, joyIdSignedTx.witnesses);
  }

  /**
   * CCC signature (simplified version)
   */
  private async signWithCcc(
    unsignedTx: import("@nervosnetwork/fiber-js").CkbJsonRpcTransaction,
    signer: ccc.Signer
  ) {
    const cccTx = toCccTransaction(unsignedTx);
    const signedTx = await signer.signOnlyTransaction(cccTx);
    return withFundingTxWitnesses(unsignedTx, signedTx.witnesses);
  }
}
