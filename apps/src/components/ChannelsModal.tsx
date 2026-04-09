import type { CkbSignerInfo } from "../wallet/manager";
import { Modal } from "./ui";

type ChannelSummary = {
  id: string;
  status: "good" | "warn" | "idle" | "error";
  statusLabel: string;
  balance: number;
};

type ChannelsModalProps = {
  channels: ChannelSummary[];
  channelCount: number;
  canCreateChannel: boolean;
  createChannelDisabledReason?: string;
  isLoadingChannels: boolean;
  createChannelOpen: boolean;
  peerIdInput: string;
  isPreparingChannelSigner: boolean;
  channelSignerSelectorOpen: boolean;
  availableChannelSigners: CkbSignerInfo[];
  formatCkb: (value: number) => string;
  placeholderPeerAddress: string;
  onClose: () => void;
  onOpenCreateChannel: () => void;
  onCloseCreateChannel: () => void;
  onRefreshChannels: () => void;
  onPeerIdInputChange: (value: string) => void;
  onCreateChannel: () => void;
  onResetCreateChannelState: () => void;
  onSelectChannelSigner: (info: CkbSignerInfo) => void;
  onCloseChannel: (id: string) => void;
};

export function ChannelsModal({
  channels,
  channelCount,
  canCreateChannel,
  createChannelDisabledReason,
  isLoadingChannels,
  createChannelOpen,
  peerIdInput,
  isPreparingChannelSigner,
  channelSignerSelectorOpen,
  availableChannelSigners,
  formatCkb,
  placeholderPeerAddress,
  onClose,
  onOpenCreateChannel,
  onCloseCreateChannel,
  onRefreshChannels,
  onPeerIdInputChange,
  onCreateChannel,
  onResetCreateChannelState,
  onSelectChannelSigner,
  onCloseChannel
}: ChannelsModalProps) {
  return (
    <Modal title="Channels" onClose={onClose}>
      <div className="channel-toolbar">
        <button
          onClick={onOpenCreateChannel}
          type="button"
          disabled={!canCreateChannel}
          title={createChannelDisabledReason}
        >
          Create Channel
        </button>
        <div className="toolbar-actions">
          <button
            onClick={onRefreshChannels}
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
              <button className="secondary" onClick={() => onCloseChannel(channel.id)} type="button">
                Close
              </button>
            </div>
          </article>
        ))}
      </div>

      {createChannelOpen && (
        <div className="nested-overlay">
          <div className="nested-modal">
            <div className="modal-head">
              <h3>Create Channel</h3>
              <button className="icon-button" onClick={onCloseCreateChannel} type="button">
                ×
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onCreateChannel();
              }}
            >
              <label className="field">
                <span>Peer ID (with IP and Port)</span>
                <input
                  value={peerIdInput}
                  onChange={(event) => onPeerIdInputChange(event.target.value)}
                  placeholder={placeholderPeerAddress}
                />
              </label>
              <div className="modal-actions">
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
                    <button className="icon-button" onClick={onResetCreateChannelState} type="button">
                      ×
                    </button>
                  </div>
                  <div className="wallet-picker-list">
                    {availableChannelSigners.map((info) => (
                      <button
                        key={info.id}
                        className="wallet-picker-item"
                        onClick={() => onSelectChannelSigner(info)}
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
  );
}
