/**
 * DOM 工具函数
 */

/**
 * 获取 DOM 元素，不存在则抛出错误
 */
export function getEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }
  return el;
}

/**
 * 创建元素并设置属性
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    className?: string;
    textContent?: string;
    attributes?: Record<string, string>;
  }
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options?.className) {
    el.className = options.className;
  }
  if (options?.textContent) {
    el.textContent = options.textContent;
  }
  if (options?.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) {
      el.setAttribute(key, value);
    }
  }
  return el;
}

/**
 * 绑定按钮点击事件（带 loading 状态）
 */
export function bindButton(
  selector: string,
  handler: () => Promise<void>,
  options?: {
    onError?: (error: unknown) => void;
    onFinally?: () => void;
  }
): void {
  const button = getEl<HTMLButtonElement>(selector);
  button.addEventListener("click", () => {
    void (async () => {
      button.disabled = true;
      try {
        await handler();
      } catch (error) {
        options?.onError?.(error);
      } finally {
        button.disabled = false;
        options?.onFinally?.();
      }
    })();
  });
}

/**
 * 安全地关闭弹窗
 */
export const closePopupQuietly = (popup: Window | null | undefined): void => {
  if (!popup || popup.closed) {
    return;
  }
  try {
    popup.close();
  } catch {
    // 忽略跨域弹窗关闭失败
  }
};

/**
 * 打开 JoyID 签名弹窗
 */
export const openJoyIdPopup = (): Window => {
  const popup = window.open("", "joyid-sign", "popup=yes,width=420,height=720");
  if (!popup) {
    throw new Error("Unable to open JoyID popup. Please allow popups and try again.");
  }
  return popup;
};
