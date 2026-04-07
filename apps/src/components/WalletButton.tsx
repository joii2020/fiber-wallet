import { useCallback, useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { ccc as cccCore } from "@ckb-ccc/ccc";
import { truncateAddress } from "../utils/stringUtils";

type WalletButtonProps = {
  onClick?: () => void;
  onConnect?: () => void;
  centered?: boolean;
  walletOverride?: {
    name: string;
    icon?: string;
  } | null;
  signerOverride?: cccCore.Signer | null;
};

export function WalletButton({
  onClick,
  onConnect,
  centered = false,
  walletOverride,
  signerOverride
}: WalletButtonProps) {
  const { open, wallet } = ccc.useCcc();
  const [balance, setBalance] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const connectedSigner = ccc.useSigner();
  const signer = signerOverride ?? connectedSigner;
  const effectiveWallet = walletOverride ?? wallet;

  const loadWalletInfo = useCallback(async () => {
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

      setAddress(addr);
      setBalance(ccc.fixedPointToString(totalCapacity));
    } catch (error) {
      console.warn("Failed to load wallet info", error);
      setBalance("--");
    }
  }, [signer]);

  useEffect(() => {
    let canceled = false;

    const load = async () => {
      if (canceled) return;
      await loadWalletInfo();
    };

    void load();

    return () => {
      canceled = true;
    };
  }, [loadWalletInfo]);

  const handleRefresh = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isRefreshing || !signer) return;
    
    setIsRefreshing(true);
    try {
      await loadWalletInfo();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, signer, loadWalletInfo]);

  const handleClick = () => {
    if (effectiveWallet) {
      onClick?.();
      return;
    }

    if (onConnect) {
      onConnect();
    } else {
      open();
    }
  };

  if (!effectiveWallet) {
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

  return (
    <button
      className={`action-card wallet-connected${centered ? " centered" : ""}`}
      onClick={handleClick}
      type="button"
    >
      <div className="wallet-button-content">
        <div className="wallet-icon">
          {effectiveWallet.icon && <img src={effectiveWallet.icon} alt="wallet" />}
        </div>
        <div className="wallet-info">
          <span className="wallet-balance">{balance ? `${balance} CKB` : "-- CKB"}</span>
          <span className="wallet-address">{address ? truncateAddress(address, 8, 6) : "--"}</span>
        </div>
      </div>
      <span
        className={isRefreshing ? "refresh-icon spinning" : "refresh-icon"}
        onClick={handleRefresh}
        role="button"
        aria-label="Refresh balance"
        title="Refresh balance"
      >
        {isRefreshing ? "⟳" : "↻"}
      </span>
    </button>
  );
}
