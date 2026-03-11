import { ccc } from "@ckb-ccc/ccc";
import type { CkbJsonRpcTransaction } from "@nervosnetwork/fiber-js";
import { toFiberCellDep } from "./fiber-wasm";
import { toCccTransaction } from "./transaction";

export type CkbSignerInfo = {
  id: string;
  label: string;
  walletName: string;
  walletIcon: string;
  signerName: string;
  signer: ccc.Signer;
};

export type FundingSignerSupport = {
  supported: boolean;
  reason?: string;
};

export type CccWalletManagerOptions = {
  client?: ccc.Client;
  appName?: string;
  appIcon?: string;
};

const DEFAULT_APP_ICON =
  "https://raw.githubusercontent.com/ckb-devrel/ccc/master/assets/logo.svg";

const KNOWN_LOCK_SCRIPTS = [
  ccc.KnownScript.Secp256k1Blake160,
  ccc.KnownScript.Secp256k1Multisig,
  ccc.KnownScript.Secp256k1MultisigV2,
  ccc.KnownScript.AnyoneCanPay,
  ccc.KnownScript.JoyId,
  ccc.KnownScript.PWLock,
  ccc.KnownScript.OmniLock,
  ccc.KnownScript.NostrLock
] as const;

const supportsLockScript = (
  signer: ccc.Signer,
  knownScript: ccc.KnownScript
): FundingSignerSupport => {
  switch (knownScript) {
    case ccc.KnownScript.Secp256k1Blake160:
      return signer.type === ccc.SignerType.CKB &&
        signer.signType === ccc.SignerSignType.CkbSecp256k1
        ? { supported: true }
        : { supported: false, reason: "Signer does not support secp256k1 funding locks" };
    case ccc.KnownScript.JoyId:
      return signer.signType === ccc.SignerSignType.JoyId
        ? { supported: true }
        : { supported: false, reason: "Signer does not support JoyID funding locks" };
    case ccc.KnownScript.OmniLock:
      return signer.type === ccc.SignerType.BTC ||
        signer.type === ccc.SignerType.Doge ||
        signer.type === ccc.SignerType.EVM
        ? { supported: true }
        : {
            supported: false,
            reason: "OmniLock funding requires a BTC, Doge, or EVM signer"
          };
    case ccc.KnownScript.PWLock:
      return signer.type === ccc.SignerType.EVM
        ? { supported: true }
        : { supported: false, reason: "PW Lock funding requires an EVM signer" };
    case ccc.KnownScript.NostrLock:
      return signer.type === ccc.SignerType.Nostr
        ? { supported: true }
        : { supported: false, reason: "NostrLock funding requires a Nostr signer" };
    default:
      return { supported: false, reason: `Unsupported funding lock script: ${knownScript}` };
  }
};

export const withFundingTxWitnesses = (
  fundingTx: CkbJsonRpcTransaction,
  witnesses: string[]
): CkbJsonRpcTransaction => ({
  // External funding submit only accepts signature/witness updates.
  ...fundingTx,
  witnesses: witnesses.map((witness) => witness as `0x${string}`)
});

export class CccWalletManager {
  private readonly signersController = new ccc.SignersController();
  private readonly client: ccc.Client;
  private readonly appName: string;
  private readonly appIcon: string;

  constructor(options: CccWalletManagerOptions = {}) {
    this.client = options.client ?? new ccc.ClientPublicTestnet();
    this.appName = options.appName ?? "Fiber Wallet";
    this.appIcon = options.appIcon ?? DEFAULT_APP_ICON;
  }

  async refreshCkbSigners(): Promise<CkbSignerInfo[]> {
    return new Promise((resolve, reject) => {
      this.signersController
        .refresh(
          this.client,
          (wallets) => {
            const infos: CkbSignerInfo[] = [];
            for (const wallet of wallets) {
              for (const signerInfo of wallet.signers) {
                if (
                  signerInfo.signer.type !== ccc.SignerType.CKB &&
                  signerInfo.signer.type !== ccc.SignerType.BTC &&
                  signerInfo.signer.type !== ccc.SignerType.EVM &&
                  signerInfo.signer.type !== ccc.SignerType.Doge &&
                  signerInfo.signer.type !== ccc.SignerType.Nostr
                ) {
                  continue;
                }

                const id = `${wallet.name}::${signerInfo.name}::${infos.length}`;
                infos.push({
                  id,
                  label: `${wallet.name} / ${signerInfo.name}`,
                  walletName: wallet.name,
                  walletIcon: wallet.icon,
                  signerName: signerInfo.name,
                  signer: signerInfo.signer
                });
              }
            }
            resolve(infos);
          },
          {
            name: this.appName,
            icon: this.appIcon
          }
        )
        .catch((error) => reject(error));
    });
  }

  async connectSigner(signer: ccc.Signer): Promise<{ signer: ccc.Signer; address: string }> {
    if (!(await signer.isConnected())) {
      await signer.connect();
    }
    const address = await signer.getRecommendedAddress();
    return { signer, address };
  }

  async signMessage(signer: ccc.Signer, message: string): Promise<ccc.Signature> {
    return signer.signMessage(message);
  }

  async signFundingTx(
    unsignedTx: CkbJsonRpcTransaction,
    signer: ccc.Signer
  ): Promise<CkbJsonRpcTransaction> {
    const support = await this.getFundingSignerSupport(signer);
    if (!support.supported) {
      throw new Error(support.reason ?? "Unsupported signer for funding transaction");
    }

    const cccTx = toCccTransaction(unsignedTx);
    const signedTx = await signer.signOnlyTransaction(cccTx);
    return withFundingTxWitnesses(unsignedTx, signedTx.witnesses);
  }

  async getFundingSignerSupport(signer: ccc.Signer): Promise<FundingSignerSupport> {
    const addressObj = await signer.getRecommendedAddressObj();
    const lockScript = ccc.Script.from(addressObj.script);

    for (const knownScript of KNOWN_LOCK_SCRIPTS) {
      const scriptInfo = await signer.client.getKnownScript(knownScript);
      if (
        scriptInfo.codeHash !== lockScript.codeHash ||
        scriptInfo.hashType !== lockScript.hashType
      ) {
        continue;
      }

      return supportsLockScript(signer, knownScript);
    }

    return {
      supported: false,
      reason: "Funding address uses an unknown lock script"
    };
  }

  async getFundingLockScriptCellDeps(signer: ccc.Signer): Promise<
    | {
        dep_type: "code" | "dep_group";
        out_point: {
          tx_hash: `0x${string}`;
          index: `0x${string}`;
        };
      }[]
    | undefined
  > {
    const addressObj = await signer.getRecommendedAddressObj();
    const lockScript = ccc.Script.from(addressObj.script);

    for (const knownScript of KNOWN_LOCK_SCRIPTS) {
      const scriptInfo = await signer.client.getKnownScript(knownScript);
      if (
        scriptInfo.codeHash !== lockScript.codeHash ||
        scriptInfo.hashType !== lockScript.hashType
      ) {
        continue;
      }

      const cellDeps = await signer.client.getCellDeps(scriptInfo.cellDeps);
      return cellDeps.map((cellDep) =>
        toFiberCellDep({
          depType: cellDep.depType,
          outPoint: {
            txHash: cellDep.outPoint.txHash,
            index: cellDep.outPoint.index
          }
        })
      );
    }

    return undefined;
  }
}
