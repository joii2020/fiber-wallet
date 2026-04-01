import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ccc as cccConnector, stringify } from "@ckb-ccc/connector-react";
import { ccc } from "@ckb-ccc/ccc";
import type { Channel as FiberChannel } from "@nervosnetwork/fiber-js";
import {
  CccWalletManager,
  toFiberScript,
  type CkbSignerInfo,
  type OpenChannelWithExternalFundingCompatParams
} from "./shared";
import { WalletButton } from "./components/WalletButton";
import { FiberWasmRuntimeError, fiber, fiberReady } from "./services/fiber-wasm";
import { truncateAddress } from "./utils/stringUtils";
import { DEFAULT_CHANNEL_PEER_ADDRESS } from "./config";

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

const SHANNONS_PER_CKB = 100000000n;
const DEFAULT_FUNDING_AMOUNT_SHANNONS = 1000n * SHANNONS_PER_CKB;
const OPEN_CHANNEL_CAPACITY_RESERVE_SHANNONS = 120n * SHANNONS_PER_CKB;
const OPEN_CHANNEL_FUNDING_FEE_RATE = 3000n;
const CHANNEL_CREATION_POLL_INTERVAL_MS = 500;
const PAYMENT_STATUS_POLL_INTERVAL_MS = 800;
const PAYMENT_STATUS_POLL_ATTEMPTS = 10;
const RECEIVE_INVOICE_STATUS_POLL_INTERVAL_MS = 500;
const DEFAULT_RECEIVE_AMOUNT_SHANNONS = 1n * SHANNONS_PER_CKB;
const MIN_RECEIVE_FINAL_EXPIRY_DELTA = "0x927c00";
const PAYMENT_HASH_HEX_REGEX = /^0x[0-9a-fA-F]{64}$/;
const PAYMENT_HASH_HEX_SEARCH_REGEX = /0x[0-9a-fA-F]{64}/;
const INVOICE_SEARCH_REGEX = /(fib[bdt][a-z0-9]*1[023456789acdefghjklmnpqrstuvwxyz]+)/i;
const INVISIBLE_SPACES_REGEX = /[\s\u200B-\u200D\uFEFF]/g;

const toRpcHexAmount = (amount: bigint): `0x${string}` => `0x${amount.toString(16)}`;
const formatCkb = (value: number): string => `${value.toFixed(2)} CKB`;

