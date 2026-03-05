/**
 * Document-Isolation-Policy (DIP) 版本的 Vite 配置
 * 
 * 使用 DIP 替代 COOP/COEP，优势：
 * 1. 不需要切断与 opener 的联系
 * 2. 可以使用 iframe 方案替代弹窗
 * 3. 仍然启用跨源隔离，支持 SharedArrayBuffer 等 API
 * 
 * DIP 可选值：
 * - isolate-and-credentialless: 隔离环境，跨源请求不携带 credentials
 * - isolate-and-require-corp: 隔离环境，跨源资源需要 CORP 头部
 */

import { resolve } from "node:path";
import { defineConfig } from "vite";

// Document-Isolation-Policy 配置
const DIP_VALUE = "isolate-and-credentialless";

// 需要 DIP 隔离的页面
const DIP_PAGES = ["/demo/fiber-host.html", "/demo/fiber-host-dip.html"];

const isDipPage = (url: string): boolean => {
  return DIP_PAGES.some((page) => url === page || url.startsWith(`${page}?`));
};

// 原有的 fiber-js patch
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
      name: "document-isolation-policy-headers",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          // 为 DIP 页面添加 Document-Isolation-Policy 头部
          if (isDipPage(url)) {
            res.setHeader("Document-Isolation-Policy", DIP_VALUE);
            console.log(`[DIP] Applied to: ${url}`);
          }
          // 为父页面添加 CORP 头部，允许被 DIP iframe 加载
          if (url === "/demo/" || url === "/demo/index.html") {
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (isDipPage(url)) {
            res.setHeader("Document-Isolation-Policy", DIP_VALUE);
          }
          if (url === "/demo/" || url === "/demo/index.html") {
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
        // DIP 版本
        fiberHostDip: resolve(__dirname, "demo/fiber-host-dip.html")
      }
    }
  }
});
