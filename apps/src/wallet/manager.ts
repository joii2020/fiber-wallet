import { ccc } from "@ckb-ccc/ccc";
import type { CkbJsonRpcTransaction } from "@nervosnetwork/fiber-js";
import {
  authWithRedirect,
  signMessageWithRedirect,
  type AuthResponseData,
  type CKBTransaction as JoyIdCkbTransaction,
  type SignMessageRequest,
  type SignMessageResponseData
} from "@joyid/common";
import { calculateChallenge } from "@joyid/ckb";
import { toFiberCellDep } from "../fiber/client";
import { toCccTransaction } from "./transaction";

const JOYID_PENDING_FUNDING_STORAGE_KEY = "fiber-wallet:joyid-pending-funding";
const JOYID_PENDING_FUNDING_MAX_AGE_MS = 10 * 60 * 1000;
const JOYID_SECP256R1_HEX_BYTES = 64;
const JOYID_SECP256R1_SCALAR_HEX_BYTES = 32;

type FundingSignerSupport = {
  supported: boolean;
  reason?: string;
};

type JoyIdConnection = {
  address: string;
  publicKey: string;
  keyType: string;
};

export type JoyIdRedirectState =
  | { kind: "connect"; timestamp: number }
  | { kind: "sign-funding"; channelId: string; peerId: string; timestamp: number };

export type PendingJoyIdFunding = {
  channelId: string;
  peerId: string;
  unsignedFundingTx: CkbJsonRpcTransaction;
  joyIdTx: JoyIdCkbTransaction;
  witnessIndexes: number[];
  fundingAmount: string;
  createdAt: number;
};

export type JoyIdWalletPanelInfo = {
  address: string;
  internalAddress: string;
  balance: string;
};

export function truncateAddress(address: string, startChars = 8, endChars = 6): string {
  if (!address || address.length <= startChars + endChars + 3) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

export const formatCkb = (value: number): string => `${value.toFixed(2)} CKB`;

/**
 * Prepare witness for OmniLock signing by adjusting the placeholder format.
 * Fiber generates witnesses with 174-byte placeholders for secp256k1 signatures,
 * but OmniLock expects 85-byte placeholders.
 */
const prepareOmniLockWitness = (tx: ccc.Transaction, lockScript: ccc.Script): void => {
  const OMNI_LOCK_WITNESS_LOCK_LEN = 85;

  for (let i = 0; i < tx.inputs.length; i += 1) {
    const input = tx.inputs[i];
    if (!input.cellOutput) {
      continue;
    }
    if (!lockScript.eq(input.cellOutput.lock)) {
      continue;
    }

    let witnessArgs = tx.getWitnessArgsAt(i);
    if (!witnessArgs) {
      witnessArgs = ccc.WitnessArgs.from({});
    }

    witnessArgs.lock = ccc.hexFrom(new Uint8Array(OMNI_LOCK_WITNESS_LOCK_LEN).fill(0));
    tx.setWitnessArgsAt(i, witnessArgs);
  }
};

const utf8ToHex = (value: string): string =>
  Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const trimLeadingZeroBytes = (hex: string): string => {
  let normalized = hex.replace(/^0x/i, "");
  while (normalized.length > 2 && normalized.startsWith("00")) {
    normalized = normalized.slice(2);
  }
  return normalized;
};

const normalizeFixedWidthHex = (hex: string, expectedBytes: number): string => {
  const expectedLength = expectedBytes * 2;
  let normalized = trimLeadingZeroBytes(hex);
  if (normalized.length > expectedLength) {
    throw new Error(`JoyID returned an oversized signing field (${normalized.length} hex chars)`);
  }
  if (normalized.length % 2 === 1) {
    normalized = `0${normalized}`;
  }
  return normalized.padStart(expectedLength, "0").toLowerCase();
};

const derSignatureHexToP1363 = (hex: string): string | null => {
  const normalized = hex.replace(/^0x/i, "").toLowerCase();
  if (!normalized.startsWith("30")) {
    return null;
  }

  const bytes = Uint8Array.from(
    normalized.match(/../g) ?? [],
    (byte) => Number.parseInt(byte, 16)
  );
  if (bytes.length < 8 || bytes[0] !== 0x30) {
    return null;
  }

  let offset = 1;
  const readLength = (): number => {
    const first = bytes[offset++];
    if (first === undefined) {
      throw new Error("Invalid DER signature length");
    }
    if ((first & 0x80) === 0) {
      return first;
    }
    const count = first & 0x7f;
    if (count === 0 || count > 4) {
      throw new Error("Unsupported DER signature length encoding");
    }
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const next = bytes[offset++];
      if (next === undefined) {
        throw new Error("Truncated DER signature length");
      }
      value = (value << 8) | next;
    }
    return value;
  };

  try {
    const sequenceLength = readLength();
    if (offset + sequenceLength !== bytes.length) {
      return null;
    }
    if (bytes[offset++] !== 0x02) {
      return null;
    }
    const rLength = readLength();
    const r = bytes.slice(offset, offset + rLength);
    offset += rLength;
    if (bytes[offset++] !== 0x02) {
      return null;
    }
    const sLength = readLength();
    const s = bytes.slice(offset, offset + sLength);
    offset += sLength;
    if (offset !== bytes.length) {
      return null;
    }

    return `${normalizeFixedWidthHex(bytesToHex(r), JOYID_SECP256R1_SCALAR_HEX_BYTES)}${normalizeFixedWidthHex(bytesToHex(s), JOYID_SECP256R1_SCALAR_HEX_BYTES)}`;
  } catch {
    return null;
  }
};

