import { ccc } from "@ckb-ccc/ccc";
import type { CkbJsonRpcTransaction } from "@nervosnetwork/fiber-js";
import {
  authWithRedirect,
  signMessageWithRedirect,
  type AuthResponseData,
  type CKBTransaction as JoyIdCkbTransaction,
  type SignMessageRequest
} from "@joyid/common";
import { calculateChallenge } from "@joyid/ckb";
import { toFiberCellDep } from "./fiber-wasm";
import { toCccTransaction } from "./transaction";

/**
 * Prepare witness for OmniLock signing by adjusting the placeholder format.
 * Fiber generates witnesses with 174-byte placeholders for secp256k1 signatures,
 * but OmniLock expects 85-byte placeholders.
 */
const prepareOmniLockWitness = (
  tx: ccc.Transaction,
  lockScript: ccc.Script
): void => {
  // OmniLock requires 85 bytes for the lock field:
  // - 4 bytes: identity auth flags
  // - 4 bytes: identity source
  // - 4 bytes: identity args len
  // - 4 bytes: signature len offset
  // - 4 bytes: signature len
  // - 65 bytes: signature (max size for BTC)
  const OMNI_LOCK_WITNESS_LOCK_LEN = 85;

  for (let i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i];
    if (!input.cellOutput) {
      continue;
    }
    if (!lockScript.eq(input.cellOutput.lock)) {
      continue;
    }

    // Get or create witness args at this position
    let witnessArgs = tx.getWitnessArgsAt(i);
    if (!witnessArgs) {
      witnessArgs = ccc.WitnessArgs.from({});
    }

    // Set lock to OmniLock placeholder size (85 bytes of zeros)
    witnessArgs.lock = ccc.hexFrom(
      new Uint8Array(OMNI_LOCK_WITNESS_LOCK_LEN).fill(0)
    );
    tx.setWitnessArgsAt(i, witnessArgs);
  }
};

export type CkbSignerInfo = {
  id: string;
  label: string;
  walletName: string;
  walletIcon: string;
  signerName: string;
  signer: ccc.Signer;
};

type FundingSignerSupport = {
  supported: boolean;
  reason?: string;
};

export type CccWalletManagerOptions = {
  client?: ccc.Client;
  appName?: string;
  appIcon?: string;
};

type JoyIdConnection = {
  address: string;
  publicKey: string;
  keyType: string;
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
): CkbJsonRpcTransaction => {
  const tx = fundingTx as CkbJsonRpcTransaction & {
    cellDeps?: CkbJsonRpcTransaction["cell_deps"];
    headerDeps?: CkbJsonRpcTransaction["header_deps"];
    outputsData?: CkbJsonRpcTransaction["outputs_data"];
  };

  return {
    // External funding submit only accepts signature/witness updates.
    version: tx.version,
    cell_deps: tx.cell_deps ?? tx.cellDeps ?? [],
    header_deps: tx.header_deps ?? tx.headerDeps ?? [],
    inputs: tx.inputs ?? [],
    outputs: tx.outputs ?? [],
    outputs_data: tx.outputs_data ?? tx.outputsData ?? [],
    witnesses: witnesses.map((witness) => witness as `0x${string}`)
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

  async getJoyIdCkbSigner(): Promise<CkbSignerInfo | null> {
    const signers = await this.refreshCkbSigners();
    return (
      signers.find(
        (info) =>
          info.signer.type === ccc.SignerType.CKB &&
          info.signer.signType === ccc.SignerSignType.JoyId
      ) ?? null
    );
  }

  async persistJoyIdCkbConnection(response: Pick<AuthResponseData, "address" | "pubkey" | "keyType">) {
    const signerInfo = await this.getJoyIdCkbSigner();
    if (!signerInfo) {
      throw new Error("JoyID CKB signer is unavailable");
    }

    const signer = signerInfo.signer as ccc.Signer & {
      connection?: JoyIdConnection;
      saveConnection?: () => Promise<void>;
    };

    signer.connection = {
      address: response.address,
      publicKey: ccc.hexFrom(response.pubkey),
      keyType: response.keyType
    };

    if (typeof signer.saveConnection === "function") {
      await signer.saveConnection();
    }

    return signerInfo;
  }

  redirectToJoyIdAuth(redirectURL: string, state?: unknown): void {
    authWithRedirect({
      redirectURL,
      joyidAppURL: this.client.addressPrefix === "ckb" ? "https://app.joy.id" : "https://testnet.joyid.dev",
      name: this.appName,
      logo: this.appIcon,
      requestNetwork: "nervos",
      state
    });
  }

  async prepareJoyIdSignTx(
    unsignedTx: CkbJsonRpcTransaction,
    signer: ccc.Signer
  ): Promise<{
    tx: JoyIdCkbTransaction;
    witnessIndexes: number[];
    address: string;
    challenge: string;
  }> {
    const tx = ccc.Transaction.from(toCccTransaction(unsignedTx));
    const { script } = await signer.getRecommendedAddressObj();
    const witnessIndexes = await ccc.reduceAsync(tx.inputs, async (acc, input, index) => {
      const { cellOutput } = await input.getCell(this.client);
      if (cellOutput.lock.eq(script)) {
        acc.push(index);
      }
    }, [] as number[]);

    const firstWitnessIndex = witnessIndexes[0];
    if (firstWitnessIndex === undefined) {
      throw new Error("No JoyID-controlled inputs found in funding transaction");
    }

    await tx.prepareSighashAllWitness(script, firstWitnessIndex, this.client);
    tx.inputs.forEach((input) => {
      input.cellOutput = undefined;
      input.outputData = undefined;
    });

    const joyIdTx = JSON.parse(tx.stringify()) as JoyIdCkbTransaction;
    const challenge = await calculateChallenge(joyIdTx, witnessIndexes);

    return {
      tx: joyIdTx,
      witnessIndexes,
      address: await signer.getRecommendedAddress(),
      challenge
    };
  }

  redirectToJoyIdSignTx(
    request: Pick<SignMessageRequest, "challenge" | "address" | "redirectURL" | "state">
  ): void {
    signMessageWithRedirect({
      challenge: request.challenge,
      address: request.address,
      redirectURL: request.redirectURL,
      joyidAppURL: this.client.addressPrefix === "ckb" ? "https://app.joy.id" : "https://testnet.joyid.dev",
      name: this.appName,
      logo: this.appIcon,
      state: request.state
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

    const cccTxLike = toCccTransaction(unsignedTx);
    const cccTx = ccc.Transaction.from(cccTxLike);
    const addressObj = await signer.getRecommendedAddressObj();
    const lockScript = ccc.Script.from(addressObj.script);

    // Check if this is an OmniLock signer (BTC, DOGE, or EVM)
    const omniLockScriptInfo = await signer.client.getKnownScript(ccc.KnownScript.OmniLock);
    const isOmniLock =
      signer.type === ccc.SignerType.BTC ||
      signer.type === ccc.SignerType.Doge ||
      (signer.type === ccc.SignerType.EVM &&
        omniLockScriptInfo.codeHash === lockScript.codeHash);

    if (isOmniLock) {
      // For OmniLock signers, we need to adjust the witness placeholder format
      // because Fiber generates placeholders for secp256k1 (174 bytes),
      // but OmniLock expects a different format (85 bytes).
      await Promise.all(
        cccTx.inputs.map(async (input) => {
          await input.completeExtraInfos(this.client);
        })
      );
      prepareOmniLockWitness(cccTx, lockScript);
    }

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
