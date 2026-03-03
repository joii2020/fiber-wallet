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

## External Funding 语义

`fiber-js` 的 external funding 流程现在按以下语义工作：

- `openChannelWithExternalFunding(params)` 仍返回 `{ channel_id, unsigned_funding_tx }`
- 这里的 `unsigned_funding_tx` 已经是双方协商完成后的最终 unsigned funding tx，不应由前端再次重建或改写交易结构
- 外部钱包应直接对这笔 tx 签名一次
- `submitSignedFundingTx(params)` 仍接收 `{ channel_id, signed_funding_tx }`，提交时只能补 `witnesses` / signatures，不能修改 `inputs`、`outputs`、`outputs_data`、`cell_deps` 等交易结构字段

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