const decodeBase64LikeToHex = (value: string): string | null => {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    return null;
  }

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytesToHex(bytes);
  } catch {
    return null;
  }
};

const normalizeHexForWitness = (
  value: string,
  field: "pubkey" | "signature" | "message",
  expectedBytes?: number
): string => {
  let normalized = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(normalized)) {
    const decodedBase64 = decodeBase64LikeToHex(value);
    if (decodedBase64 !== null) {
      normalized = decodedBase64;
    } else if (field === "message") {
      normalized = utf8ToHex(value);
    } else {
      throw new Error(`JoyID returned a non-hex ${field}`);
    }
  }

  if (normalized.length % 2 === 1) {
    normalized = `0${normalized}`;
  }

  if (expectedBytes !== undefined) {
    if (field === "signature") {
      const maybeDerSignature = derSignatureHexToP1363(normalized);
      if (maybeDerSignature !== null) {
        return maybeDerSignature;
      }
    }
    normalized = normalizeFixedWidthHex(normalized, expectedBytes);
  }

  return normalized.toLowerCase();
};

const DEFAULT_APP_ICON =
  "https://raw.githubusercontent.com/ckb-devrel/ccc/master/assets/logo.svg";

const KNOWN_LOCK_SCRIPTS = [
  ccc.KnownScript.Secp256k1Blake160,
  ccc.KnownScript.Secp256k1Multisig,
  ccc.KnownScript.Secp256k1MultisigV2,
  ccc.KnownScript.AnyoneCanPay,
  ccc.KnownScript.JoyId,
  ccc.KnownScript.PWLock,
  ccc.KnownScript.OmniLock,
  ccc.KnownScript.NostrLock
] as const;

const supportsLockScript = (
  signer: ccc.Signer,
  knownScript: ccc.KnownScript
): FundingSignerSupport => {
  switch (knownScript) {
    case ccc.KnownScript.Secp256k1Blake160:
      return signer.type === ccc.SignerType.CKB &&
        signer.signType === ccc.SignerSignType.CkbSecp256k1
        ? { supported: true }
        : { supported: false, reason: "Signer does not support secp256k1 funding locks" };
    case ccc.KnownScript.JoyId:
      return signer.signType === ccc.SignerSignType.JoyId
        ? { supported: true }
        : { supported: false, reason: "Signer does not support JoyID funding locks" };
    case ccc.KnownScript.OmniLock:
      return signer.type === ccc.SignerType.BTC ||
        signer.type === ccc.SignerType.Doge ||
        signer.type === ccc.SignerType.EVM
        ? { supported: true }
        : {
            supported: false,
            reason: "OmniLock funding requires a BTC, Doge, or EVM signer"
          };
    case ccc.KnownScript.PWLock:
      return signer.type === ccc.SignerType.EVM
        ? { supported: true }
        : { supported: false, reason: "PW Lock funding requires an EVM signer" };
    case ccc.KnownScript.NostrLock:
      return signer.type === ccc.SignerType.Nostr
        ? { supported: true }
        : { supported: false, reason: "NostrLock funding requires a Nostr signer" };
    default:
      return { supported: false, reason: `Unsupported funding lock script: ${knownScript}` };
  }
};

