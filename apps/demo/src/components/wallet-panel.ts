/**
 * 钱包面板组件
 * 管理钱包连接状态、余额显示等
 */

import { ccc } from "@ckb-ccc/ccc";
import { CccWalletManager, type CkbSignerInfo } from "@fiber-wallet/shared";
import { BaseComponent } from "./base-component";
import { WalletModal } from "./wallet-modal";
import { appStore } from "../stores/app-store";
import { truncateAddress, formatBalance } from "../utils/format";
import { isWalletConnectCanceled } from "../utils/validators";
import { DEFAULT_APP_ICON } from "../config/constants";

export interface WalletPanelOptions {
  onConnect?: () => void;
  onError?: (message: string) => void;
}

export class WalletPanel extends BaseComponent {
  private walletManager: CccWalletManager;
  private modal: WalletModal;
  private options: WalletPanelOptions;

  // DOM 元素引用
  private connectBtn: HTMLButtonElement;
  private mainLabelEl: HTMLSpanElement;
  private statusEl: HTMLParagraphElement;
  private summaryEl: HTMLDivElement;
  private iconEl: HTMLImageElement;
  private balanceEl: HTMLParagraphElement;
  private addressEl: HTMLParagraphElement;
  private refreshBtn: HTMLButtonElement;

  constructor(containerSelector: string, options: WalletPanelOptions = {}) {
    super(containerSelector);
    this.options = options;

    this.walletManager = new CccWalletManager({
      appName: "Fiber Wallet Demo"
    });

    // 初始化 DOM 引用
    this.connectBtn = this.getElement("[data-role='wallet-connect']");
    this.mainLabelEl = this.getElement("[data-role='wallet-main-label']");
    this.statusEl = this.getElement("[data-role='wallet-status']");
    this.summaryEl = this.getElement("[data-role='wallet-summary']");
    this.iconEl = this.getElement("[data-role='wallet-icon']");
    this.balanceEl = this.getElement("[data-role='wallet-balance']");
    this.addressEl = this.getElement("[data-role='wallet-address']");
    this.refreshBtn = this.getElement("[data-role='wallet-balance-refresh']");

    // 初始化弹窗
    this.modal = new WalletModal(containerSelector, {
      onSelect: (info) => this.handleWalletSelect(info),
      onClose: () => this.handleModalClose()
    });
  }

  init(): void {
    this.modal.init();
    this.addEventListener(this.connectBtn, "click", () => this.openWalletSelector());
    this.addEventListener(this.refreshBtn, "click", () => this.refreshBalance());

    // 监听存储变化
    appStore.subscribeNested("wallet", "signer", () => this.updateUI());
    appStore.subscribeNested("wallet", "balance", () => this.updateUI());
    appStore.subscribeNested("wallet", "address", () => this.updateUI());
    appStore.subscribeNested("wallet", "signerInfo", () => this.updateUI());
    appStore.subscribeNested("wallet", "status", () => this.updateStatus());
  }

  render(): void {
    this.updateUI();
  }

  /**
   * 打开钱包选择器
   */
  private async openWalletSelector(): Promise<void> {
    this.connectBtn.disabled = true;
    this.setMainLabel("Scanning...");
    this.setStatus("Wallet: scanning available signers...");

    try {
      const signerInfos = await this.walletManager.refreshCkbSigners();
      appStore.setNestedState("wallet", "signerInfos", signerInfos);

      if (!signerInfos.length) {
        throw new Error("No CKB wallet signer found");
      }

      this.modal.open(signerInfos);
      this.setStatus("Wallet: select a signer to connect");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`Wallet error: ${message}`);
      this.options.onError?.(message);
    } finally {
      this.connectBtn.disabled = false;
    }
  }

  /**
   * 处理钱包选择
   */
  private async handleWalletSelect(info: CkbSignerInfo): Promise<void> {
    this.connectBtn.disabled = true;
    this.setMainLabel("Connecting...");
    this.modal.close();

    try {
      const connected = await this.walletManager.connectSigner(info.signer);
      
      // 更新状态
      appStore.setNestedState("wallet", "signer", connected.signer);
      appStore.setNestedState("wallet", "address", connected.address);
      appStore.setNestedState("wallet", "signerInfo", info);
      appStore.setNestedState("wallet", "status", `Wallet: connected (${info.label})`);

      // 加载余额
      await this.refreshBalance();

      // 触发连接回调
      this.options.onConnect?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isWalletConnectCanceled(error)) {
        this.setStatus("Wallet: connection canceled");
      } else {
        this.setStatus(`Wallet error: ${message}`);
        this.options.onError?.(message);
      }
    } finally {
      this.connectBtn.disabled = false;
    }
  }

  /**
   * 处理弹窗关闭
   */
  private handleModalClose(): void {
    // 如果需要，可以在这里处理弹窗关闭后的逻辑
  }

  /**
   * 刷新余额
   */
  async refreshBalance(): Promise<void> {
    const signer = appStore.getState().wallet.signer;
    if (!signer) return;

    this.refreshBtn.disabled = true;
    appStore.setNestedState("wallet", "balance", null);

    try {
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

      appStore.setNestedState("wallet", "balance", totalCapacity);
    } catch (error) {
      console.warn("Failed to load wallet balance", error);
      // 保持 null 表示加载失败
    } finally {
      this.refreshBtn.disabled = false;
    }
  }

  /**
   * 获取当前 signer
   */
  getSigner(): ccc.Signer | undefined {
    return appStore.getState().wallet.signer;
  }

  /**
   * 更新 UI
   */
  private updateUI(): void {
    const { signer, signerInfo, balance, address } = appStore.getState().wallet;

    if (!signer || !signerInfo || !address) {
      this.summaryEl.hidden = true;
      this.refreshBtn.disabled = true;
      this.setMainLabel("Connect Wallet");
      return;
    }

    this.setMainLabel("Change Wallet");
    this.setWalletIcon(signerInfo.walletIcon, `${signerInfo.walletName} icon`);
    this.balanceEl.textContent = formatBalance(balance);
    this.addressEl.textContent = truncateAddress(address);
    this.refreshBtn.disabled = false;
    this.summaryEl.hidden = false;
  }

  /**
   * 更新状态文本
   */
  private updateStatus(): void {
    this.statusEl.textContent = appStore.getState().wallet.status;
  }

  private setStatus(text: string): void {
    appStore.setNestedState("wallet", "status", text);
  }

  private setMainLabel(text: string): void {
    this.mainLabelEl.textContent = text;
  }

  private setWalletIcon(iconSrc: string, iconAlt: string): void {
    this.iconEl.onerror = () => {
      this.iconEl.onerror = null;
      this.iconEl.src = DEFAULT_APP_ICON;
    };
    this.iconEl.src = iconSrc || DEFAULT_APP_ICON;
    this.iconEl.alt = iconAlt;
  }
}
