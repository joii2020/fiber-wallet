import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ccc as cccConnector, stringify } from "@ckb-ccc/connector-react";
import { ccc } from "@ckb-ccc/ccc";
import {
  getRedirectResponse,
  isRedirectFromJoyID,
  type AuthResponseData,
  type CKBTransaction as JoyIdCkbTransaction,
  type SignMessageResponseData
} from "@joyid/common";
import { buildSignedTx } from "@joyid/ckb";
import type { Channel as FiberChannel, CkbJsonRpcTransaction } from "@nervosnetwork/fiber-js";
import {
  CccWalletManager,
  withFundingTxWitnesses,
  type CkbSignerInfo
} from "./shared/ccc-wallet";
import {
  toFiberScript,
  type OpenChannelWithExternalFundingCompatParams
} from "./shared/fiber-wasm";
import { WalletButton } from "./components/WalletButton";
import { ActionCard } from "./components/ui";
import { PayModal } from "./components/PayModal";
import { ReceiveModal } from "./components/ReceiveModal";
import { ChannelsModal } from "./components/ChannelsModal";
import { JoyIdWalletModal } from "./components/JoyIdWalletModal";
import { FiberWasmRuntimeError, fiber, fiberReady } from "./services/fiber-wasm";
import { truncateAddress } from "./utils/stringUtils";
import { DEFAULT_CHANNEL_PEER_ADDRESS } from "./config";
import { isJoyIdPageMode } from "./shared/page-mode";

type FiberStatus = "loading" | "running" | "error";
type ModalKey = "pay" | "receive" | "channels" | null;
type PayStep = "input" | "review";
type ReceiveStep = "idle" | "creating" | "waiting" | "paid";
type ChannelStatus = "good" | "warn" | "idle" | "error";
type PayLookupTarget = { kind: "payment_hash" | "invoice"; value: string };
type Channel = {
  id: string;
  status: ChannelStatus;
  statusLabel: string;
  balance: number;
  isReady: boolean;
  rawStateName?: string;
};
type PendingCreatedChannel = {
  id: string;
  peerId: string;
  hasAppeared: boolean;
};
type PayInvoiceInfo = {
  invoiceAddress: string;
  paymentHash: string;
  currency: string;
  amountCkb: number | null;
  expiry: string;
  description: string;
};
type ResolvedChannelSigner = {
  signer: ccc.Signer;
  address: string;
  label: string;
};
type JoyIdRedirectState =
  | { kind: "connect"; timestamp: number }
  | { kind: "sign-funding"; channelId: string; peerId: string; timestamp: number };
type PendingJoyIdFunding = {
  channelId: string;
  peerId: string;
  unsignedFundingTx: CkbJsonRpcTransaction;
  joyIdTx: JoyIdCkbTransaction;
  witnessIndexes: number[];
  fundingAmount: string;
  createdAt: number;
};
type JoyIdWalletPanelInfo = {
  address: string;
  internalAddress: string;
  balance: string;
};

const logFundingTxDebug = (
  label: string,
  channelId: string,
  tx: CkbJsonRpcTransaction,
  extra?: Record<string, unknown>
): void => {
  const firstInput = tx.inputs?.[0];
  const firstWitness = tx.witnesses?.[0];
  console.log(`[funding-tx] ${label}`, {
    channelId,
    version: tx.version,
    inputCount: tx.inputs?.length ?? 0,
    outputCount: tx.outputs?.length ?? 0,
    witnessCount: tx.witnesses?.length ?? 0,
    firstInputPreviousOutput: firstInput?.previous_output ?? null,
    firstInputSince: firstInput?.since ?? null,
    firstWitness: firstWitness ?? null,
    cellDeps: tx.cell_deps ?? [],
    headerDeps: tx.header_deps ?? [],
    inputs: tx.inputs ?? [],
    outputs: tx.outputs ?? [],
    outputsData: tx.outputs_data ?? [],
    witnesses: tx.witnesses ?? [],
    ...extra
  });
};

const SHANNONS_PER_CKB = 100000000n;
const DEFAULT_FUNDING_AMOUNT_SHANNONS = 1000n * SHANNONS_PER_CKB;
const OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS = 120n * SHANNONS_PER_CKB;
const OPEN_CHANNEL_FUNDING_FEE_RATE = 3000n;
const CHANNEL_CREATION_POLL_INTERVAL_MS = 500;
const CHANNEL_CREATION_RECONNECT_INTERVAL_MS = 3000;
const PAYMENT_STATUS_POLL_ATTEMPTS = 10;
const RECEIVE_INVOICE_STATUS_POLL_INTERVAL_MS = 500;
const DEFAULT_RECEIVE_AMOUNT_SHANNONS = 1n * SHANNONS_PER_CKB;
const MIN_RECEIVE_FINAL_EXPIRY_DELTA = "0x927c00";
const PAYMENT_HASH_HEX_REGEX = /^0x[0-9a-fA-F]{64}$/;
const PAYMENT_HASH_HEX_SEARCH_REGEX = /0x[0-9a-fA-F]{64}/;
const INVOICE_SEARCH_REGEX = /(fib[bdt][a-z0-9]*1[023456789acdefghjklmnpqrstuvwxyz]+)/i;
const INVISIBLE_SPACES_REGEX = /[\s\u200B-\u200D\uFEFF]/g;
const JOYID_PENDING_FUNDING_STORAGE_KEY = "fiber-wallet:joyid-pending-funding";
const JOYID_PENDING_FUNDING_MAX_AGE_MS = 10 * 60 * 1000;
const JOYID_SECP256R1_HEX_BYTES = 64;
const JOYID_SECP256R1_SCALAR_HEX_BYTES = 32;

const toRpcHexAmount = (amount: bigint): `0x${string}` => `0x${amount.toString(16)}`;
const formatCkb = (value: number): string => `${value.toFixed(2)} CKB`;

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

const normalizeJoyIdSignResponse = (
  response: SignMessageResponseData
): SignMessageResponseData => ({
  ...response,
  pubkey: normalizeHexForWitness(response.pubkey, "pubkey", JOYID_SECP256R1_HEX_BYTES),
  signature: normalizeHexForWitness(response.signature, "signature", JOYID_SECP256R1_HEX_BYTES),
  message: normalizeHexForWitness(response.message, "message")
});

