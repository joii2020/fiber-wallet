import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * 原始方案：COOP/COEP 头部配置
 * 用于弹窗模式的 fiber-host.html
 */
const COOP_COEP_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
} as const;

/**
 * 新方案：Document-Isolation-Policy (DIP) 配置
 * 用于 iframe 模式的 fiber-host-dip.html
 * 
 * DIP 优势：
 * 1. 不需要切断 opener 引用（不像 COOP）
 * 2. 可以使用 iframe 嵌入，避免弹窗拦截
 * 3. 仍然启用跨源隔离环境
 * 
 * 可选值：
 * - isolate-and-credentialless: 隔离环境，跨源请求不携带 credentials
 * - isolate-and-require-corp: 隔离环境，跨源资源需要 CORP 头部
 */
const DIP_VALUE = "isolate-and-credentialless";
const DIP_HEADERS = {
  "Document-Isolation-Policy": DIP_VALUE
} as const;

// 判断是否为 COOP/COEP 页面（弹窗模式）
const isCoopCoepPage = (url: string): boolean => {
  return (
    url === "/demo/fiber-host.html" ||
    url.startsWith("/demo/fiber-host.html?")
  );
};

// 判断是否为 DIP 页面（iframe 模式）
const isDipPage = (url: string): boolean => {
  return (
    url === "/demo/" ||
    url.startsWith("/demo/?") ||
    url === "/demo/index.html" ||
    url.startsWith("/demo/index.html?") ||
    url === "/demo/fiber-host-dip.html" ||
    url.startsWith("/demo/fiber-host-dip.html?")
  );
};

const patchFiberJsInitSync = () => ({
  name: "patch-fiber-js-initsync",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.includes("@nervosnetwork/fiber-js/index.js")) {
      return null;
    }

    const patchedCode = code
      .replace("YA(e.n(_A)());", "YA({module:e.n(_A)()});")
      .replace("qA(W.n(Og)());", "qA({module:W.n(Og)()});");

    if (patchedCode === code) {
      return null;
    }

    return {
      code: patchedCode,
      map: null
    };
  }
});

export default defineConfig({
  resolve: {
    alias: {
      buffer: "buffer/"
    }
  },
  define: {
    global: "globalThis"
  },
  optimizeDeps: {
    include: ["buffer"],
    exclude: ["@nervosnetwork/fiber-js"]
  },
  plugins: [
    patchFiberJsInitSync(),
    {
      name: "demo-path-redirect",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (url === "/demo" || url.startsWith("/demo?")) {
            res.statusCode = 302;
            res.setHeader("Location", "/demo/");
            res.end();
            return;
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (url === "/demo" || url.startsWith("/demo?")) {
            res.statusCode = 302;
            res.setHeader("Location", "/demo/");
            res.end();
            return;
          }
          next();
        });
      }
    },
    {
      name: "isolation-headers",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          
          // COOP/COEP 方案（弹窗模式）
          if (isCoopCoepPage(url)) {
            for (const [key, value] of Object.entries(COOP_COEP_HEADERS)) {
              res.setHeader(key, value);
            }
            console.log(`[COOP/COEP] Applied to: ${url}`);
          }
          
          // DIP 方案（iframe 模式）
          if (isDipPage(url)) {
            for (const [key, value] of Object.entries(DIP_HEADERS)) {
              res.setHeader(key, value);
            }
            console.log(`[DIP] Applied to: ${url}`);
          }

          // 为 DIP 父页面添加 CORP 头部，允许被 DIP iframe 加载
          if (
            url === "/demo/" ||
            url.startsWith("/demo/?") ||
            url === "/demo/index.html" ||
            url.startsWith("/demo/index.html?")
          ) {
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          }
          
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          
          if (isCoopCoepPage(url)) {
            for (const [key, value] of Object.entries(COOP_COEP_HEADERS)) {
              res.setHeader(key, value);
            }
          }
          
          if (isDipPage(url)) {
            for (const [key, value] of Object.entries(DIP_HEADERS)) {
              res.setHeader(key, value);
            }
          }

          if (
            url === "/demo/" ||
            url.startsWith("/demo/?") ||
            url === "/demo/index.html" ||
            url.startsWith("/demo/index.html?")
          ) {
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          }

          next();
        });
      }
    }
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/fiber-api": {
        target: "http://127.0.0.1:8247",
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        wallet: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo/index.html"),
        fiberHost: resolve(__dirname, "demo/fiber-host.html"),
        fiberHostDip: resolve(__dirname, "demo/fiber-host-dip.html")
      }
    }
  }
});
