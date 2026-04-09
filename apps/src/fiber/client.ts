import { stringify } from "@ckb-ccc/connector-react";
import { Fiber, randomSecretKey } from "@nervosnetwork/fiber-js";
import type {
  CkbJsonRpcTransaction,
  Channel,
  GetInvoiceResult,
  GetPaymentCommandParams,
  GetPaymentCommandResult,
  InvoiceParams,
  InvoiceResult,
  NewInvoiceParams,
  ParseInvoiceResult,
  Script,
  SendPaymentCommandParams
} from "@nervosnetwork/fiber-js";
import { getFiberConfig } from "./config";
import type { ChannelStatus, ChannelSummary, PayInvoiceInfo } from "./types";

type RelayInfo = {
  address: string;
  peerId: string;
};

type CompatPeerInfo = {
  address?: string;
  peer_id?: string;
  pubkey?: string;
};

export type OpenChannelWithExternalFundingCompatParams = {
  pubkey: string;
  funding_amount: `0x${string}`;
  public?: boolean;
  funding_udt_type_script?: Script;
  shutdown_script: Script;
  funding_lock_script: Script;
  funding_lock_script_cell_deps?: Array<{
    dep_type: "code" | "dep_group";
    out_point: {
      tx_hash: `0x${string}`;
      index: `0x${string}`;
    };
  }>;
  commitment_delay_epoch?: `0x${string}`;
  commitment_fee_rate?: `0x${string}`;
  funding_fee_rate?: `0x${string}`;
  tlc_expiry_delta?: `0x${string}`;
  tlc_min_value?: `0x${string}`;
  tlc_fee_proportional_millionths?: `0x${string}`;
  max_tlc_value_in_flight?: `0x${string}`;
  max_tlc_number_in_flight?: `0x${string}`;
};

type OpenChannelWithExternalFundingCompatResult = {
  channel_id: `0x${string}`;
  unsigned_funding_tx: CkbJsonRpcTransaction;
};

type FiberCompat = Fiber & {
  openChannelWithExternalFunding(
    params: OpenChannelWithExternalFundingCompatParams
  ): Promise<OpenChannelWithExternalFundingCompatResult>;
};

type FiberClientOptions = {
  configPath?: string;
  secretStorageKey?: string;
  databasePrefix?: string;
  logLevel?: "trace" | "debug" | "info" | "error";
};

const OPEN_CHANNEL_INIT_RETRY_ATTEMPTS = 80;
const OPEN_CHANNEL_INIT_RETRY_INTERVAL_MS = 300;
const SUBMIT_SIGNED_FUNDING_TX_RETRY_ATTEMPTS = 30;
const SUBMIT_SIGNED_FUNDING_TX_RETRY_INTERVAL_MS = 500;

const isHex32 = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);

const parsePeerId = (address: string): string => address.trim().match(/\/p2p\/([^/]+)(?:\/|$)/)?.[1] ?? "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
};

const isPeerInitPendingError = (error: unknown): boolean =>
  getErrorMessage(error).includes("waiting for peer to send Init message");

const isSubmitSignedFundingTxRetryableError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("channelnotfound") ||
    message.includes("channel is closed") ||
    message.includes("peer not found") ||
    message.includes("messaging failed")
  );
};

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex length");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
};

const bytesToHex = (bytes: Uint8Array): `0x${string}` => {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
};

const getOrCreateFiberSecret = (storageKey: string): Uint8Array => {
  const fromStorage = localStorage.getItem(storageKey);
  if (fromStorage && isHex32(fromStorage)) {
    return hexToBytes(fromStorage);
  }

  const generated = randomSecretKey();
  localStorage.setItem(storageKey, bytesToHex(generated));
  return generated;
};

const toRpcHexNumber = (value: string | number | bigint): `0x${string}` => {
  if (typeof value === "string") {
    return (value.startsWith("0x") ? value : `0x${BigInt(value).toString(16)}`) as `0x${string}`;
  }
  return `0x${BigInt(value).toString(16)}`;
};

