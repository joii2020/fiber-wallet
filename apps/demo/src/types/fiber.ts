/**
 * Fiber Host 通信类型定义
 * 供 main.ts 和 fiber-host.ts 共享
 */

import type {
  CkbJsonRpcTransaction,
  Channel,
  OpenChannelWithExternalFundingParams,
  OpenChannelWithExternalFundingResult
} from "@nervosnetwork/fiber-js";

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
    result: { channels: Channel[] };
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
    payload: OpenChannelWithExternalFundingParams;
    result: OpenChannelWithExternalFundingResult;
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