const getChannelStatusTone = (stateName?: string): ChannelStatus => {
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

const normalizeChannelStateName = (stateName?: string) => stateName?.trim().toLowerCase();

const isCreatedChannelReady = (stateName?: string) => {
  const normalized = normalizeChannelStateName(stateName);
  return (
    normalized === "ready" ||
    normalized === "channelready" ||
    normalized === "established" ||
    normalized === "running"
  );
};

const isCreatedChannelCollaborating = (stateName?: string) => {
  const normalized = normalizeChannelStateName(stateName);
  return (
    normalized === "negotiatingfunding" ||
    normalized === "collaboratingfundingtx" ||
    normalized === "signingcommitment" ||
    normalized === "awaitingtxsignatures" ||
    normalized === "awaitingchannelready"
  );
};

const isCreatedChannelFailed = (stateName?: string) => {
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

const convertFiberChannels = (fiberChannels: FiberChannel[]): Channel[] =>
  fiberChannels.map((channel) => {
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
  });

const createRandomHex32 = (): `0x${string}` => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${hex}`;
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

const normalizePayLookupInput = (value: string) => value.replace(INVISIBLE_SPACES_REGEX, "");

const extractPayLookupTarget = (value: string): PayLookupTarget | null => {
  const normalized = normalizePayLookupInput(value);
  const paymentHash = normalized.match(PAYMENT_HASH_HEX_SEARCH_REGEX)?.[0];
  if (paymentHash && PAYMENT_HASH_HEX_REGEX.test(paymentHash)) {
    return { kind: "payment_hash", value: paymentHash.toLowerCase() };
  }

  const invoice = normalized.match(INVOICE_SEARCH_REGEX)?.[1];
  if (invoice) {
    return { kind: "invoice", value: invoice.toLowerCase() };
  }

  return null;
};

const toFriendlyPayLookupError = (message: string): string => {
  const lower = message.toLowerCase();
  if (lower.includes("invalid checksum") || lower.includes("invalid length")) {
    return "Invalid invoice format. Please paste the full fibt/fibb/fibd invoice string only.";
  }
  if (lower.includes("invoice not found")) {
    return "Invoice not found in current Fiber node.";
  }
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
};

const isInvoiceFormatError = (message: string): boolean => {
  const lower = message.toLowerCase();
  return lower.includes("invalid checksum") || lower.includes("invalid length");
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getCleanCurrentUrl = (): string => {
  const url = new URL(window.location.href);
  url.searchParams.delete("_data_");
  url.searchParams.delete("joyid-redirect");
  return url.toString();
};

const cleanupJoyIdRedirectParams = (): void => {
  const url = new URL(window.location.href);
  url.searchParams.delete("_data_");
  url.searchParams.delete("joyid-redirect");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
};

const loadPendingJoyIdFunding = (): PendingJoyIdFunding | null => {
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

const savePendingJoyIdFunding = (pending: PendingJoyIdFunding): void => {
  localStorage.setItem(JOYID_PENDING_FUNDING_STORAGE_KEY, JSON.stringify(pending));
};

const clearPendingJoyIdFunding = (): void => {
  localStorage.removeItem(JOYID_PENDING_FUNDING_STORAGE_KEY);
};

const getPendingJoyIdFundingError = (
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

const buildPayInvoiceInfo = (
  targetValue: string,
  invoice: Awaited<ReturnType<typeof fiber.parseInvoice>>["invoice"]
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

export function App() {
  const { open, client, wallet, signerInfo } = cccConnector.useCcc();
  const connectedSigner = cccConnector.useSigner();
  const joyIdOnlyMode = useMemo(() => isJoyIdPageMode(), []);
  const [activeModal, setActiveModal] = useState<ModalKey>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [payStep, setPayStep] = useState<PayStep>("input");
  const [payId, setPayId] = useState("");
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payInvoiceInfo, setPayInvoiceInfo] = useState<PayInvoiceInfo | null>(null);
  const [payLookupError, setPayLookupError] = useState("");
  const [isPayLookupLoading, setIsPayLookupLoading] = useState(false);
  const [isPaySubmitting, setIsPaySubmitting] = useState(false);
  const [receiveStep, setReceiveStep] = useState<ReceiveStep>("idle");
  const [receiveInvoiceAddress, setReceiveInvoiceAddress] = useState("");
  const [receivePaymentHash, setReceivePaymentHash] = useState("");
  const [receiveInvoiceStatus, setReceiveInvoiceStatus] = useState("");
  const [receiveError, setReceiveError] = useState("");
  const [receiveCopyStatus, setReceiveCopyStatus] = useState("");
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [peerIdInput, setPeerIdInput] = useState(DEFAULT_CHANNEL_PEER_ADDRESS);
  const [activity, setActivity] = useState("Ready.");
  const [fiberStatus, setFiberStatus] = useState<FiberStatus>("loading");
  const [selectedChannelSignerInfo, setSelectedChannelSignerInfo] = useState<CkbSignerInfo | null>(null);
  const [selectedChannelSignerAddress, setSelectedChannelSignerAddress] = useState("");
  const [joyIdWalletPanelOpen, setJoyIdWalletPanelOpen] = useState(false);
  const [joyIdWalletPanelInfo, setJoyIdWalletPanelInfo] = useState<JoyIdWalletPanelInfo | null>(null);
  const [isLoadingJoyIdWalletPanel, setIsLoadingJoyIdWalletPanel] = useState(false);
  const [connectedWalletAddress, setConnectedWalletAddress] = useState("");
  const [isPreparingChannelSigner, setIsPreparingChannelSigner] = useState(false);
  const [availableChannelSigners, setAvailableChannelSigners] = useState<CkbSignerInfo[]>([]);
  const [channelSignerSelectorOpen, setChannelSignerSelectorOpen] = useState(false);
  const [pendingChannelPeerId, setPendingChannelPeerId] = useState("");
  const [pendingCreatedChannel, setPendingCreatedChannel] = useState<PendingCreatedChannel | null>(
    null
  );
  const pendingCreatedChannelRef = useRef<PendingCreatedChannel | null>(null);
  const joyIdRedirectHandledRef = useRef(false);

  useEffect(() => {
    pendingCreatedChannelRef.current = pendingCreatedChannel;
  }, [pendingCreatedChannel]);

  const walletManager = useMemo(
    () =>
      new CccWalletManager({
        client,
        appName: "Fiber Wallet"
      }),
    [client]
  );

  const activeChannelSignerLabel = useMemo(() => {
    if (joyIdOnlyMode && selectedChannelSignerInfo) {
      return selectedChannelSignerInfo.label;
    }
    if (wallet && signerInfo) {
      return `${wallet.name} / ${signerInfo.name}`;
    }
    return selectedChannelSignerInfo?.label;
  }, [joyIdOnlyMode, wallet, signerInfo, selectedChannelSignerInfo]);

  const activeChannelSignerAddress = useMemo(
    () =>
      joyIdOnlyMode
        ? selectedChannelSignerAddress
        : connectedSigner
          ? connectedWalletAddress
          : selectedChannelSignerAddress,
    [connectedSigner, connectedWalletAddress, joyIdOnlyMode, selectedChannelSignerAddress]
  );

  const resetPayState = useCallback(() => {
    setPayStep("input");
    setPayId("");
    setPayAmount(null);
    setPayInvoiceInfo(null);
    setPayLookupError("");
    setIsPayLookupLoading(false);
    setIsPaySubmitting(false);
  }, []);

  const resetReceiveState = useCallback(() => {
    setReceiveStep("idle");
    setReceiveInvoiceAddress("");
    setReceivePaymentHash("");
    setReceiveInvoiceStatus("");
    setReceiveError("");
    setReceiveCopyStatus("");
  }, []);

  const resetCreateChannelState = useCallback(() => {
    setCreateChannelOpen(false);
    setChannelSignerSelectorOpen(false);
    setAvailableChannelSigners([]);
    setPendingChannelPeerId("");
    setIsPreparingChannelSigner(false);
  }, []);

  const setActivityFromError = useCallback((prefix: string, error: unknown) => {
    setActivity(`${prefix}: ${getErrorMessage(error)}`);
  }, []);

  const loadChannels = useCallback(async () => {
    const fiberChannels = await fiber.listChannels();
    const nextChannels = convertFiberChannels(fiberChannels);
    setChannels(nextChannels);
    return nextChannels;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConnectedWalletAddress() {
      if (!connectedSigner) {
        setConnectedWalletAddress("");
        return;
      }

      try {
        const address = await connectedSigner.getRecommendedAddress();
        if (!cancelled) {
          setConnectedWalletAddress(address);
        }
      } catch (error) {
        console.warn("[App] Failed to load connected wallet address:", error);
        if (!cancelled) {
          setConnectedWalletAddress("");
        }
      }
    }

    void loadConnectedWalletAddress();

    return () => {
      cancelled = true;
    };
  }, [connectedSigner]);

  useEffect(() => {
    if (!joyIdOnlyMode) {
      return;
    }

    let cancelled = false;

    async function restoreJoyIdSigner() {
      try {
        const signerInfo = await walletManager.getJoyIdCkbSigner();
        if (!signerInfo) {
          return;
        }

        if (!(await signerInfo.signer.isConnected())) {
          return;
        }

        const address = await signerInfo.signer.getRecommendedAddress();
        if (cancelled) {
          return;
        }

        setSelectedChannelSignerInfo(signerInfo);
        setSelectedChannelSignerAddress(address);
      } catch (error) {
        console.warn("[App] Failed to restore JoyID signer:", error);
      }
    }

    void restoreJoyIdSigner();

    return () => {
      cancelled = true;
    };
  }, [joyIdOnlyMode, walletManager]);

  useEffect(() => {
    let cancelled = false;

    async function initFiber() {
      try {
        await fiberReady;
        if (cancelled) {
          return;
        }
        await loadChannels();
        if (!cancelled) {
          setFiberStatus("running");
        }
      } catch (error) {
        if (error instanceof FiberWasmRuntimeError) {
          console.warn("[App] Fiber runtime is unavailable:", error.message);
        } else {
          console.error("[App] Failed to initialize fiber:", error);
        }
        if (!cancelled) {
          setFiberStatus("error");
          setActivity(
            error instanceof FiberWasmRuntimeError
              ? error.message
              : `Failed to initialize fiber: ${getErrorMessage(error)}`
          );
        }
      }
    }

    void initFiber();

    return () => {
      cancelled = true;
    };
  }, [loadChannels]);

  const refreshChannels = useCallback(async () => {
    if (fiberStatus !== "running") {
      return;
    }

    setIsLoadingChannels(true);
    try {
      await loadChannels();
    } catch (error) {
      console.error("[App] Failed to refresh channels:", error);
      setActivity("Failed to refresh channels.");
    } finally {
      setIsLoadingChannels(false);
    }
  }, [fiberStatus, loadChannels]);

  useEffect(() => {
    if (joyIdRedirectHandledRef.current || !isRedirectFromJoyID()) {
      return;
    }

    joyIdRedirectHandledRef.current = true;
    let cancelled = false;

    async function handleJoyIdRedirect() {
      try {
        const response = getRedirectResponse<
          (AuthResponseData | SignMessageResponseData) & { state?: JoyIdRedirectState }
        >();
        cleanupJoyIdRedirectParams();
        const isFundingSignatureResponse =
          "signature" in response &&
          typeof response.signature === "string" &&
          "message" in response &&
          typeof response.message === "string" &&
          "pubkey" in response &&
          typeof response.pubkey === "string";

        if (isFundingSignatureResponse) {
          const signResponse = response as SignMessageResponseData & { state?: JoyIdRedirectState };
          const loadedPending = loadPendingJoyIdFunding();
          const pendingFundingError = getPendingJoyIdFundingError(loadedPending, signResponse.state);
          if (pendingFundingError) {
            clearPendingJoyIdFunding();
            throw new Error(pendingFundingError);
          }
          const pending = loadedPending as PendingJoyIdFunding;

          console.log("[joyid] raw redirect signing payload", {
            pubkeyType: typeof signResponse.pubkey,
            signatureType: typeof signResponse.signature,
            messageType: typeof signResponse.message,
            pubkeyLooksLikeBase64: /^[A-Za-z0-9+/_=-]+$/.test(String(signResponse.pubkey)),
            signatureLooksLikeBase64: /^[A-Za-z0-9+/_=-]+$/.test(String(signResponse.signature)),
            messageLooksLikeBase64: /^[A-Za-z0-9+/_=-]+$/.test(String(signResponse.message)),
            pubkeyPreview: String(signResponse.pubkey).slice(0, 80),
            signaturePreview: String(signResponse.signature).slice(0, 80),
            messagePreview: String(signResponse.message).slice(0, 120)
          });

          setActivity("Restoring JoyID funding signature...");
          await fiberReady;
          setActivity(`Reconnecting peer ${pending.peerId}...`);
          const relayInfo = fiber.parseRelayInfo(pending.peerId);
          await fiber.connectPeer(relayInfo);

          const normalizedSignResponse = normalizeJoyIdSignResponse(signResponse);
          console.log("[joyid] normalized redirect signing payload", {
            pubkeyHexLength: normalizedSignResponse.pubkey.length,
            signatureHexLength: normalizedSignResponse.signature.length,
            messageHexLength: normalizedSignResponse.message.length
          });
          const signedJoyIdTx = buildSignedTx(
            pending.joyIdTx,
            normalizedSignResponse,
            pending.witnessIndexes
          );
          const signedFundingTx = withFundingTxWitnesses(
            pending.unsignedFundingTx,
            signedJoyIdTx.witnesses
          );
          console.log(`joyid unsigned funding tx before submit: ${ccc.stringify(pending.unsignedFundingTx)}`);
          console.log(`joyid signed funding tx before submit: ${ccc.stringify(signedFundingTx)}`);

          setActivity("Submitting signed funding transaction...");
          await fiber.submitSignedFundingTxWithRetry(pending.channelId, signedFundingTx);
          clearPendingJoyIdFunding();

          if (cancelled) {
            return;
          }

          setPendingCreatedChannel({
            id: pending.channelId,
            peerId: pending.peerId,
            hasAppeared: false
          });
          await refreshChannels();
          setActivity(
            `Channel creation submitted for ${pending.peerId}. Funding: ${pending.fundingAmount} CKB.`
          );
          return;
        }

        const authResponse = response as AuthResponseData & { state?: JoyIdRedirectState };
        if (authResponse.state?.kind === "connect" || authResponse.address) {
          const joyIdSignerInfo = await walletManager.persistJoyIdCkbConnection(authResponse);
          const address = await joyIdSignerInfo.signer.getRecommendedAddress();
          if (cancelled) {
            return;
          }

          setSelectedChannelSignerInfo(joyIdSignerInfo);
          setSelectedChannelSignerAddress(address);
          setActivity(`JoyID wallet connected: ${truncateAddress(address)}.`);
        }
      } catch (error) {
        cleanupJoyIdRedirectParams();
        console.error("[App] Failed to handle JoyID redirect:", error);
        if (!cancelled) {
          setActivityFromError("JoyID redirect failed", error);
        }
      }
    }

    void handleJoyIdRedirect();

    return () => {
      cancelled = true;
    };
  }, [refreshChannels, setActivityFromError, walletManager]);

  useEffect(() => {
    if (activeModal === "channels" && fiberStatus === "running") {
      void refreshChannels();
    }
  }, [activeModal, fiberStatus, refreshChannels]);

  useEffect(() => {
    if (fiberStatus !== "running" || !pendingCreatedChannel) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let inFlight = false;
    let lastReconnectAt = 0;

    const stopTracking = () => {
      setPendingCreatedChannel((current) =>
        current?.id === pendingCreatedChannel.id ? null : current
      );
      cancelled = true;
    };

    const pollCreatedChannel = async () => {
      if (cancelled || inFlight) {
        return;
      }

      inFlight = true;
      try {
        console.log("refreshChannels");
        const nextChannels = await loadChannels();
        if (cancelled) {
          return;
        }

        const currentPending = pendingCreatedChannelRef.current;
        if (!currentPending || currentPending.id !== pendingCreatedChannel.id) {
          return;
        }

        const matched = nextChannels.find((channel) => channel.id === currentPending.id);
        if (!matched) {
          if (currentPending.hasAppeared) {
            setActivity(`Channel ${currentPending.id.slice(0, 12)}... disappeared. Stop tracking.`);
            stopTracking();
          }
          return;
        }

        if (!currentPending.hasAppeared) {
          setPendingCreatedChannel((current) =>
            current?.id === matched.id ? { ...current, hasAppeared: true } : current
          );
        }

        if (
          isCreatedChannelCollaborating(matched.rawStateName) &&
          Date.now() - lastReconnectAt >= CHANNEL_CREATION_RECONNECT_INTERVAL_MS
        ) {
          lastReconnectAt = Date.now();
          try {
            const relayInfo = fiber.parseRelayInfo(currentPending.peerId);
            await fiber.connectPeer(relayInfo);
            if (!cancelled) {
              setActivity(
                `Channel ${matched.id.slice(0, 12)}... is ${matched.statusLabel}. Reconnected peer and waiting...`
              );
            }
          } catch (error) {
            if (!cancelled) {
              console.warn("[App] Failed to reconnect peer while tracking channel:", error);
            }
          }
        }

        if (isCreatedChannelReady(matched.rawStateName)) {
          setActivity(`Channel ${matched.id.slice(0, 12)}... is Ready.`);
          stopTracking();
          return;
        }

        if (isCreatedChannelFailed(matched.rawStateName)) {
          setActivity(`Channel ${matched.id.slice(0, 12)}... failed: ${matched.statusLabel}.`);
          stopTracking();
          return;
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[App] Failed to poll created channel:", error);
          setActivity(`Failed to refresh channel creation status: ${getErrorMessage(error)}`);
        }
      } finally {
        inFlight = false;
        if (!cancelled) {
          timer = window.setTimeout(pollCreatedChannel, CHANNEL_CREATION_POLL_INTERVAL_MS);
        }
      }
    };

    void pollCreatedChannel();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [fiberStatus, loadChannels, pendingCreatedChannel]);

  useEffect(() => {
    if (activeModal !== "receive" || receiveStep !== "waiting" || !receivePaymentHash) {
      return;
    }

    let cancelled = false;

    const pollInvoiceStatus = async () => {
      try {
        const result = await fiber.getInvoice({ payment_hash: receivePaymentHash as `0x${string}` });
        if (cancelled) {
          return;
        }

        setReceiveInvoiceStatus(result.status);
        if (result.status === "Received" || result.status === "Paid") {
          setReceiveStep("paid");
          if (result.status === "Paid") {
            await refreshChannels();
          }
          setActivity(`Receive invoice updated: ${result.status}.`);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = getErrorMessage(error);
        setReceiveError(message);
        setActivity(`Failed to refresh invoice status: ${message}`);
      }
    };

    void pollInvoiceStatus();
    const timer = window.setInterval(() => {
      void pollInvoiceStatus();
    }, RECEIVE_INVOICE_STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeModal, receivePaymentHash, receiveStep, refreshChannels, setActivity]);

  const channelCount = channels.length;
  const paymentEnabled = channelCount >= 1;
  const canCreateChannel = fiberStatus === "running";
  const createChannelDisabledReason = canCreateChannel ? undefined : "Fiber node is not ready yet";
  const totalChannelBalance = useMemo(
    () => channels.reduce((sum, channel) => (channel.isReady ? sum + channel.balance : sum), 0),
    [channels]
  );

  const openModal = useCallback(
    (modal: Exclude<ModalKey, null>) => {
      setActiveModal(modal);
      if (modal === "pay") {
        resetPayState();
      }
      if (modal === "receive") {
        resetReceiveState();
      }
    },
    [resetPayState, resetReceiveState]
  );

  const handleOpenReceive = useCallback(async () => {
    openModal("receive");

    if (fiberStatus !== "running") {
      setReceiveStep("idle");
      setReceiveError("Fiber node is still initializing.");
      return;
    }

    try {
      setReceiveStep("creating");
      setReceiveError("");
      setReceiveInvoiceStatus("");
      setReceiveCopyStatus("");
      setActivity("Creating invoice...");

      const result = await fiber.newInvoice({
        amount: toRpcHexAmount(DEFAULT_RECEIVE_AMOUNT_SHANNONS),
        currency: "Fibt",
        description: "invoice generated by fiber-wallet",
        expiry: "0xe10",
        final_expiry_delta: MIN_RECEIVE_FINAL_EXPIRY_DELTA,
        payment_preimage: createRandomHex32(),
        hash_algorithm: "sha256"
      });

      setReceiveInvoiceAddress(result.invoice_address);
      setReceivePaymentHash(result.invoice.data.payment_hash);
      setReceiveInvoiceStatus("Open");
      setReceiveStep("waiting");
      setActivity("Invoice created. Waiting for payment.");
    } catch (error) {
      const message = getErrorMessage(error);
      console.error("[App] Failed to create invoice:", error);
      setReceiveStep("idle");
      setReceiveError(message);
      setActivity(`Failed to create invoice: ${message}`);
    }
  }, [fiberStatus, openModal, setActivity]);

  const handleCopyReceiveInvoice = useCallback(async () => {
    if (!receiveInvoiceAddress) {
      return;
    }

    try {
      await navigator.clipboard.writeText(receiveInvoiceAddress);
      setReceiveCopyStatus("Copied");
    } catch (error) {
      const message = getErrorMessage(error);
      setReceiveCopyStatus("Copy failed");
      setActivity(`Failed to copy invoice address: ${message}`);
    }
  }, [receiveInvoiceAddress, setActivity]);

  const closeModal = useCallback(() => {
    setActiveModal(null);
    resetCreateChannelState();
  }, [resetCreateChannelState]);

  const connectSelectedChannelSigner = useCallback(
    async (info: CkbSignerInfo): Promise<ResolvedChannelSigner> => {
      setIsPreparingChannelSigner(true);
      setActivity(`Connecting wallet signer ${info.label}...`);
      const connected = await walletManager.connectSigner(info.signer);
      const support = await walletManager.getFundingSignerSupport(connected.signer);
      if (!support.supported) {
        throw new Error(support.reason ?? `${info.label} cannot be used for channel funding`);
      }
      setSelectedChannelSignerInfo(info);
      setSelectedChannelSignerAddress(connected.address);
      return {
        signer: connected.signer,
        address: connected.address,
        label: info.label
      };
    },
    [walletManager]
  );

  const handleJoyIdConnect = useCallback(async () => {
    const joyIdSignerInfo = await walletManager.getJoyIdCkbSigner();
    if (!joyIdSignerInfo) {
      throw new Error("JoyID CKB signer is unavailable");
    }

    if (await joyIdSignerInfo.signer.isConnected()) {
      const address = await joyIdSignerInfo.signer.getRecommendedAddress();
      setSelectedChannelSignerInfo(joyIdSignerInfo);
      setSelectedChannelSignerAddress(address);
      setActivity(`JoyID wallet ready: ${truncateAddress(address)}.`);
      return;
    }

    setActivity("Redirecting to JoyID for wallet authorization...");
    walletManager.redirectToJoyIdAuth(getCleanCurrentUrl(), {
      kind: "connect",
      timestamp: Date.now()
    } satisfies JoyIdRedirectState);
  }, [walletManager]);

  const handleOpenJoyIdWalletPanel = useCallback(async () => {
    if (!selectedChannelSignerInfo) {
      await handleJoyIdConnect();
      return;
    }

    setJoyIdWalletPanelOpen(true);
    setIsLoadingJoyIdWalletPanel(true);
    try {
      const [address, internalAddress, balance] = await Promise.all([
        selectedChannelSignerInfo.signer.getRecommendedAddress(),
        selectedChannelSignerInfo.signer.getInternalAddress(),
        selectedChannelSignerInfo.signer.getBalance()
      ]);

      setJoyIdWalletPanelInfo({
        address,
        internalAddress,
        balance: ccc.fixedPointToString(balance)
      });
    } catch (error) {
      console.error("[App] Failed to load JoyID wallet panel info:", error);
      setJoyIdWalletPanelInfo(null);
      setActivityFromError("Failed to load JoyID wallet info", error);
    } finally {
      setIsLoadingJoyIdWalletPanel(false);
    }
  }, [handleJoyIdConnect, selectedChannelSignerInfo, setActivityFromError]);

  const handleDisconnectJoyId = useCallback(async () => {
    if (!selectedChannelSignerInfo) {
      setJoyIdWalletPanelOpen(false);
      return;
    }

    try {
      await selectedChannelSignerInfo.signer.disconnect();
    } catch (error) {
      console.warn("[App] Failed to disconnect JoyID signer:", error);
    } finally {
      setSelectedChannelSignerInfo(null);
      setSelectedChannelSignerAddress("");
      setJoyIdWalletPanelInfo(null);
      setJoyIdWalletPanelOpen(false);
      setActivity("JoyID wallet disconnected.");
    }
  }, [selectedChannelSignerInfo]);

  const ensureChannelSigner = useCallback(
    async (peerId: string): Promise<ResolvedChannelSigner | null> => {
      if (joyIdOnlyMode) {
        const joyIdSignerInfo = await walletManager.getJoyIdCkbSigner();
        if (!joyIdSignerInfo) {
          throw new Error("JoyID CKB signer is unavailable");
        }

        if (!(await joyIdSignerInfo.signer.isConnected())) {
          setActivity(`Redirecting to JoyID before opening channel ${peerId}...`);
          walletManager.redirectToJoyIdAuth(getCleanCurrentUrl(), {
            kind: "connect",
            timestamp: Date.now()
          } satisfies JoyIdRedirectState);
          return null;
        }

        return connectSelectedChannelSigner(joyIdSignerInfo);
      }

      if (connectedSigner) {
        const support = await walletManager.getFundingSignerSupport(connectedSigner);
        if (support.supported) {
          setActivity(`Wallet already connected. Preparing signature flow for ${peerId}...`);
          return {
            signer: connectedSigner,
            address: await connectedSigner.getRecommendedAddress(),
            label:
              wallet && signerInfo ? `${wallet.name} / ${signerInfo.name}` : "Connected Wallet"
          };
        }

        console.warn("[App] Connected signer is not usable for funding tx:", support.reason);
        setActivity(
          support.reason
            ? `${support.reason}. Select another signer for channel funding.`
            : "Connected signer cannot be used for channel funding. Select another signer."
        );
      }

      if (selectedChannelSignerInfo) {
        const support = await walletManager.getFundingSignerSupport(selectedChannelSignerInfo.signer);
        if (support.supported) {
          setActivity(`Reusing selected wallet ${selectedChannelSignerInfo.label}...`);
          return connectSelectedChannelSigner(selectedChannelSignerInfo);
        }

        console.warn("[App] Selected signer is not usable for funding tx:", support.reason);
        setSelectedChannelSignerInfo(null);
        setSelectedChannelSignerAddress("");
      }

      setIsPreparingChannelSigner(true);
      setActivity("Scanning available CKB wallets...");
      const signerInfos = await walletManager.refreshCkbSigners();
      if (signerInfos.length === 0) {
        throw new Error("No compatible wallet signer found");
      }

      if (signerInfos.length === 1) {
        return connectSelectedChannelSigner(signerInfos[0]);
      }

      setAvailableChannelSigners(signerInfos);
      setPendingChannelPeerId(peerId);
      setChannelSignerSelectorOpen(true);
      setActivity("Select a wallet and signer for channel funding.");
      setIsPreparingChannelSigner(false);
      return null;
    },
    [
      connectSelectedChannelSigner,
      connectedSigner,
      joyIdOnlyMode,
      selectedChannelSignerInfo,
      signerInfo,
      wallet,
      walletManager
    ]
  );

  const handlePayLookup = useCallback(async () => {
    const rawInput = payId.trim();
    if (!rawInput) {
      return;
    }

    const target = extractPayLookupTarget(rawInput);
    if (!target) {
      setPayLookupError("Please enter a valid invoice (fibt/fibb/fibd...) or 0x-prefixed payment hash.");
      return;
    }

    if (fiberStatus !== "running") {
      setPayLookupError("Fiber node is still initializing.");
      return;
    }

    try {
      setIsPayLookupLoading(true);
      setPayLookupError("");
      setPayInvoiceInfo(null);
      setActivity("Loading invoice details...");

      const invoiceInfo = (await fiber.parseInvoice(target.value)).invoice;
      const nextPayInvoiceInfo = buildPayInvoiceInfo(target.value, invoiceInfo);

      setPayInvoiceInfo(nextPayInvoiceInfo);
      setPayAmount(nextPayInvoiceInfo.amountCkb);
      setPayStep("review");
    } catch (error) {
      console.error("[App] Failed to load invoice:", error);
      const rawMessage = getErrorMessage(error);
      const message = toFriendlyPayLookupError(rawMessage);
      if (target.kind === "invoice" && isInvoiceFormatError(rawMessage)) {
        setPayLookupError(`${message} You can still try Confirm Payment directly.`);
        setPayAmount(null);
        setPayInvoiceInfo({
          invoiceAddress: "--",
          paymentHash: "--",
          currency: "--",
          amountCkb: null,
          expiry: "--",
          description: "--"
        });
        setPayStep("review");
        setActivity("Invoice parsing failed. You can still try sending payment directly.");
      } else {
        setPayLookupError(message);
        setActivity(`Failed to load invoice: ${message}`);
      }
    } finally {
      setIsPayLookupLoading(false);
    }
  }, [fiberStatus, payId]);

  const handlePayConfirm = useCallback(async () => {
    const target = extractPayLookupTarget(payId.trim());
    if (!target) {
      setPayLookupError("Please enter a valid invoice first.");
      return;
    }
    if (target.kind !== "invoice") {
      setPayLookupError("Direct pay by payment hash is not supported yet. Please use invoice.");
      return;
    }
    if (fiberStatus !== "running") {
      setPayLookupError("Fiber node is still initializing.");
      return;
    }

    try {
      setIsPaySubmitting(true);
      setPayLookupError("");
      setActivity("Submitting payment...");
      const result = await fiber.sendPayment({
        invoice: payInvoiceInfo?.invoiceAddress ?? target.value
      });
      let paymentStatus = result.status;
      await refreshChannels();

      for (let attempt = 0; attempt < PAYMENT_STATUS_POLL_ATTEMPTS; attempt += 1) {
        if (paymentStatus === "Success" || paymentStatus === "Failed") {
          break;
        }

        const payment = await fiber.getPayment({ payment_hash: result.payment_hash });
        paymentStatus = payment.status;
        await refreshChannels();
      }

      setActivity(`Payment submitted: ${paymentStatus} (${result.payment_hash.slice(0, 12)}...).`);
      closeModal();
    } catch (error) {
      console.error("[App] Failed to send payment:", error);
      const message = toFriendlyPayLookupError(getErrorMessage(error));
      setPayLookupError(message);
      setActivity(`Failed to send payment: ${message}`);
    } finally {
      setIsPaySubmitting(false);
    }
  }, [closeModal, fiberStatus, payId, payInvoiceInfo, refreshChannels]);

  const handleCreateChannel = useCallback(
    async (peerAddress = peerIdInput.trim()) => {
      const trimmed = peerAddress.trim();
      if (!trimmed) {
        return;
      }

      if (fiberStatus !== "running") {
        setActivity("Fiber node is still initializing.");
        return;
      }

      try {
        setPendingChannelPeerId(trimmed);
        setActivity(`Preparing channel creation with ${trimmed}...`);
        const resolved = await ensureChannelSigner(trimmed);
        if (!resolved) {
          return;
        }

        setActivity(`Connecting peer ${trimmed}...`);
        const relayInfo = fiber.parseRelayInfo(trimmed);
        const peerPubkey = await fiber.connectPeer(relayInfo);

        const fundingAddressObj = await resolved.signer.getRecommendedAddressObj();
        const fundingScriptCapacity = await resolved.signer.client.getCellsCapacity({
          script: fundingAddressObj.script,
          scriptType: "lock",
          scriptSearchMode: "exact"
        });

        const maxFundingAmount =
          fundingScriptCapacity > OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
            ? fundingScriptCapacity - OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
            : 0n;
        if (maxFundingAmount <= 0n) {
          throw new Error(
            `Insufficient capacity. Keep at least ${ccc.fixedPointToString(
              OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS
            )} CKB for channel cell and tx fee`
          );
        }

        const fundingAmount =
          maxFundingAmount < DEFAULT_FUNDING_AMOUNT_SHANNONS
            ? maxFundingAmount
            : DEFAULT_FUNDING_AMOUNT_SHANNONS;

        const fundingLockScriptCellDeps = await walletManager.getFundingLockScriptCellDeps(
          resolved.signer
        );

        const openChannelParams: OpenChannelWithExternalFundingCompatParams & {
          funding_lock_script_cell_deps?: Awaited<
            ReturnType<typeof walletManager.getFundingLockScriptCellDeps>
          >;
        } = {
          pubkey: peerPubkey,
          funding_amount: toRpcHexAmount(fundingAmount),
          public: true,
          shutdown_script: toFiberScript(fundingAddressObj.script),
          funding_lock_script: toFiberScript(fundingAddressObj.script),
          funding_fee_rate: toRpcHexAmount(OPEN_CHANNEL_FUNDING_FEE_RATE)
        };

        if (fundingLockScriptCellDeps?.length) {
          openChannelParams.funding_lock_script_cell_deps = fundingLockScriptCellDeps;
        }

        setActivity(
          `Opening external funding channel with ${resolved.label} (${truncateAddress(resolved.address)})...`
        );
        console.log(`openchannel param: ${stringify(openChannelParams)}`);
        const result = await fiber.openChannelWithExternalFunding(openChannelParams);

        if (joyIdOnlyMode && resolved.signer.signType === ccc.SignerSignType.JoyId) {
          const joyIdRedirect = await walletManager.prepareJoyIdSignTx(
            result.unsigned_funding_tx,
            resolved.signer
          );
          logFundingTxDebug("joyid unsigned funding tx before redirect", result.channel_id, result.unsigned_funding_tx, {
            peerId: trimmed,
            fundingAmount: ccc.fixedPointToString(fundingAmount),
            joyIdWitnessIndexes: joyIdRedirect.witnessIndexes,
            joyIdAddress: joyIdRedirect.address,
            joyIdChallenge: joyIdRedirect.challenge
          });
          savePendingJoyIdFunding({
            channelId: result.channel_id,
            peerId: trimmed,
            unsignedFundingTx: result.unsigned_funding_tx,
            joyIdTx: joyIdRedirect.tx,
            witnessIndexes: joyIdRedirect.witnessIndexes,
            fundingAmount: ccc.fixedPointToString(fundingAmount),
            createdAt: Date.now()
          });
          setActivity("Redirecting to JoyID to sign funding transaction...");
          walletManager.redirectToJoyIdSignTx({
            challenge: joyIdRedirect.challenge,
            address: joyIdRedirect.address,
            redirectURL: getCleanCurrentUrl(),
            state: {
              kind: "sign-funding",
              channelId: result.channel_id,
              peerId: trimmed,
              timestamp: Date.now()
            } satisfies JoyIdRedirectState
          });
          return;
        }

        setActivity(`Signing funding transaction with ${resolved.label}...`);
        const signedFundingTx = await walletManager.signFundingTx(
          result.unsigned_funding_tx,
          resolved.signer
        );
        logFundingTxDebug("standard unsigned funding tx before submit", result.channel_id, result.unsigned_funding_tx, {
          signerLabel: resolved.label,
          signerAddress: resolved.address,
          signerType: resolved.signer.type,
          signType: resolved.signer.signType
        });
        logFundingTxDebug("standard signed funding tx before submit", result.channel_id, signedFundingTx, {
          signerLabel: resolved.label,
          signerAddress: resolved.address,
          signerType: resolved.signer.type,
          signType: resolved.signer.signType
        });
        console.log(`standard signed funding tx before submit: ${ccc.stringify(signedFundingTx)}`);

        setActivity("Submitting signed funding transaction...");
        await fiber.submitSignedFundingTx(result.channel_id, signedFundingTx);

        setPendingCreatedChannel({
          id: result.channel_id,
          peerId: trimmed,
          hasAppeared: false
        });
        resetCreateChannelState();
        await refreshChannels();
        setActivity(
          `Channel creation submitted for ${trimmed}. Funding: ${ccc.fixedPointToString(fundingAmount)} CKB.`
        );
      } catch (error) {
        console.error("[App] Failed to create channel:", error);
        setActivityFromError("Failed to create channel", error);
      } finally {
        setIsPreparingChannelSigner(false);
      }
    },
    [
      ensureChannelSigner,
      fiberStatus,
      joyIdOnlyMode,
      peerIdInput,
      refreshChannels,
      resetCreateChannelState,
      setActivityFromError,
      walletManager
    ]
  );

  const handleChannelSignerSelected = useCallback(
    async (info: CkbSignerInfo) => {
      try {
        const resolved = await connectSelectedChannelSigner(info);
        setAvailableChannelSigners([]);
        setChannelSignerSelectorOpen(false);
        if (!pendingChannelPeerId) {
          setActivity(`Wallet ready: ${resolved.label} (${truncateAddress(resolved.address)}).`);
          return;
        }

        await handleCreateChannel(pendingChannelPeerId);
      } catch (error) {
        console.error("[App] Failed to connect signer:", error);
        setActivityFromError("Failed to connect signer", error);
      } finally {
        setIsPreparingChannelSigner(false);
      }
    },
    [connectSelectedChannelSigner, handleCreateChannel, pendingChannelPeerId, setActivityFromError]
  );

  const handleCloseChannel = useCallback(
    async (id: string) => {
      setActivity(`Closing channel ${id}...`);
      try {
        await fiber.shutdownChannel(id);
        setActivity(`Closed channel ${id}.`);
        await refreshChannels();
      } catch (error) {
        console.error("[App] Failed to close channel:", error);
        setActivityFromError("Failed to close channel", error);
      }
    },
    [refreshChannels, setActivityFromError]
  );

  return (
    <main className="page">
      <section className="panel header-panel">
        <div>
          <h1>Fiber Wallet</h1>
          <p className="subtle">Simple wallet demo UI</p>
        </div>
        <div className="status-line">
          {fiberStatus === "loading" && (
            <span className="status-pill loading">
              <span className="spinner-small" aria-hidden="true" />
              Fiber: Starting
            </span>
          )}
          {fiberStatus === "running" && <span className="status-pill good">Fiber: Running</span>}
          {fiberStatus === "error" && <span className="status-pill error">Fiber: Error</span>}
          <span className="status-text">Channels: {channelCount}</span>
        </div>
      </section>

      <section className="panel status-panel">
        <div className="status-row">
          <span>Wallet</span>
          <strong>{activeChannelSignerLabel ?? "Not Connected"}</strong>
        </div>
        <div className="status-row">
          <span>Address</span>
          <strong>{activeChannelSignerAddress ? truncateAddress(activeChannelSignerAddress) : "--"}</strong>
        </div>
        <div className="status-row">
          <span>Channel Balance</span>
          <strong>{formatCkb(totalChannelBalance)}</strong>
        </div>
        <div className="status-row">
          <span>Payment</span>
          <strong>{paymentEnabled ? "Enabled" : "Disabled"}</strong>
        </div>
      </section>

      <section className="button-grid">
        <ActionCard title="Pay" disabled={!paymentEnabled} onClick={() => openModal("pay")} centered />
        <ActionCard title="Receive" disabled={!paymentEnabled} onClick={() => void handleOpenReceive()} centered />
        <WalletButton
          onClick={joyIdOnlyMode ? () => void handleOpenJoyIdWalletPanel() : open}
          onConnect={joyIdOnlyMode ? () => void handleJoyIdConnect() : undefined}
          walletOverride={
            joyIdOnlyMode && selectedChannelSignerInfo
              ? {
                name: selectedChannelSignerInfo.walletName,
                icon: selectedChannelSignerInfo.walletIcon
              }
              : null
          }
          signerOverride={joyIdOnlyMode ? selectedChannelSignerInfo?.signer ?? null : null}
        />
        <ActionCard title="Channels" meta={`${channelCount} Open`} onClick={() => openModal("channels")} />
      </section>

      <section className="panel log-panel">
        <span className="subtle">Status</span>
        <p>{activity}</p>
      </section>

      {activeModal === "pay" && (
        <PayModal
          payStep={payStep}
          payId={payId}
          payAmount={payAmount}
          payInvoiceInfo={payInvoiceInfo}
          payLookupError={payLookupError}
          isPayLookupLoading={isPayLookupLoading}
          isPaySubmitting={isPaySubmitting}
          formatCkb={formatCkb}
          onPayIdChange={setPayId}
          onLookup={() => void handlePayLookup()}
          onClose={closeModal}
          onReset={resetPayState}
          onConfirm={() => void handlePayConfirm()}
        />
      )}

      {activeModal === "receive" && (
        <ReceiveModal
          receiveStep={receiveStep}
          receiveInvoiceAddress={receiveInvoiceAddress}
          receiveInvoiceStatus={receiveInvoiceStatus}
          receiveError={receiveError}
          receiveCopyStatus={receiveCopyStatus}
          onCopy={() => void handleCopyReceiveInvoice()}
          onClose={closeModal}
        />
      )}

      {activeModal === "channels" && (
        <ChannelsModal
          channels={channels}
          channelCount={channelCount}
          canCreateChannel={canCreateChannel}
          createChannelDisabledReason={createChannelDisabledReason}
          isLoadingChannels={isLoadingChannels}
          createChannelOpen={createChannelOpen}
          peerIdInput={peerIdInput}
          isPreparingChannelSigner={isPreparingChannelSigner}
          channelSignerSelectorOpen={channelSignerSelectorOpen}
          availableChannelSigners={availableChannelSigners}
          formatCkb={formatCkb}
          placeholderPeerAddress={DEFAULT_CHANNEL_PEER_ADDRESS}
          onClose={closeModal}
          onOpenCreateChannel={() => setCreateChannelOpen(true)}
          onCloseCreateChannel={() => setCreateChannelOpen(false)}
          onRefreshChannels={() => void refreshChannels()}
          onPeerIdInputChange={setPeerIdInput}
          onCreateChannel={() => void handleCreateChannel()}
          onResetCreateChannelState={resetCreateChannelState}
          onSelectChannelSigner={(info) => void handleChannelSignerSelected(info)}
          onCloseChannel={(id) => void handleCloseChannel(id)}
        />
      )}

      {joyIdOnlyMode && joyIdWalletPanelOpen && (
        <JoyIdWalletModal
          isLoading={isLoadingJoyIdWalletPanel}
          walletInfo={joyIdWalletPanelInfo}
          onClose={() => setJoyIdWalletPanelOpen(false)}
          onManage={() => window.open("https://mobit.app/", "_blank", "noopener,noreferrer")}
          onDisconnect={() => void handleDisconnectJoyId()}
        />
      )}
    </main>
  );
}
