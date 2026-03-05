/**
 * Fiber 节点面板组件 - DIP Iframe 版本
 * 
 * 适配 FiberHostIframeBridge 的 FiberPanel 变体
 */

import { ccc } from "@ckb-ccc/ccc";
import { signRawTransaction } from "@joyid/ckb";
import { toCccTransaction, withFundingTxWitnesses, type CkbSignerInfo } from "@fiber-wallet/shared";
import { BaseComponent } from "./base-component";
import { appStore } from "../stores/app-store";
import { FiberHostIframeBridge } from "../services/fiber-host-iframe-bridge";
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
  DEFAULT_NATIVE_ADDRESS,
  DEFAULT_APP_ICON
} from "../config/constants";
import { openJoyIdPopup, closePopupQuietly, getEl } from "../utils/dom";
import type { Channel } from "@nervosnetwork/fiber-js";

export interface FiberPanelDipOptions {
  walletPanel: {
    getSigner: () => ccc.Signer | undefined;
  };
  onError?: (message: string) => void;
}

export class FiberPanelDip extends BaseComponent {
  private bridge: FiberHostIframeBridge;
  private options: FiberPanelDipOptions;
  private joyIdPopup: Window | null = null;
  private fiberHostVisible = false;

  // DOM 元素
  private ckbPrivateKeyInput: HTMLInputElement;
  private nativeAddressInput: HTMLInputElement;
  private initBtn: HTMLButtonElement;
  private openChannelBtn: HTMLButtonElement;
  private newInvoiceBtn: HTMLButtonElement;
  private paymentBtn: HTMLButtonElement;
  private updateChannelsBtn: HTMLButtonElement;
  private channelsEl: HTMLUListElement;
  private statusEl: HTMLSpanElement;

  constructor(
    containerSelector: string,
    bridge: FiberHostIframeBridge,
    options: FiberPanelDipOptions
  ) {
    super(containerSelector);
    this.bridge = bridge;
    this.options = options;

    // 初始化 DOM 引用
    this.ckbPrivateKeyInput = this.getElement("[data-role='fiber-ckb-private-key']");
    this.nativeAddressInput = this.getElement("[data-role='native-address']");
    this.initBtn = this.getElement("[data-role='init-fiber']");
    this.openChannelBtn = this.getElement("[data-role='open-channel']");
    this.newInvoiceBtn = this.getElement("[data-role='new-invoice']");
    this.paymentBtn = this.getElement("[data-role='payment']");
    this.updateChannelsBtn = this.getElement("[data-role='update-channels']");
    this.channelsEl = this.getElement("[data-role='fiber-channels']");
    this.statusEl = this.getElement("[data-role='fiber-status']");
  }

  init(): void {
    this.addEventListener(this.initBtn, "click", () => this.startFiberNode());
    this.addEventListener(this.openChannelBtn, "click", () => this.openChannel());
    this.addEventListener(this.updateChannelsBtn, "click", () => this.refreshChannels());
    this.addEventListener(this.channelsEl, "click", (e) => this.handleChannelClick(e as MouseEvent));

    // 恢复保存的私钥
    this.restoreStoredPrivateKey();

    // 监听状态变化
    appStore.subscribeNested("fiber", "isStarted", () => this.updateActionButtons());
    appStore.subscribeNested("fiber", "channels", () => this.renderChannels());
    appStore.subscribeNested("fiber", "status", () => this.updateStatus());

    // 初始禁用操作按钮
    this.setActionButtonsEnabled(false);
  }

  render(): void {
    this.renderChannels();
  }

  /**
   * 显示 Fiber Host iframe
   */
  private showFiberHost(): void {
    this.bridge.show();
    this.fiberHostVisible = true;
    
    // 添加按钮来关闭/隐藏
    const container = document.getElementById("fiber-host-container");
    if (container) {
      container.style.display = "flex";
    }
  }

  /**
   * 隐藏 Fiber Host iframe
   */
  private hideFiberHost(): void {
    this.bridge.hide();
    this.fiberHostVisible = false;
  }

