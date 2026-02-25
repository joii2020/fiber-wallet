import { resolve } from "node:path";
import { defineConfig } from "vite";

const FIBER_HOST_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
} as const;

const isIsolatedDemoRequest = (url: string): boolean => {
  return (
    url === "/demo/fiber-host.html" ||
    url.startsWith("/demo/fiber-host.html?")
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
      name: "fiber-host-isolation-headers",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (isIsolatedDemoRequest(url)) {
            for (const [key, value] of Object.entries(FIBER_HOST_HEADERS)) {
              res.setHeader(key, value);
            }
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (isIsolatedDemoRequest(url)) {
            for (const [key, value] of Object.entries(FIBER_HOST_HEADERS)) {
              res.setHeader(key, value);
            }
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
        fiberHost: resolve(__dirname, "demo/fiber-host.html")
      }
    }
  }
});
