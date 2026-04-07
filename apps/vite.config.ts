import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const COOP_COEP_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin"
} as const;

const DIP_VALUE = "isolate-and-credentialless";
const DIP_HEADERS = {
  "Document-Isolation-Policy": DIP_VALUE,
  "Cross-Origin-Resource-Policy": "cross-origin"
} as const;

const DIP_URLS = ["/dip.html"] as const;
const COOP_COEP_URLS = ["/coop.html", "/joyid.html"] as const;

const matchesUrl = (url: string, patterns: readonly string[]): boolean =>
  patterns.some(pattern => url === pattern || url.startsWith(`${pattern}?`));

const isDipPage = (url: string): boolean => matchesUrl(url, DIP_URLS);
const isCoopPage = (url: string): boolean => matchesUrl(url, COOP_COEP_URLS);

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

// Isolation headers middleware factory
const createIsolationHeadersMiddleware = (options: { log: boolean }) => 
  (req: any, res: any, next: any) => {
    const url = req.url ?? "";
    
    if (isDipPage(url)) {
      Object.entries(DIP_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
      if (options.log) console.log(`[DIP] Applied to: ${url}`);
    }
    if (isCoopPage(url)) {
      Object.entries(COOP_COEP_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
      if (options.log) console.log(`[COOP/COEP] Applied to: ${url}`);
    }

    next();
  };

const isolationHeadersPlugin = {
  name: "isolation-headers",
  configureServer(server: any) {
    server.middlewares.use(createIsolationHeadersMiddleware({ log: true }));
  },
  configurePreviewServer(server: any) {
    server.middlewares.use(createIsolationHeadersMiddleware({ log: false }));
  }
};

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      buffer: "buffer/"
    }
  },
  define: {
    global: "globalThis"
  },
  optimizeDeps: {
    include: ["buffer", "bech32", "@ckb-ccc/ccc", "@ckb-ccc/connector-react"],
    exclude: ["@nervosnetwork/fiber-js"]
  },
  plugins: [
    react(),
    patchFiberJsInitSync(),
    isolationHeadersPlugin
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
        dip: resolve(__dirname, "dip.html"),
        coop: resolve(__dirname, "coop.html"),
        joyid: resolve(__dirname, "joyid.html")
      }
    }
  }
});