  /**
   * 启动 Fiber 节点
   */
  private async startFiberNode(): Promise<void> {
    const state = appStore.getState().fiber;
    if (state.isStarting || state.isStarted) return;

    const rawPrivateKey = this.ckbPrivateKeyInput.value.trim();
    const privateKey = rawPrivateKey || undefined;
    if (privateKey) {
      const error = validateCkbPrivateKey(privateKey);
      if (error) {
        this.setFiberStatus(`status: ${error}`);
        return;
      }
      localStorage.setItem(CKB_PRIVATE_KEY_STORAGE_KEY, privateKey);
    } else {
      localStorage.removeItem(CKB_PRIVATE_KEY_STORAGE_KEY);
    }

    const nativeAddress = this.nativeAddressInput.value.trim();
    const addressError = validateNativeAddress(nativeAddress);
    if (addressError) {
      this.setFiberStatus(`status: ${addressError}`);
      return;
    }

    appStore.setNestedState("fiber", "isStarting", true);
    this.initBtn.disabled = true;
    this.setFiberStatus("status: initializing...");

    try {
      // 显示 Fiber Host iframe（自动创建）
      this.showFiberHost();

      const result = await this.bridge.call("startFiberNode", {
        nativeAddress,
        ckbPrivateKey: privateKey
      });
      
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
      this.initBtn.disabled = false;
    }
  }

  /**
   * 打开 Channel
   */
  private async openChannel(): Promise<void> {
    const signer = this.options.walletPanel.getSigner();
    
    // 如果是 JoyID，提前打开弹窗
    if (signer && this.isJoyIdSigner(signer)) {
      this.joyIdPopup = openJoyIdPopup();
    }

    this.openChannelBtn.disabled = true;

    try {
      if (!signer) {
        throw new Error("Please connect wallet first");
      }

      if (!appStore.getState().fiber.isStarted) {
        throw new Error("Please click Init Fiber Node first");
      }

      const fundingAddressObj = await signer.getRecommendedAddressObj();
      const lockScript = this.toFiberScript(fundingAddressObj.script);

      // 计算可用余额
      const fundingScriptCapacity = await signer.client.getCellsCapacity({
        script: fundingAddressObj.script,
        scriptType: "lock",
        scriptSearchMode: "exact"
      });

      const maxFundingAmount = fundingScriptCapacity > OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
        ? fundingScriptCapacity - OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
        : 0n;

      const amountError = validateFundingAmount(maxFundingAmount, DEFAULT_FUNDING_AMOUNT_SHANNONS);
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

      // 构建参数
      const openChannelParams = {
        peer_id: peerId,
        funding_amount: toRpcHexAmount(fundingAmount),
        public: true,
        shutdown_script: lockScript,
        funding_lock_script: lockScript,
        funding_fee_rate: toRpcHexAmount(OPEN_CHANNEL_FUNDING_FEE_RATE),
      };

      // JoyID 需要添加 cell deps
      if (this.isJoyIdSigner(signer)) {
        (openChannelParams as Record<string, unknown>).funding_lock_script_cell_deps = JOY_ID_TESTNET_CELL_DEPS;
      }

      const result = await this.bridge.call("openChannelWithExternalFunding", openChannelParams);

      console.log("Open channel result:", result);

      // 签名交易
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
   * 刷新 Channel 列表
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
   * 关闭 Channel
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
   * 渲染 Channel 列表
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
   * 创建单个 Channel 项
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
   * 处理 Channel 列表点击
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
   * 更新操作按钮状态
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
   * 更新状态显示
   */
  private updateStatus(): void {
    this.statusEl.textContent = appStore.getState().fiber.status;
  }

  private setFiberStatus(status: string): void {
    appStore.setNestedState("fiber", "status", status);
  }

  /**
   * 恢复保存的私钥
   */
  private restoreStoredPrivateKey(): void {
    const saved = localStorage.getItem(CKB_PRIVATE_KEY_STORAGE_KEY)?.trim() ?? "";
    if (saved && isHex32(saved)) {
      this.ckbPrivateKeyInput.value = saved;
    }
  }

  /**
   * 判断是否为 JoyID Signer
   */
  private isJoyIdSigner(signer: ccc.Signer): boolean {
    return signer.signType === ccc.SignerSignType.JoyId;
  }

  /**
   * 转换 script 格式
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
   * JoyID 签名
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
   * CCC 签名（简化版）
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
