import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { truncateAddress } from "../utils/stringUtils";

type WalletButtonProps = {
  onClick?: () => void;
  centered?: boolean;
};

export function WalletButton({ onClick, centered = false }: WalletButtonProps) {
  const { open, wallet } = ccc.useCcc();
  const [balance, setBalance] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const signer = ccc.useSigner();

  useEffect(() => {
    let canceled = false;

    const loadWalletInfo = async () => {
      if (!signer) {
        setBalance("");
        setAddress("");
        return;
      }

      try {
        const [addr, addressObjs] = await Promise.all([
          signer.getRecommendedAddress(),
          signer.getAddressObjs(),
        ]);

        let totalCapacity = 0n;
        for (const { script } of addressObjs) {
          const capacity = await signer.client.getCellsCapacity({
            script,
            scriptType: "lock",
            scriptSearchMode: "exact",
          });
          totalCapacity += capacity;
        }

        if (canceled) return;
        setAddress(addr);
        setBalance(ccc.fixedPointToString(totalCapacity));
      } catch (error) {
        console.warn("Failed to load wallet info", error);
        if (canceled) return;
        setBalance("--");
      }
    };

    void loadWalletInfo();

    return () => {
      canceled = true;
    };
  }, [signer]);

  const handleClick = () => {
    if (wallet && onClick) {
      onClick();
    } else {
      open();
    }
  };

  // Not connected - show "Connect Wallet" button (centered, no meta)
  if (!wallet) {
    return (
      <button
        className={`action-card${centered ? " centered" : ""}`}
        onClick={handleClick}
        type="button"
      >
        <strong>Connect Wallet</strong>
      </button>
    );
  }

  // Connected - show wallet icon, balance, and address
  return (
    <button
      className={`action-card wallet-connected${centered ? " centered" : ""}`}
      onClick={handleClick}
      type="button"
    >
      <div className="wallet-button-content">
        <div className="wallet-icon">
          {wallet.icon && <img src={wallet.icon} alt="wallet" />}
        </div>
        <div className="wallet-info">
          <span className="wallet-balance">{balance ? `${balance} CKB` : "-- CKB"}</span>
          <span className="wallet-address">{address ? truncateAddress(address, 8, 6) : "--"}</span>
        </div>
      </div>
    </button>
  );
}
