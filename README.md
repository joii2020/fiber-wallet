# fiber-wallet

Fiber Wallet - A CKB Fiber Network wallet application.

## Local Development

```bash
pnpm install
pnpm dev
```

Default access: http://localhost:5173/

For Fiber WASM on another device in your LAN, plain `http://<your-lan-ip>:5173` is not enough because `SharedArrayBuffer` requires a trustworthy secure context.

Place a development certificate and key at:

- `apps/certs/dev-cert.pem`
- `apps/certs/dev-key.pem`

Or point Vite at custom files with:

- `VITE_DEV_SSL_CERT=/absolute/path/to/dev-cert.pem`
- `VITE_DEV_SSL_KEY=/absolute/path/to/dev-key.pem`

When those files exist, the app dev server and preview server automatically enable HTTPS, so you can open:

- `https://localhost:5173/`
- `https://<your-lan-ip>:5173/`

If you need to force HTTPS startup explicitly, use:

```bash
pnpm --dir apps dev:https
```

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

## Native Node WSS Deployment Guide
[Native Node WSS Deployment Guide](./deploy/native-node/README.md)
