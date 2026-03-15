/**
 * Fiber Host communication type definitions
 * Shared between main.ts and fiber-host.ts
 */

import type {
  CkbJsonRpcTransaction,
  Channel,
} from "@nervosnetwork/fiber-js";
import type {
  OpenChannelWithExternalFundingCompatParams,
  OpenChannelWithExternalFundingCompatResult
} from "@fiber-wallet/shared";

export type FiberHostAction =
  | "startFiberNode"
  | "listChannels"
  | "shutdownChannel"
  | "openChannelWithExternalFunding"
  | "submitSignedFundingTx";

export type FiberHostControlMessage = {
  kind: "dispose";
};

export type FiberHostRequestMap = {
  startFiberNode: {
    payload: { nativeAddress: string };
    result: { channels: Channel[]; connectedPeerPubkey: string };
  };
  listChannels: {
    payload: undefined;
    result: { channels: Channel[] };
  };
  shutdownChannel: {
    payload: { channelId: string };
    result: { ok: true };
  };
  openChannelWithExternalFunding: {
    payload: OpenChannelWithExternalFundingCompatParams;
    result: OpenChannelWithExternalFundingCompatResult;
  };
  submitSignedFundingTx: {
    payload: {
      channelId: string;
      signedTx: CkbJsonRpcTransaction;
    };
    result: { ok: true };
  };
};

export type FiberHostRequest = {
  kind: "request";
  requestId: string;
  action: FiberHostAction;
  payload?: unknown;
};

export type FiberHostResponse = {
  kind: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type FiberHostReady = {
  kind: "ready";
};

export type FiberHostMessage = FiberHostRequest | FiberHostResponse | FiberHostReady | FiberHostControlMessage;
