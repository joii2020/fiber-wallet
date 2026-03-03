import { Block } from "@ckb-lumos/base";
import { ScriptConfig } from "./types";
type TransactionIndex = number;
type OutputIndex = number;
export declare const SIGHASH_OUTPUT_LOC: [TransactionIndex, OutputIndex];
export declare const MULTISIG_OUTPUT_LOC: [TransactionIndex, OutputIndex];
export declare const DAO_OUTPUT_LOC: [TransactionIndex, OutputIndex];
export declare const SIGHASH_GROUP_OUTPUT_LOC: [TransactionIndex, OutputIndex];
export declare const MULTISIG_GROUP_OUTPUT_LOC: [TransactionIndex, OutputIndex];
/**
 * Generate {@link ScriptConfig} for the genesis block,
 * use this function when you are on a testnet,
 * or you cannot determine which network you are on
 * @example
 *   const rpc = new RPC('http://localhost:8114')
 *   const genesisBlock = await rpc.getBlockByNumber('0x0')
 *   const scriptConfig = generateGenesisScriptConfigs(genesisBlock)
 * @param genesisBlock
 */
export declare function generateGenesisScriptConfigs(genesisBlock: Block): Record<"SECP256K1_BLAKE160" | "SECP256K1_BLAKE160_MULTISIG" | "DAO", ScriptConfig>;
export {};
//# sourceMappingURL=genesis.d.ts.map