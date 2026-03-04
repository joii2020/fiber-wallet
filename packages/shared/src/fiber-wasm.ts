import { Fiber, randomSecretKey } from "@nervosnetwork/fiber-js";
import type {
  CkbJsonRpcTransaction,
  Channel,
  OpenChannelWithExternalFundingParams,
  OpenChannelWithExternalFundingResult,
  Script
} from "@nervosnetwork/fiber-js";
import { getFiberConfig } from "./fiber-config";
import { stringify } from "@ckb-ccc/ccc";

export type RelayInfo = {
  address: string;
  peerId: string;
};

const CKB_SHANNONS = 100000000n;

const isHex32 = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);

const parsePeerId = (address: string): string => {
  return address.trim().match(/\/p2p\/([^/]+)(?:\/|$)/)?.[1] ?? "";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export const ckbToShannonsHex = (amountCkb: string): `0x${string}` => {
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

export type FiberWasmManagerOptions = {
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
    this.configPath = options.configPath ?? "/demo/fiber-config-testnet.yml";
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
    console.log("[fiber-wasm] config loaded");

    const fiber = new Fiber();
    const fiberSecret = getOrCreateFiberSecret(this.secretStorageKey);
    console.log("[fiber-wasm] fiber secret ready", {
      secretStorageKey: this.secretStorageKey
    });

    console.log("[fiber-wasm] calling fiber.start()");
    await fiber.start(config, fiberSecret, undefined, undefined, this.logLevel, this.databasePrefix);
    this.fiber = fiber;
    console.log("[fiber-wasm] fiber.start() resolved");

    console.log("[fiber-wasm] nodeInfo", `${stringify(await fiber.nodeInfo())}`);
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

  async connectPeer(info: RelayInfo): Promise<void> {
    const fiber = this.assertStarted();

    console.log("[fiber-wasm] connectPeer begin", info);
    await fiber.connectPeer({ address: info.address });
    console.log("[fiber-wasm] connectPeer rpc submitted", info);

    for (let i = 0; i < 20; i += 1) {
      const peers = await fiber.listPeers();
      const found = peers.peers.some((peer) => peer.peer_id === info.peerId);
      console.log("[fiber-wasm] connectPeer poll", {
        attempt: i + 1,
        targetPeerId: info.peerId,
        peerCount: peers.peers.length,
        found
      });
      if (found) {
        console.log("[fiber-wasm] connectPeer success", info);
        return;
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

  async openChannelWithExternalFunding(
    params: OpenChannelWithExternalFundingParams
  ): Promise<OpenChannelWithExternalFundingResult> {
    // fiber-js now returns the final negotiated unsigned funding tx.
    return this.assertStarted().openChannelWithExternalFunding(params);
  }

  async submitSignedFundingTx(channelId: string, signedTx: CkbJsonRpcTransaction) {
    // Only witnesses/signatures should differ from the previously returned funding tx.
    return this.assertStarted().submitSignedFundingTx({
      channel_id: channelId as `0x${string}`,
      signed_funding_tx: signedTx
    });
  }

  async shutdownChannel(channelId: string) {
    return this.assertStarted().shutdownChannel({
      channel_id: channelId as `0x${string}`
    });
  }

  private assertStarted(): Fiber {
    if (!this.fiber) {
      throw new Error("Fiber node not initialized. Please click Init Fiber Node first.");
    }
    return this.fiber;
  }
}