export type CkbSignerInfo = {
  id: string;
  label: string;
  walletName: string;
  walletIcon: string;
  signerName: string;
  signer: ccc.Signer;
};

export type CccWalletManagerOptions = {
  client?: ccc.Client;
  appName?: string;
  appIcon?: string;
};

export const withFundingTxWitnesses = (
  fundingTx: CkbJsonRpcTransaction,
  witnesses: string[]
): CkbJsonRpcTransaction => {
  const tx = fundingTx as CkbJsonRpcTransaction & {
    cellDeps?: CkbJsonRpcTransaction["cell_deps"];
    headerDeps?: CkbJsonRpcTransaction["header_deps"];
    outputsData?: CkbJsonRpcTransaction["outputs_data"];
  };

  return {
    version: tx.version,
    cell_deps: tx.cell_deps ?? tx.cellDeps ?? [],
    header_deps: tx.header_deps ?? tx.headerDeps ?? [],
    inputs: tx.inputs ?? [],
    outputs: tx.outputs ?? [],
    outputs_data: tx.outputs_data ?? tx.outputsData ?? [],
    witnesses: witnesses.map((witness) => witness as `0x${string}`)
  };
};

export const getCleanCurrentUrl = (): string => {
  const url = new URL(window.location.href);
  url.searchParams.delete("_data_");
  url.searchParams.delete("joyid-redirect");
  return url.toString();
};

export const cleanupJoyIdRedirectParams = (): void => {
  const url = new URL(window.location.href);
  url.searchParams.delete("_data_");
  url.searchParams.delete("joyid-redirect");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
};

export const loadPendingJoyIdFunding = (): PendingJoyIdFunding | null => {
  const raw = localStorage.getItem(JOYID_PENDING_FUNDING_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PendingJoyIdFunding;
  } catch {
    localStorage.removeItem(JOYID_PENDING_FUNDING_STORAGE_KEY);
    return null;
  }
};

export const savePendingJoyIdFunding = (pending: PendingJoyIdFunding): void => {
  localStorage.setItem(JOYID_PENDING_FUNDING_STORAGE_KEY, JSON.stringify(pending));
};

export const clearPendingJoyIdFunding = (): void => {
  localStorage.removeItem(JOYID_PENDING_FUNDING_STORAGE_KEY);
};

export const getPendingJoyIdFundingError = (
  pending: PendingJoyIdFunding | null,
  state: JoyIdRedirectState | undefined
): string | null => {
  if (state?.kind !== "sign-funding") {
    return "Missing JoyID funding redirect state";
  }
  if (!pending) {
    return "Missing pending JoyID funding request";
  }
  if (Date.now() - pending.createdAt > JOYID_PENDING_FUNDING_MAX_AGE_MS) {
    return "Pending JoyID funding request expired";
  }
  if (pending.channelId !== state.channelId || pending.peerId !== state.peerId) {
    return "JoyID funding redirect does not match the pending channel";
  }
  return null;
};

export const normalizeJoyIdSignResponse = (
  response: SignMessageResponseData
): SignMessageResponseData => ({
  ...response,
  pubkey: normalizeHexForWitness(response.pubkey, "pubkey", JOYID_SECP256R1_HEX_BYTES),
  signature: normalizeHexForWitness(response.signature, "signature", JOYID_SECP256R1_HEX_BYTES),
  message: normalizeHexForWitness(response.message, "message")
});

export class CccWalletManager {
  private readonly signersController = new ccc.SignersController();
  private readonly client: ccc.Client;
  private readonly appName: string;
  private readonly appIcon: string;

  constructor(options: CccWalletManagerOptions = {}) {
    this.client = options.client ?? new ccc.ClientPublicTestnet();
    this.appName = options.appName ?? "Fiber Wallet";
    this.appIcon = options.appIcon ?? DEFAULT_APP_ICON;
  }

