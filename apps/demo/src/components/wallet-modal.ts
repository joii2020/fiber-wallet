/**
 * 钱包选择弹窗组件
 */

import type { CkbSignerInfo } from "@fiber-wallet/shared";
import { BaseComponent } from "./base-component";
import { DEFAULT_APP_ICON } from "../config/constants";

export interface WalletModalOptions {
  onSelect: (signerInfo: CkbSignerInfo) => void;
  onClose: () => void;
}

export class WalletModal extends BaseComponent {
  private options: WalletModalOptions;
  private modalEl: HTMLDivElement;
  private backdropEl: HTMLButtonElement;
  private closeBtnEl: HTMLButtonElement;
  private optionsListEl: HTMLUListElement;

  constructor(containerSelector: string, options: WalletModalOptions) {
    super(containerSelector);
    this.options = options;
    this.modalEl = this.getElement("[data-role='wallet-modal']");
    this.backdropEl = this.getElement("[data-role='wallet-modal-backdrop']");
    this.closeBtnEl = this.getElement("[data-role='wallet-modal-close']");
    this.optionsListEl = this.getElement("[data-role='wallet-options']");
  }

  init(): void {
    this.addEventListener(this.backdropEl, "click", () => this.close());
    this.addEventListener(this.closeBtnEl, "click", () => this.close());
    this.addEventListener(this.optionsListEl, "click", (e) => this.handleOptionClick(e as MouseEvent));
    this.addEventListener(document, "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") {
        this.close();
      }
    });
  }

  render(): void {
    // 初始状态为空
  }

  /**
   * 打开弹窗并渲染选项
   */
  open(signerInfos: CkbSignerInfo[]): void {
    this.renderOptions(signerInfos);
    this.modalEl.classList.remove("hidden");
    this.modalEl.setAttribute("aria-hidden", "false");
  }

  /**
   * 关闭弹窗
   */
  close(): void {
    this.modalEl.classList.add("hidden");
    this.modalEl.setAttribute("aria-hidden", "true");
    this.options.onClose();
  }

  /**
   * 渲染钱包选项列表
   */
  private renderOptions(infos: CkbSignerInfo[]): void {
    this.optionsListEl.innerHTML = "";

    if (!infos.length) {
      const empty = this.createElement("li", {
        className: "wallet-empty",
        textContent: "No CKB wallet signer found"
      });
      this.optionsListEl.appendChild(empty);
      return;
    }

    for (const info of infos) {
      const li = this.createOptionItem(info);
      this.optionsListEl.appendChild(li);
    }
  }

  /**
   * 创建单个选项元素
   */
  private createOptionItem(info: CkbSignerInfo): HTMLLIElement {
    const li = this.createElement("li");
    const button = this.createElement("button", {
      className: "wallet-option",
      attributes: { "data-signer-id": info.id, type: "button" }
    });

    const icon = this.createElement("img", {
      className: "wallet-option-icon",
      attributes: {
        src: info.walletIcon || DEFAULT_APP_ICON,
        alt: `${info.walletName} icon`,
        loading: "lazy"
      }
    });

    icon.addEventListener("error", () => {
      icon.src = DEFAULT_APP_ICON;
    });

    const meta = this.createElement("div", { className: "wallet-option-meta" });
    const title = this.createElement("p", {
      className: "wallet-option-title",
      textContent: info.walletName
    });
    const sub = this.createElement("p", {
      className: "wallet-option-sub",
      textContent: info.signerName
    });

    meta.appendChild(title);
    meta.appendChild(sub);
    button.appendChild(icon);
    button.appendChild(meta);
    li.appendChild(button);

    return li;
  }

  /**
   * 处理选项点击
   */
  private handleOptionClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-signer-id]");
    if (!button) return;

    const signerId = button.dataset.signerId;
    if (!signerId) return;

    // 获取当前选项列表对应的数据（需要外部传入或存储）
    // 这里简化处理，通过自定义事件传递
    const customEvent = new CustomEvent("walletselect", {
      detail: { signerId },
      bubbles: true
    });
    button.dispatchEvent(customEvent);
  }

  /**
   * 触发选择回调
   */
  triggerSelect(signerInfo: CkbSignerInfo): void {
    this.options.onSelect(signerInfo);
  }
}
