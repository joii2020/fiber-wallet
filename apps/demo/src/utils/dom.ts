/**
 * DOM utility functions
 */

import { JOY_ID_POPUP_HEIGHT, JOY_ID_POPUP_WIDTH } from "../config/constants";

/**
 * Get DOM element, throw error if not exists
 */
export function getEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }
  return el;
}

/**
 * Create element and set attributes
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
 * Safely close popup
 */
export const closePopupQuietly = (popup: Window | null | undefined): void => {
  if (!popup || popup.closed) {
    return;
  }
  try {
    popup.close();
  } catch {
    // Ignore cross-origin popup close failure
  }
};

/**
 * Open JoyID signature popup
 */
export const openJoyIdPopup = (): Window => {
  const popup = window.open(
    "",
    "joyid-sign",
    `popup=yes,width=${JOY_ID_POPUP_WIDTH},height=${JOY_ID_POPUP_HEIGHT}`
  );
  if (!popup) {
    throw new Error("Unable to open JoyID popup. Please allow popups and try again.");
  }
  return popup;
};
