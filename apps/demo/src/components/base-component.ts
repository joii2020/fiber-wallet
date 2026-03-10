/**
 * Component Base Class
 * Provides basic lifecycle and DOM operation methods
 */

import { getEl, createElement } from "../utils/dom";

export abstract class BaseComponent {
  protected container: HTMLElement;
  protected isMounted = false;
  protected eventListeners: Array<{ element: EventTarget; type: string; listener: EventListener }> = [];

  constructor(containerSelector: string) {
    this.container = getEl(containerSelector);
  }

  /**
   * Initialize component (subclasses should override)
   */
  abstract init(): void;

  /**
   * Render component (subclasses should override)
   */
  abstract render(): void;

  /**
   * Destroy component
   */
  destroy(): void {
    this.removeAllEventListeners();
    this.isMounted = false;
  }

  /**
   * Safely add event listener
   */
  protected addEventListener<K extends keyof HTMLElementEventMap>(
    element: EventTarget,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void
  ): void;
  protected addEventListener(
    element: EventTarget,
    type: string,
    listener: EventListener
  ): void {
    element.addEventListener(type, listener);
    this.eventListeners.push({ element, type, listener });
  }

  /**
   * Remove all event listeners
   */
  private removeAllEventListeners(): void {
    for (const { element, type, listener } of this.eventListeners) {
      element.removeEventListener(type, listener);
    }
    this.eventListeners = [];
  }

  /**
   * Get element within container
   */
  protected getElement<T extends Element>(selector: string): T {
    const el = this.container.querySelector<T>(selector);
    if (!el) {
      throw new Error(`Element not found in component: ${selector}`);
    }
    return el;
  }

  /**
   * Create child element
   */
  protected createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: Parameters<typeof createElement>[1]
  ): HTMLElementTagNameMap[K] {
    return createElement(tag, options);
  }
}