const mapChannelState = (stateName?: string): { status: ChannelStatus; label: string } => {
  switch (stateName?.toLowerCase()) {
    case "established":
    case "running":
      return { status: "good", label: "Running" };
    case "syncing":
    case "awaiting_tx_signatures":
      return { status: "warn", label: "Syncing" };
    case "awaiting_peer":
    case "connecting":
      return { status: "idle", label: "Awaiting Peer" };
    case "closed":
    case "shutting_down":
      return { status: "error", label: "Closed" };
    default:
      return { status: "idle", label: stateName || "Unknown" };
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
    const stateInfo = mapChannelState(rawStateName);
    const localBalance = BigInt(channel.local_balance || "0x0");
    return {
      id: channel.channel_id,
      status: stateInfo.status,
      statusLabel: stateInfo.label,
      balance: Number(localBalance) / 100_000_000,
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
  const [connectedWalletAddress, setConnectedWalletAddress] = useState("");
  const [isPreparingChannelSigner, setIsPreparingChannelSigner] = useState(false);
  const [availableChannelSigners, setAvailableChannelSigners] = useState<CkbSignerInfo[]>([]);
  const [channelSignerSelectorOpen, setChannelSignerSelectorOpen] = useState(false);
  const [pendingChannelPeerId, setPendingChannelPeerId] = useState("");
  const [pendingCreatedChannel, setPendingCreatedChannel] = useState<PendingCreatedChannel | null>(
    null
  );
  const pendingCreatedChannelRef = useRef<PendingCreatedChannel | null>(null);

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
    if (wallet && signerInfo) {
      return `${wallet.name} / ${signerInfo.name}`;
    }
    return selectedChannelSignerInfo?.label;
  }, [wallet, signerInfo, selectedChannelSignerInfo]);

  const activeChannelSignerAddress = useMemo(
    () => (connectedSigner ? connectedWalletAddress : selectedChannelSignerAddress),
    [connectedSigner, connectedWalletAddress, selectedChannelSignerAddress]
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
              ? "Fiber requires SharedArrayBuffer. Open the isolated entry page and reload."
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
    () => channels.reduce((sum, channel) => sum + channel.balance, 0),
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

  const ensureChannelSigner = useCallback(
    async (peerId: string): Promise<ResolvedChannelSigner | null> => {
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
    [connectSelectedChannelSigner, connectedSigner, selectedChannelSignerInfo, signerInfo, wallet, walletManager]
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

        setActivity(`Signing funding transaction with ${resolved.label}...`);
        const signedFundingTx = await walletManager.signFundingTx(
          result.unsigned_funding_tx,
          resolved.signer
        );

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
    [ensureChannelSigner, fiberStatus, peerIdInput, refreshChannels, resetCreateChannelState, setActivityFromError, walletManager]
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
        <WalletButton onClick={open} />
        <ActionCard title="Channels" meta={`${channelCount} Open`} onClick={() => openModal("channels")} />
      </section>

      <section className="panel log-panel">
        <span className="subtle">Status</span>
        <p>{activity}</p>
      </section>

      {activeModal === "pay" && (
        <Modal title="Pay" onClose={closeModal}>
          {payStep === "input" ? (
            <>
              <label className="field">
                <span>Invoice / Payment Hash</span>
                <input
                  value={payId}
                  onChange={(event) => setPayId(event.target.value)}
                  placeholder="Enter invoice or 0x... payment hash"
                />
              </label>
              <div className="modal-actions">
                <button className="secondary" onClick={closeModal} type="button">
                  Cancel
                </button>
                <button
                  onClick={() => void handlePayLookup()}
                  type="button"
                  disabled={!payId.trim() || isPayLookupLoading}
                >
                  {isPayLookupLoading ? "Loading..." : "Confirm"}
                </button>
              </div>
              {payLookupError && <p className="error-text">{payLookupError}</p>}
            </>
          ) : (
            <>
              <div className="box">
                <span className="subtle">Amount</span>
                <strong>{payAmount === null ? "--" : formatCkb(payAmount)}</strong>
                <p className="subtle">Currency: {payInvoiceInfo?.currency ?? "--"}</p>
                <p className="subtle">Invoice Address: {payInvoiceInfo?.invoiceAddress ?? "--"}</p>
                <p className="subtle">Payment Hash: {payInvoiceInfo?.paymentHash ?? "--"}</p>
                <p className="subtle">Expiry: {payInvoiceInfo?.expiry ?? "--"}</p>
                <p className="subtle">Description: {payInvoiceInfo?.description ?? "--"}</p>
                <p>Confirm to send this payment.</p>
              </div>
              <div className="modal-actions">
                <button className="secondary" onClick={resetPayState} type="button">
                  Cancel
                </button>
                <button onClick={() => void handlePayConfirm()} type="button" disabled={isPaySubmitting}>
                  {isPaySubmitting ? "Paying..." : "Confirm Payment"}
                </button>
              </div>
              {payLookupError && <p className="error-text">{payLookupError}</p>}
            </>
          )}
        </Modal>
      )}

      {activeModal === "receive" && (
        <Modal title="Receive" onClose={closeModal}>
          <>
            {(receiveStep === "creating" || receiveStep === "waiting") && (
              <div className="wait-box">
                <div className="spinner" aria-hidden="true" />
                <span>{receiveStep === "creating" ? "Creating invoice" : "Waiting for payment"}</span>
              </div>
            )}
            {receiveInvoiceAddress && (
              <div className="box">
                <span className="subtle">Invoice Address</span>
                <div className="copy-row">
                  <strong className="truncate-line" title={receiveInvoiceAddress}>
                    {receiveInvoiceAddress}
                  </strong>
                  <button className="secondary" onClick={() => void handleCopyReceiveInvoice()} type="button">
                    Copy
                  </button>
                </div>
              </div>
            )}
            {receiveCopyStatus && <p className="subtle">{receiveCopyStatus}</p>}
            {receiveInvoiceStatus && <p className="subtle">Status: {receiveInvoiceStatus}</p>}
            {receiveStep === "paid" && <p className="success-text">Payment received successfully.</p>}
            {receiveError && <p className="error-text">{receiveError}</p>}
            <div className="modal-actions">
              <button className="secondary" onClick={closeModal} type="button">
                Close
              </button>
            </div>
          </>
        </Modal>
      )}

      {activeModal === "channels" && (
        <Modal title="Channels" onClose={closeModal}>
          <div className="channel-toolbar">
            <button
              onClick={() => setCreateChannelOpen(true)}
              type="button"
              disabled={!canCreateChannel}
              title={createChannelDisabledReason}
            >
              Create Channel
            </button>
            <div className="toolbar-actions">
              <button
                onClick={() => void refreshChannels()}
                type="button"
                disabled={isLoadingChannels}
                className="icon-button"
                title="Refresh channels"
              >
                <span className={isLoadingChannels ? "refresh-icon spinning" : "refresh-icon"} aria-hidden="true">
                  {isLoadingChannels ? "⟳" : "↻"}
                </span>
              </button>
              <span className="subtle">{channelCount} open</span>
            </div>
          </div>

          <div className="list">
            {channels.length === 0 && <p className="subtle">No channels.</p>}
            {channels.map((channel) => (
              <article className="channel-item" key={channel.id}>
                <div>
                  <strong title={channel.id}>{channel.id.slice(0, 16)}...</strong>
                  <p className="subtle">{formatCkb(channel.balance)}</p>
                </div>
                <div className="channel-actions">
                  <span className={`status-pill ${channel.status}`}>{channel.statusLabel}</span>
                  <button className="secondary" onClick={() => void handleCloseChannel(channel.id)} type="button">
                    Close
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="modal-actions">
            <button className="secondary" onClick={closeModal} type="button">
              Close
            </button>
          </div>

          {createChannelOpen && (
            <div className="nested-overlay">
              <div className="nested-modal">
                <div className="modal-head">
                  <h3>Create Channel</h3>
                  <button className="icon-button" onClick={() => setCreateChannelOpen(false)} type="button">
                    ×
                  </button>
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateChannel();
                  }}
                >
                  <label className="field">
                    <span>Peer ID (with IP and Port)</span>
                    <input
                      value={peerIdInput}
                      onChange={(event) => setPeerIdInput(event.target.value)}
                      placeholder={DEFAULT_CHANNEL_PEER_ADDRESS}
                    />
                  </label>
                  <div className="modal-actions">
                    <button className="secondary" onClick={resetCreateChannelState} type="button">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!canCreateChannel || !peerIdInput.trim() || isPreparingChannelSigner}
                      title={createChannelDisabledReason}
                    >
                      {isPreparingChannelSigner ? "Preparing..." : "Create"}
                    </button>
                  </div>
                </form>

                {channelSignerSelectorOpen && (
                  <div className="nested-overlay">
                    <div className="nested-modal">
                      <div className="modal-head">
                        <h3>Select Wallet</h3>
                        <button className="icon-button" onClick={resetCreateChannelState} type="button">
                          ×
                        </button>
                      </div>
                      <div className="wallet-picker-list">
                        {availableChannelSigners.map((info) => (
                          <button
                            key={info.id}
                            className="wallet-picker-item"
                            onClick={() => void handleChannelSignerSelected(info)}
                            type="button"
                            disabled={isPreparingChannelSigner}
                          >
                            <strong>{info.walletName}</strong>
                            <span>{info.signerName}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </main>
  );
}

type ActionCardProps = {
  title: string;
  meta?: string;
  disabled?: boolean;
  onClick: () => void;
  centered?: boolean;
};

function ActionCard({ title, meta, disabled, onClick, centered }: ActionCardProps) {
  return (
    <button className={`action-card${centered ? " centered" : ""}`} disabled={disabled} onClick={onClick} type="button">
      <strong>{title}</strong>
      {meta && <span>{meta}</span>}
    </button>
  );
}

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