const parseHexToBigInt = (value?: string): bigint | null => {
  if (!value) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const hexShannonsToCkb = (value?: string): number | null => {
  const amount = parseHexToBigInt(value);
  return amount === null ? null : Number(amount) / 100_000_000;
};

const readInvoiceAttr = (attrs: Array<Record<string, unknown>>, key: string): string => {
  const matched = attrs.find((attr) => key in attr);
  if (!matched) {
    return "--";
  }
  const value = matched[key];
  return typeof value === "string" ? value : String(value);
};

export const toFiberScript = (script: {
  codeHash: string;
  hashType: string;
  args: string;
}): Script => ({
  code_hash: script.codeHash as `0x${string}`,
  hash_type: script.hashType as "data" | "type" | "data1" | "data2",
  args: script.args as `0x${string}`
});

export const toFiberCellDep = (cellDep: {
  depType: string;
  outPoint: {
    txHash: string;
    index: string | number | bigint;
  };
}): {
  dep_type: "code" | "dep_group";
  out_point: {
    tx_hash: `0x${string}`;
    index: `0x${string}`;
  };
} => ({
  dep_type: cellDep.depType === "depGroup" || cellDep.depType === "dep_group" ? "dep_group" : "code",
  out_point: {
    tx_hash: cellDep.outPoint.txHash as `0x${string}`,
    index: toRpcHexNumber(cellDep.outPoint.index)
  }
});

export const getChannelStatusTone = (stateName?: string): ChannelStatus => {
  switch (stateName?.toLowerCase()) {
    case "ready":
    case "channelready":
    case "established":
    case "running":
      return "good";
    case "syncing":
    case "awaiting_tx_signatures":
    case "awaitingchannelready":
    case "awaitingtxsignatures":
    case "collaboratingfundingtx":
    case "signingcommitment":
      return "warn";
    case "awaiting_peer":
    case "connecting":
    case "negotiatingfunding":
      return "idle";
    case "closed":
    case "shutting_down":
      return "error";
    default:
      return "idle";
  }
};

export const normalizeChannelStateName = (stateName?: string): string | undefined =>
  stateName?.trim().toLowerCase();

export const isCreatedChannelReady = (stateName?: string): boolean => {
  const normalized = normalizeChannelStateName(stateName);
  return (
    normalized === "ready" ||
    normalized === "channelready" ||
    normalized === "established" ||
    normalized === "running"
  );
};

export const isCreatedChannelCollaborating = (stateName?: string): boolean => {
  const normalized = normalizeChannelStateName(stateName);
  return (
    normalized === "negotiatingfunding" ||
    normalized === "collaboratingfundingtx" ||
    normalized === "signingcommitment" ||
    normalized === "awaitingtxsignatures" ||
    normalized === "awaitingchannelready"
  );
};

export const isCreatedChannelFailed = (stateName?: string): boolean => {
  const normalized = normalizeChannelStateName(stateName);
  if (!normalized) {
    return false;
  }

  return (
    normalized === "closed" ||
    normalized === "shutting_down" ||
    normalized === "shutdown" ||
    normalized === "failed" ||
    normalized === "error" ||
    normalized.includes("fail") ||
    normalized.includes("error")
  );
};

export const toChannelSummary = (channel: Channel): ChannelSummary => {
  const rawStateName = (channel as { state?: { state_name?: string } }).state?.state_name;
  const localBalance = BigInt(channel.local_balance || "0x0");
  return {
    id: channel.channel_id,
    status: getChannelStatusTone(rawStateName),
    statusLabel: rawStateName || "Unknown",
    balance: Number(localBalance) / 100_000_000,
    isReady: isCreatedChannelReady(rawStateName),
    rawStateName
  };
};

export const buildPayInvoiceInfo = (
  targetValue: string,
  invoice: ParseInvoiceResult["invoice"]
): PayInvoiceInfo => {
  const attrs = invoice.data.attrs as unknown as Array<Record<string, unknown>>;
  return {
    invoiceAddress: targetValue,
    paymentHash: invoice.data.payment_hash,
    currency: invoice.currency,
    amountCkb: hexShannonsToCkb(invoice.amount),
    expiry: readInvoiceAttr(attrs, "ExpiryTime"),
    description: readInvoiceAttr(attrs, "Description")
  };
};

export class FiberClient {
  private fiber: Fiber | null = null;
  private readonly configPath: string;
  private readonly secretStorageKey: string;
  private readonly databasePrefix: string;
  private readonly logLevel: "trace" | "debug" | "info" | "error";

  constructor(options: FiberClientOptions = {}) {
    this.configPath = options.configPath ?? "/fiber-config-testnet.yml";
    this.secretStorageKey = options.secretStorageKey ?? "fiber-wallet:fiber-secret";
    this.databasePrefix = options.databasePrefix ?? "/wasm-fiber-wallet";
    this.logLevel = options.logLevel ?? "info";
  }

  async start(): Promise<void> {
    if (this.fiber) {
      console.log("[fiber-wasm] start skipped: already started");
      return;
    }

    console.log("[fiber-wasm] loading config", {
      configPath: this.configPath,
      databasePrefix: this.databasePrefix,
      logLevel: this.logLevel
    });
    const config = await getFiberConfig(this.configPath);

    const fiber = new Fiber();
    const fiberSecret = getOrCreateFiberSecret(this.secretStorageKey);
    console.log("[fiber-wasm] fiber secret ready", {
      secretStorageKey: this.secretStorageKey
    });

    await fiber.start(config, fiberSecret, undefined, undefined, this.logLevel, this.databasePrefix);
    this.fiber = fiber;
  }

  async stop(): Promise<void> {
    if (!this.fiber) {
      return;
    }
    await this.fiber.stop();
    this.fiber = null;
  }

  parseRelayInfo(address: string): RelayInfo {
    const peerId = parsePeerId(address);
    if (!peerId) {
      throw new Error("Target node address must include /p2p/<peer-id>");
    }
    return {
      address: address.trim(),
      peerId
    };
  }

  async connectPeer(info: RelayInfo): Promise<string> {
    const fiber = this.assertStarted();

    console.log("[fiber-wasm] connectPeer begin", info);
    await fiber.connectPeer({ address: info.address });
    console.log("[fiber-wasm] connectPeer rpc submitted", info);

    for (let i = 0; i < 20; i += 1) {
      const peers = await fiber.listPeers();
      const found = (peers.peers as CompatPeerInfo[]).find((peer) => {
        if (peer.peer_id) {
          return peer.peer_id === info.peerId;
        }
        return peer.address === info.address;
      });
      console.log("[fiber-wasm] connectPeer poll", {
        attempt: i + 1,
        targetPeerId: info.peerId,
        peerCount: peers.peers.length,
        found: Boolean(found)
      });
      if (found?.pubkey) {
        console.log("[fiber-wasm] connectPeer success", info);
        return found.pubkey;
      }
      await sleep(400);
    }

    console.error("[fiber-wasm] connectPeer timeout", info);
    throw new Error("Peer connection timeout");
  }

  async listRawChannels(): Promise<Channel[]> {
    const result = await this.assertStarted().listChannels({});
    return result.channels;
  }

  async listChannels(): Promise<ChannelSummary[]> {
    const fiberChannels = await this.listRawChannels();
    return fiberChannels.map(toChannelSummary);
  }

  async getChannelInfo(channelId: string): Promise<ChannelSummary | null> {
    const targetId = channelId.trim().toLowerCase();
    if (!targetId) {
      throw new Error("channelId is required");
    }

    const channels = await this.listChannels();
    return channels.find((channel) => channel.id.toLowerCase() === targetId) ?? null;
  }

  async parseInvoice(invoice: string): Promise<ParseInvoiceResult> {
    const trimmed = invoice.trim();
    if (!trimmed) {
      throw new Error("invoice id is required");
    }

    return this.assertStarted().parseInvoice({
      invoice: trimmed
    });
  }

  async lookupInvoice(invoice: string): Promise<PayInvoiceInfo> {
    const parsed = await this.parseInvoice(invoice);
    return buildPayInvoiceInfo(invoice.trim(), parsed.invoice);
  }

  async createInvoice(params: NewInvoiceParams): Promise<InvoiceResult> {
    return this.assertStarted().newInvoice(params);
  }

  async getInvoice(params: InvoiceParams): Promise<GetInvoiceResult> {
    return this.assertStarted().getInvoice(params);
  }

  async waitInvoicePaid(
    paymentHash: `0x${string}`,
    onTick?: (status: string) => void
  ): Promise<GetInvoiceResult> {
    while (true) {
      const result = await this.getInvoice({ payment_hash: paymentHash });
      onTick?.(result.status);
      if (result.status === "Received" || result.status === "Paid") {
        return result;
      }
      await sleep(500);
    }
  }

  async sendPayment(params: SendPaymentCommandParams): Promise<GetPaymentCommandResult> {
    return this.assertStarted().sendPayment(params);
  }

  async getPaymentStatus(params: GetPaymentCommandParams): Promise<GetPaymentCommandResult> {
    return this.assertStarted().getPayment(params);
  }

  async openChannel(
    params: OpenChannelWithExternalFundingCompatParams
  ): Promise<OpenChannelWithExternalFundingCompatResult> {
    const fiber = this.assertStarted() as FiberCompat;
    let result: OpenChannelWithExternalFundingCompatResult | undefined;

    for (let i = 0; i < OPEN_CHANNEL_INIT_RETRY_ATTEMPTS; i += 1) {
      try {
        result = await fiber.openChannelWithExternalFunding(params);
        break;
      } catch (error) {
        if (!isPeerInitPendingError(error) || i === OPEN_CHANNEL_INIT_RETRY_ATTEMPTS - 1) {
          throw error;
        }

        console.warn("[fiber-wasm] peer init not ready, retrying openChannelWithExternalFunding", {
          attempt: i + 1,
          maxAttempts: OPEN_CHANNEL_INIT_RETRY_ATTEMPTS,
          pubkey: params.pubkey
        });
        await sleep(OPEN_CHANNEL_INIT_RETRY_INTERVAL_MS);
      }
    }

    if (!result) {
      throw new Error("openChannelWithExternalFunding returned no result");
    }

    console.log(`openChannelWithExternalFunding Res: ${stringify(result)}`);
    const normalized = result as {
      channel_id?: `0x${string}`;
      temporary_channel_id?: `0x${string}`;
      unsigned_funding_tx: CkbJsonRpcTransaction;
    };
    const channelId = normalized.channel_id ?? normalized.temporary_channel_id;
    if (!channelId) {
      throw new Error("Missing channel id in openChannelWithExternalFunding result");
    }

    return {
      channel_id: channelId,
      unsigned_funding_tx: normalized.unsigned_funding_tx
    };
  }

  async waitChannelReady(
    channelId: string,
    onTick?: (channel: ChannelSummary | null) => Promise<void> | void
  ): Promise<ChannelSummary | null> {
    while (true) {
      const channel = await this.getChannelInfo(channelId);
      await onTick?.(channel);

      if (!channel) {
        return null;
      }
      if (isCreatedChannelReady(channel.rawStateName) || isCreatedChannelFailed(channel.rawStateName)) {
        return channel;
      }

      await sleep(500);
    }
  }

  async submitSignedFundingTx(channelId: string, signedTx: CkbJsonRpcTransaction) {
    return this.assertStarted().submitSignedFundingTx({
      channel_id: channelId as `0x${string}`,
      signed_funding_tx: signedTx
    });
  }

  async submitSignedFundingTxWithRetry(channelId: string, signedTx: CkbJsonRpcTransaction) {
    const fiber = this.assertStarted();

    for (let i = 0; i < SUBMIT_SIGNED_FUNDING_TX_RETRY_ATTEMPTS; i += 1) {
      try {
        return await fiber.submitSignedFundingTx({
          channel_id: channelId as `0x${string}`,
          signed_funding_tx: signedTx
        });
      } catch (error) {
        if (
          !isSubmitSignedFundingTxRetryableError(error) ||
          i === SUBMIT_SIGNED_FUNDING_TX_RETRY_ATTEMPTS - 1
        ) {
          throw error;
        }

        console.warn("[fiber-wasm] submitSignedFundingTx not ready, retrying", {
          attempt: i + 1,
          maxAttempts: SUBMIT_SIGNED_FUNDING_TX_RETRY_ATTEMPTS,
          channelId,
          message: getErrorMessage(error)
        });
        await sleep(SUBMIT_SIGNED_FUNDING_TX_RETRY_INTERVAL_MS);
      }
    }
  }

  async closeChannel(channelId: string) {
    return this.assertStarted().shutdownChannel({
      channel_id: channelId as `0x${string}`
    });
  }

  getFiberInstance(): Fiber | null {
    return this.fiber;
  }

  private assertStarted(): Fiber {
    if (!this.fiber) {
      throw new Error("Fiber node not initialized. Please click Init Fiber Node first.");
    }
    return this.fiber;
  }
}
