/**
 * Console UI 组件
 * 
 * Fiber Host 的控制台界面管理器，支持多种显示模式：
 * - Popup 模式：传统弹窗
 * - Iframe 模式：嵌入 iframe
 * 
 * 提供统一的日志显示、状态管理和控制台输出劫持功能。
 */

export interface ConsoleUIOptions {
  /** 运行模式标识 */
  mode?: string;
  /** 是否显示跨域隔离状态 */
  showIsolationStatus?: boolean;
  /** 最大日志条目数 */
  maxEntries?: number;
}

export class ConsoleUI {
  private logsEl: HTMLDivElement;
  private statusEl: HTMLParagraphElement;
  private channelEl: HTMLSpanElement;
  private maxEntries: number;
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };

  constructor(options: ConsoleUIOptions = {}) {
    const { mode, showIsolationStatus = false, maxEntries = 400 } = options;
    this.maxEntries = maxEntries;

    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) {
      throw new Error("Missing #app element");
    }

    // 构建工具栏内容
    const toolbarItems: string[] = [];
    
    if (mode) {
      // 检查隔离状态（支持 DIP 和传统 crossOriginIsolated）
      let isIsolated = window.crossOriginIsolated;
      if (!isIsolated && showIsolationStatus) {
        try {
          new SharedArrayBuffer(1);
          isIsolated = true;
        } catch {
          isIsolated = false;
        }
      }
      const isolationStatus = showIsolationStatus 
        ? isIsolated ? "isolated" : "not-isolated"
        : null;
      toolbarItems.push(`<span class="pill" data-role="host-mode" title="Running mode">${mode}</span>`);
      if (isolationStatus) {
        toolbarItems.push(`<span class="pill" data-role="dip-status" title="Cross-Origin Isolation">${isolationStatus}</span>`);
      }
    }
    
    toolbarItems.push(`<span class="pill" data-role="host-channel">Waiting for channel...</span>`);
    toolbarItems.push(`<button type="button" data-role="clear-logs" class="tool-button">Clear console</button>`);

    app.innerHTML = `
      <main class="host-shell">
        <section class="console-panel">
          <div class="console-toolbar">
            <span class="console-title">Console</span>
            <div class="bar-actions">
              ${toolbarItems.join("\n              ")}
            </div>
          </div>
          <div class="console-meta">
            <span><strong>Fiber Host</strong> runtime output</span>
            <span data-role="host-status">idle</span>
          </div>
          <div data-role="host-logs" class="console-view">
            <div data-role="empty-state" class="console-empty">No messages yet.</div>
          </div>
        </section>
      </main>
    `;

    this.logsEl = app.querySelector<HTMLDivElement>("[data-role='host-logs']")!;
    this.statusEl = app.querySelector<HTMLParagraphElement>("[data-role='host-status']")!;
    this.channelEl = app.querySelector<HTMLSpanElement>("[data-role='host-channel']")!;
    // 绑定清除按钮
    app.querySelector<HTMLButtonElement>("[data-role='clear-logs']")?.addEventListener("click", () => {
      this.clear();
    });

    // 保存原始 console
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console)
    };

    // 劫持 console
    this.hijackConsole();

    // 全局错误处理
    window.addEventListener("error", (event) => {
      const error = event.error instanceof Error ? event.error : event.message;
      this.append("error", ["[window.error]", error]);
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.append("error", ["[unhandledrejection]", event.reason]);
    });

    // 记录初始化信息
    this.originalConsole.log("[ConsoleUI] initialized", { mode, crossOriginIsolated: window.crossOriginIsolated });
  }

  setStatus(status: string): void {
    this.statusEl.textContent = status;
  }

  setChannel(name: string): void {
    this.channelEl.textContent = name;
  }

  clear(): void {
    this.logsEl.innerHTML = '<div data-role="empty-state" class="console-empty">No messages yet.</div>';
  }

  private hijackConsole(): void {
    const mirror = (level: keyof typeof this.originalConsole) => (...values: unknown[]) => {
      this.originalConsole[level](...values);
      this.append(level, values);
    };

    console.log = mirror("log");
    console.info = mirror("info");
    console.warn = mirror("warn");
    console.error = mirror("error");
    console.debug = mirror("debug");
  }

  private append(level: "log" | "info" | "warn" | "error" | "debug", values: unknown[]): void {
    this.logsEl.querySelector<HTMLElement>("[data-role='empty-state']")?.remove();

    const entry = document.createElement("div");
    const icon = document.createElement("span");
    const timeEl = document.createElement("span");
    const messageEl = document.createElement("pre");

    const now = new Date();
    const time = now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const message = values.map((v) => this.formatValue(v)).join(" ");
    const icons: Record<typeof level, string> = {
      log: ">",
      info: "i",
      warn: "!",
      error: "x",
      debug: "~"
    };

    entry.className = `console-row ${level}`;
    icon.className = "console-icon";
    icon.textContent = icons[level];
    timeEl.className = "console-time";
    timeEl.textContent = time;
    messageEl.className = "console-message";
    messageEl.textContent = message;

    entry.append(icon, timeEl, messageEl);
    this.logsEl.append(entry);

    // 限制条目数
    while (this.logsEl.childElementCount > this.maxEntries) {
      this.logsEl.firstElementChild?.remove();
    }

    this.logsEl.scrollTop = this.logsEl.scrollHeight;
  }

  private formatValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    if (typeof value === "bigint") return `${value}n`;

    try {
      return JSON.stringify(
        value,
        (_, v) => (typeof v === "bigint" ? `${v}n` : v),
        2
      );
    } catch {
      return String(value);
    }
  }
}
