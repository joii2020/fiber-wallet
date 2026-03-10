# fiber-wallet

This repository now provides two pages through a single development/deployment:

- `/`: Fiber Wallet page (`apps/src`)
- `/demo/`: Fiber WASM + CCC demo page (`apps/demo/src`)

## Local Development

```bash
pnpm install
pnpm dev
```

Default access:

- http://localhost:5173/
- http://localhost:5173/demo/

## External Funding Semantics

The external funding flow in `fiber-js` now works with the following semantics:

- `openChannelWithExternalFunding(params)` still returns `{ channel_id, unsigned_funding_tx }`
- The `unsigned_funding_tx` here is the final unsigned funding tx after both parties have negotiated, and should not be rebuilt or modified by the frontend
- The external wallet should sign this tx directly once
- `submitSignedFundingTx(params)` still receives `{ channel_id, signed_funding_tx }`, and can only add `witnesses` / signatures during submission, cannot modify transaction structure fields like `inputs`, `outputs`, `outputs_data`, `cell_deps`

## Build

```bash
pnpm build
```

Build output is in `apps/dist`, containing both wallet and demo pages.

## Single Deployment (Vercel)

Create a Project from the same repository:

- Root Directory: `apps`
- Build Command: `pnpm build`
- Output Directory: `dist`

Use the rewrites in `apps/vercel.json` to:

- Fallback `/demo/*` to `/demo/index.html`
- Fallback other paths to `/index.html`