  async refreshCkbSigners(): Promise<CkbSignerInfo[]> {
    return new Promise((resolve, reject) => {
      this.signersController
        .refresh(
          this.client,
          (wallets) => {
            const infos: CkbSignerInfo[] = [];
            for (const wallet of wallets) {
              for (const signerInfo of wallet.signers) {
                if (
                  signerInfo.signer.type !== ccc.SignerType.CKB &&
                  signerInfo.signer.type !== ccc.SignerType.BTC &&
                  signerInfo.signer.type !== ccc.SignerType.EVM &&
                  signerInfo.signer.type !== ccc.SignerType.Doge &&
                  signerInfo.signer.type !== ccc.SignerType.Nostr
                ) {
                  continue;
                }

                const id = `${wallet.name}::${signerInfo.name}::${infos.length}`;
                infos.push({
                  id,
                  label: `${wallet.name} / ${signerInfo.name}`,
                  walletName: wallet.name,
                  walletIcon: wallet.icon,
                  signerName: signerInfo.name,
                  signer: signerInfo.signer
                });
              }
            }
            resolve(infos);
          },
          {
            name: this.appName,
            icon: this.appIcon
          }
        )
        .catch((error) => reject(error));
    });
  }

  async getJoyIdCkbSigner(): Promise<CkbSignerInfo | null> {
    const signers = await this.refreshCkbSigners();
    return (
      signers.find(
        (info) =>
          info.signer.type === ccc.SignerType.CKB &&
          info.signer.signType === ccc.SignerSignType.JoyId
      ) ?? null
    );
  }

  async persistJoyIdCkbConnection(response: Pick<AuthResponseData, "address" | "pubkey" | "keyType">) {
    const signerInfo = await this.getJoyIdCkbSigner();
    if (!signerInfo) {
      throw new Error("JoyID CKB signer is unavailable");
    }

    const signer = signerInfo.signer as ccc.Signer & {
      connection?: JoyIdConnection;
      saveConnection?: () => Promise<void>;
    };

    signer.connection = {
      address: response.address,
      publicKey: ccc.hexFrom(response.pubkey),
      keyType: response.keyType
    };

    if (typeof signer.saveConnection === "function") {
      await signer.saveConnection();
    }

    return signerInfo;
  }

  redirectToJoyIdAuth(redirectURL: string, state?: unknown): void {
    authWithRedirect({
      redirectURL,
      joyidAppURL: this.client.addressPrefix === "ckb" ? "https://app.joy.id" : "https://testnet.joyid.dev",
      name: this.appName,
      logo: this.appIcon,
      requestNetwork: "nervos",
      state
    });
  }

  async prepareJoyIdSignTx(
    unsignedTx: CkbJsonRpcTransaction,
    signer: ccc.Signer
  ): Promise<{
    tx: JoyIdCkbTransaction;
    witnessIndexes: number[];
    address: string;
    challenge: string;
  }> {
    const tx = ccc.Transaction.from(toCccTransaction(unsignedTx));
    const { script } = await signer.getRecommendedAddressObj();
    const witnessIndexes = await ccc.reduceAsync(tx.inputs, async (acc, input, index) => {
      const { cellOutput } = await input.getCell(this.client);
      if (cellOutput.lock.eq(script)) {
        acc.push(index);
      }
    }, [] as number[]);

    const firstWitnessIndex = witnessIndexes[0];
    if (firstWitnessIndex === undefined) {
      throw new Error("No JoyID-controlled inputs found in funding transaction");
    }

    await tx.prepareSighashAllWitness(script, firstWitnessIndex, this.client);
    tx.inputs.forEach((input) => {
      input.cellOutput = undefined;
      input.outputData = undefined;
    });

    const joyIdTx = JSON.parse(tx.stringify()) as JoyIdCkbTransaction;
    const challenge = await calculateChallenge(joyIdTx, witnessIndexes);

    return {
      tx: joyIdTx,
      witnessIndexes,
      address: await signer.getRecommendedAddress(),
      challenge
    };
  }

