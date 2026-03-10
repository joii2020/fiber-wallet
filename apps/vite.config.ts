import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Original solution: COOP/COEP header configuration
 * For popup mode fiber-host.html
 */
const COOP_COEP_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
} as const;

/**
 * New solution: Document-Isolation-Policy (DIP) configuration
 * For iframe mode fiber-host-dip.html
 * 
 * DIP advantages:
 * 1. Does not need to cut opener reference (unlike COOP)
 * 2. Can use iframe embedding, avoiding popup blocking
 * 3. Still enables cross-origin isolation environment
 * 
 * Optional values:
 * - isolate-and-credentialless: Isolated environment, cross-origin requests don't carry credentials
 * - isolate-and-require-corp: Isolated environment, cross-origin resources need CORP headers
 */
const DIP_VALUE = "isolate-and-credentialless";
const DIP_HEADERS = {
  "Document-Isolation-Policy": DIP_VALUE
} as const;

// Check if COOP/COEP page (popup mode)
const isCoopCoepPage = (url: string): boolean => {
  return (
    url === "/demo/fiber-host.html" ||
    url.startsWith("/demo/fiber-host.html?")
  );
};

// Check if DIP page (iframe mode)
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
          
          // COOP/COEP solution (popup mode)
          if (isCoopCoepPage(url)) {
            for (const [key, value] of Object.entries(COOP_COEP_HEADERS)) {
              res.setHeader(key, value);
            }
            console.log(`[COOP/COEP] Applied to: ${url}`);
          }
          
          // DIP solution (iframe mode)
          if (isDipPage(url)) {
            for (const [key, value] of Object.entries(DIP_HEADERS)) {
              res.setHeader(key, value);
            }
            console.log(`[DIP] Applied to: ${url}`);
          }

          // Add CORP headers for DIP parent page to allow loading by DIP iframe
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
