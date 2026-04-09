export type FiberStatus = "loading" | "running" | "error";

export type ChannelStatus = "good" | "warn" | "idle" | "error";

export type ChannelSummary = {
  id: string;
  status: ChannelStatus;
  statusLabel: string;
  balance: number;
  isReady: boolean;
  rawStateName?: string;
};

export type PendingCreatedChannel = {
  id: string;
  peerId: string;
  hasAppeared: boolean;
};

export type PayInvoiceInfo = {
  invoiceAddress: string;
  paymentHash: string;
  currency: string;
  amountCkb: number | null;
  expiry: string;
  description: string;
};
