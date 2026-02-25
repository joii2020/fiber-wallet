# fiber-wallet

这个仓库现在通过一次开发/部署同时提供两个页面：

- `/`：Fiber Wallet 页面（`apps/src`）
- `/demo/`：Fiber WASM + CCC 演示页（`apps/demo/src`）

## 本地开发

```bash
pnpm install
pnpm dev
```

默认访问：

- http://localhost:5173/
- http://localhost:5173/demo/

## 构建

```bash
pnpm build
```

构建产物在 `apps/dist`，包含 wallet 与 demo 两个页面。

## 单次部署（Vercel）

从同一个仓库创建一个 Project：

- Root Directory: `apps`
- Build Command: `pnpm build`
- Output Directory: `dist`

并使用 `apps/vercel.json` 中的 rewrites，使：

- `/demo/*` 回退到 `/demo/index.html`
- 其他路径回退到 `/index.html`
