import { ccc } from "@ckb-ccc/ccc";
import type { CkbJsonRpcTransaction, Script } from "@nervosnetwork/fiber-js";
import { toFiberScript } from "./fiber-wasm";

export type CkbSignerInfo = {
  id: string;
  label: string;
  walletName: string;
  walletIcon: string;
  signerName: string;
  signer: ccc.Signer;
};

export type CccWalletManagerOptions = {
  client?: ccc.Client;
  appName?: string;
  appIcon?: string;
};

const DEFAULT_APP_ICON =
  "https://raw.githubusercontent.com/ckb-devrel/ccc/master/assets/logo.svg";

const normalizeDepType = (depType: string): "code" | "depGroup" => {
  if (depType === "dep_group" || depType === "depGroup") {
    return "depGroup";
  }
  return "code";
};

export const toCccTransaction = (unsignedTx: CkbJsonRpcTransaction): ccc.TransactionLike => {
  return {
    version: unsignedTx.version,
    cellDeps: unsignedTx.cell_deps.map((cellDep) => ({
      depType: normalizeDepType(cellDep.dep_type),
      outPoint: {
        txHash: cellDep.out_point.tx_hash,
        index: cellDep.out_point.index
      }
    })),
    headerDeps: unsignedTx.header_deps,
    inputs: unsignedTx.inputs.map((input) => ({
      previousOutput: {
        txHash: input.previous_output.tx_hash,
        index: input.previous_output.index
      },
      since: input.since
    })),
    outputs: unsignedTx.outputs.map((output) => ({
      capacity: output.capacity,
      lock: {
        codeHash: output.lock.code_hash,
        hashType: output.lock.hash_type,
        args: output.lock.args
      },
      type: output.type
        ? {
            codeHash: output.type.code_hash,
            hashType: output.type.hash_type,
            args: output.type.args
          }
        : undefined
    })),
    outputsData: unsignedTx.outputs_data,
    witnesses: unsignedTx.witnesses
  };
};

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
                if (signerInfo.signer.type !== ccc.SignerType.CKB) {
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

  async getSignerFiberScript(signer: ccc.Signer): Promise<Script> {
    const address = await signer.getRecommendedAddress();
    const addressObj = await ccc.Address.fromString(address, signer.client);
    return toFiberScript(addressObj.script);
  }

  async signFundingTx(
    unsignedTx: CkbJsonRpcTransaction,
    signer: ccc.Signer
  ): Promise<CkbJsonRpcTransaction> {
    const cccTx = toCccTransaction(unsignedTx);
    const signedTx = await signer.signOnlyTransaction(cccTx);
    return {
      ...unsignedTx,
      witnesses: signedTx.witnesses.map((witness) => witness as `0x${string}`)
    };
  }
}
