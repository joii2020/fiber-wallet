/**
 * 组件基类
 * 提供基础的生命周期和 DOM 操作方法
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
   * 初始化组件（子类应重写）
   */
  abstract init(): void;

  /**
   * 渲染组件（子类应重写）
   */
  abstract render(): void;

  /**
   * 销毁组件
   */
  destroy(): void {
    this.removeAllEventListeners();
    this.isMounted = false;
  }

  /**
   * 安全地添加事件监听
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
   * 移除所有事件监听
   */
  private removeAllEventListeners(): void {
    for (const { element, type, listener } of this.eventListeners) {
      element.removeEventListener(type, listener);
    }
    this.eventListeners = [];
  }

  /**
   * 获取容器内的元素
   */
  protected getElement<T extends Element>(selector: string): T {
    const el = this.container.querySelector<T>(selector);
    if (!el) {
      throw new Error(`Element not found in component: ${selector}`);
    }
    return el;
  }

  /**
   * 创建子元素
   */
  protected createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: Parameters<typeof createElement>[1]
  ): HTMLElementTagNameMap[K] {
    return createElement(tag, options);
  }
}
