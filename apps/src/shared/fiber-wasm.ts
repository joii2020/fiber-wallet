import { Fiber, randomSecretKey } from "@nervosnetwork/fiber-js";
import type {
  CkbJsonRpcTransaction,
  Channel,
  GetPaymentCommandParams,
  GetInvoiceResult,
  GetPaymentCommandResult,
  InvoiceResult,
  InvoiceParams,
  NewInvoiceParams,
  ParseInvoiceResult,
  SendPaymentCommandParams,
  Script
} from "@nervosnetwork/fiber-js";
import { getFiberConfig } from "./fiber-config";
import { stringify } from "@ckb-ccc/connector-react";

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

const CKB_SHANNONS = 100000000n;
// Match Fiber's source behavior: peer init timeout is 20s, so keep retrying
// a bit longer than that before surfacing an error to the user.
const OPEN_CHANNEL_INIT_RETRY_ATTEMPTS = 80;
const OPEN_CHANNEL_INIT_RETRY_INTERVAL_MS = 300;
const SUBMIT_SIGNED_FUNDING_TX_RETRY_ATTEMPTS = 30;
const SUBMIT_SIGNED_FUNDING_TX_RETRY_INTERVAL_MS = 500;

const isHex32 = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);

const parsePeerId = (address: string): string => {
  return address.trim().match(/\/p2p\/([^/]+)(?:\/|$)/)?.[1] ?? "";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getErrorMessage = (error: unknown): string => {
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

const ckbToShannonsHex = (amountCkb: string): `0x${string}` => {
  const trimmed = amountCkb.trim();
  if (!trimmed) {
    throw new Error("Funding amount is required");
  }

  const [whole, frac = ""] = trimmed.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac)) {
    throw new Error("Funding amount must be a decimal number");
  }

  const fracPadded = (frac + "00000000").slice(0, 8);
  const shannons = BigInt(whole || "0") * CKB_SHANNONS + BigInt(fracPadded || "0");
  if (shannons <= 0n) {
    throw new Error("Funding amount must be greater than 0");
  }

  return `0x${shannons.toString(16)}`;
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

const toRpcHexNumber = (value: string | number | bigint): `0x${string}` => {
  if (typeof value === "string") {
    return (value.startsWith("0x") ? value : `0x${BigInt(value).toString(16)}`) as `0x${string}`;
  }
  return `0x${BigInt(value).toString(16)}`;
};

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

type FiberWasmManagerOptions = {
  configPath?: string;
  secretStorageKey?: string;
  databasePrefix?: string;
  logLevel?: "trace" | "debug" | "info" | "error";
};

export class FiberWasmManager {
  private fiber: Fiber | null = null;
  private readonly configPath: string;
  private readonly secretStorageKey: string;
  private readonly databasePrefix: string;
  private readonly logLevel: "trace" | "debug" | "info" | "error";

  constructor(options: FiberWasmManagerOptions = {}) {
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
      if (found) {
        const pubkey = found.pubkey;
        if (!pubkey) {
          throw new Error("Connected peer pubkey not found");
        }
        console.log("[fiber-wasm] connectPeer success", info);
        return pubkey;
      }
      await sleep(400);
    }

    console.error("[fiber-wasm] connectPeer timeout", info);
    throw new Error("Peer connection timeout");
  }

  async listChannels(): Promise<Channel[]> {
    const result = await this.assertStarted().listChannels({});
    return result.channels;
  }

  async getChannelInfo(channelId: string): Promise<Channel | null> {
    const targetId = channelId.trim().toLowerCase();
    if (!targetId) {
      throw new Error("channelId is required");
    }

    const channels = await this.listChannels();
    const matched = channels.find((channel) => channel.channel_id.toLowerCase() === targetId);
    return matched ?? null;
  }

  async parseInvoice(invoice: string): Promise<ParseInvoiceResult> {
    const trimmed = invoice.trim();
    if (!trimmed) {
      throw new Error("invoice id is required");
    }

    return this.assertStarted().parseInvoice({
      invoice: trimmed,
    });
  }

  async newInvoice(params: NewInvoiceParams): Promise<InvoiceResult> {
    return this.assertStarted().newInvoice(params);
  }

  async getInvoice(params: InvoiceParams): Promise<GetInvoiceResult> {
    return this.assertStarted().getInvoice(params);
  }

  async sendPayment(params: SendPaymentCommandParams): Promise<GetPaymentCommandResult> {
    return this.assertStarted().sendPayment(params);
  }

  async getPayment(params: GetPaymentCommandParams): Promise<GetPaymentCommandResult> {
    return this.assertStarted().getPayment(params);
  }

  async openChannelWithExternalFunding(
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

  async shutdownChannel(channelId: string) {
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
