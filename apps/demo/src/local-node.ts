export type LocalRelayInfo = {
  address: string;
  peerId: string;
};

type JsonRpcError = {
  code: number;
  message: string;
};

type JsonRpcResponse<T> = {
  result?: T;
  error?: JsonRpcError;
};

type ListPeersResult = {
  peers: Array<{
    peer_id: string;
    address: string;
  }>;
};

type ListChannelsResult = {
  channels: Array<{
    channel_id: string;
    state: {
      state_name: string;
    };
  }>;
};

type OpenChannelParams = {
  peer_id: string;
  funding_amount: `0x${string}`;
  public: boolean;
};

type NodeInfoResult = {
  node_name: string;
  peer_id: string;
  addresses: string[];
  chain_hash: string;
};

const parsePeerId = (address: string): string => {
  return address.trim().match(/\/p2p\/([^/]+)(?:\/|$)/)?.[1] ?? "";
};

export class LocalFiberNode {
  private id = 1;

  constructor(private readonly rpcUrl: string) {}

  static parseRelayInfo(address: string): LocalRelayInfo {
    const peerId = parsePeerId(address);
    if (!peerId) {
      throw new Error("Peer address must include /p2p/<peer-id>");
    }
    return {
      address: address.trim(),
      peerId
    };
  }

  private async request<T>(method: string, params: unknown[] = []): Promise<T> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.id++,
        method,
        params
      })
    });

    if (!res.ok) {
      throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) {
      throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    }
    if (json.result === undefined) {
      throw new Error("RPC response missing result");
    }
    return json.result;
  }

  connectPeer(address: string): Promise<void> {
    return this.request<void>("connect_peer", [{ address }]);
  }

  listPeers(): Promise<ListPeersResult> {
    return this.request<ListPeersResult>("list_peers");
  }

  listChannels(peerId?: string): Promise<ListChannelsResult> {
    const params = peerId ? [{ peer_id: peerId }] : [];
    return this.request<ListChannelsResult>("list_channels", params);
  }

  nodeInfo(): Promise<NodeInfoResult> {
    return this.request<NodeInfoResult>("node_info", [{}]);
  }

  openChannel(params: OpenChannelParams): Promise<unknown> {
    return this.request<unknown>("open_channel", [params]);
  }
}