  redirectToJoyIdSignTx(
    request: Pick<SignMessageRequest, "challenge" | "address" | "redirectURL" | "state">
  ): void {
    signMessageWithRedirect({
      challenge: request.challenge,
      address: request.address,
      redirectURL: request.redirectURL,
      joyidAppURL: this.client.addressPrefix === "ckb" ? "https://app.joy.id" : "https://testnet.joyid.dev",
      name: this.appName,
      logo: this.appIcon,
      state: request.state
    });
  }

  async connectSigner(signer: ccc.Signer): Promise<{ signer: ccc.Signer; address: string }> {
    if (!(await signer.isConnected())) {
      await signer.connect();
    }
    const address = await signer.getRecommendedAddress();
    return { signer, address };
  }

  async loadJoyIdWalletInfo(signer: ccc.Signer): Promise<JoyIdWalletPanelInfo> {
    const [address, internalAddress, balance] = await Promise.all([
      signer.getRecommendedAddress(),
      signer.getInternalAddress(),
      signer.getBalance()
    ]);

    return {
      address,
      internalAddress,
      balance: ccc.fixedPointToString(balance)
    };
  }

  async signFundingTx(
    unsignedTx: CkbJsonRpcTransaction,
    signer: ccc.Signer
  ): Promise<CkbJsonRpcTransaction> {
    const support = await this.getFundingSignerSupport(signer);
    if (!support.supported) {
      throw new Error(support.reason ?? "Unsupported signer for funding transaction");
    }

    const cccTxLike = toCccTransaction(unsignedTx);
    const cccTx = ccc.Transaction.from(cccTxLike);
    const addressObj = await signer.getRecommendedAddressObj();
    const lockScript = ccc.Script.from(addressObj.script);

    const omniLockScriptInfo = await signer.client.getKnownScript(ccc.KnownScript.OmniLock);
    const isOmniLock =
      signer.type === ccc.SignerType.BTC ||
      signer.type === ccc.SignerType.Doge ||
      (signer.type === ccc.SignerType.EVM &&
        omniLockScriptInfo.codeHash === lockScript.codeHash);

    if (isOmniLock) {
      await Promise.all(
        cccTx.inputs.map(async (input) => {
          await input.completeExtraInfos(this.client);
        })
      );
      prepareOmniLockWitness(cccTx, lockScript);
    }

    const signedTx = await signer.signOnlyTransaction(cccTx);
    return withFundingTxWitnesses(unsignedTx, signedTx.witnesses);
  }

  async getFundingSignerSupport(signer: ccc.Signer): Promise<FundingSignerSupport> {
    const addressObj = await signer.getRecommendedAddressObj();
    const lockScript = ccc.Script.from(addressObj.script);

    for (const knownScript of KNOWN_LOCK_SCRIPTS) {
      const scriptInfo = await signer.client.getKnownScript(knownScript);
      if (
        scriptInfo.codeHash !== lockScript.codeHash ||
        scriptInfo.hashType !== lockScript.hashType
      ) {
        continue;
      }

      return supportsLockScript(signer, knownScript);
    }

    return {
      supported: false,
      reason: "Funding address uses an unknown lock script"
    };
  }

  async getFundingLockScriptCellDeps(signer: ccc.Signer): Promise<
    | {
        dep_type: "code" | "dep_group";
        out_point: {
          tx_hash: `0x${string}`;
          index: `0x${string}`;
        };
      }[]
    | undefined
  > {
    const addressObj = await signer.getRecommendedAddressObj();
    const lockScript = ccc.Script.from(addressObj.script);

    for (const knownScript of KNOWN_LOCK_SCRIPTS) {
      const scriptInfo = await signer.client.getKnownScript(knownScript);
      if (
        scriptInfo.codeHash !== lockScript.codeHash ||
        scriptInfo.hashType !== lockScript.hashType
      ) {
        continue;
      }

      const cellDeps = await signer.client.getCellDeps(scriptInfo.cellDeps);
      return cellDeps.map((cellDep) =>
        toFiberCellDep({
          depType: cellDep.depType,
          outPoint: {
            txHash: cellDep.outPoint.txHash,
            index: cellDep.outPoint.index
          }
        })
      );
    }

    return undefined;
  }
}
