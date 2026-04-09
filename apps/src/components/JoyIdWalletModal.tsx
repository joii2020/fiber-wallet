import { truncateAddress } from "../wallet/manager";
import { Modal } from "./ui";

type JoyIdWalletPanelInfo = {
  address: string;
  internalAddress: string;
  balance: string;
};

type JoyIdWalletModalProps = {
  isLoading: boolean;
  walletInfo: JoyIdWalletPanelInfo | null;
  onClose: () => void;
  onManage: () => void;
  onDisconnect: () => void;
};

export function JoyIdWalletModal({
  isLoading,
  walletInfo,
  onClose,
  onManage,
  onDisconnect
}: JoyIdWalletModalProps) {
  return (
    <Modal title="Wallet" onClose={onClose}>
      {isLoading ? (
        <div className="wait-box">
          <div className="spinner" aria-hidden="true" />
          <span>Loading wallet</span>
        </div>
      ) : (
        <>
          <div className="box">
            <span className="subtle">Address</span>
            <strong>{walletInfo ? truncateAddress(walletInfo.address, 10, 8) : "--"}</strong>
            <p className="subtle">{walletInfo?.balance ?? "--"} CKB</p>
            <p className="subtle">
              {walletInfo ? truncateAddress(walletInfo.internalAddress, 12, 10) : "--"}
            </p>
          </div>
          <div className="modal-actions">
            <button onClick={onManage} type="button">
              Manage
            </button>
            <button className="secondary" onClick={onDisconnect} type="button">
              Disconnect
            </button>
          </div>
          <p className="subtle">Network: Testnet</p>
        </>
      )}
    </Modal>
  );
}
