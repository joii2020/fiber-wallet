import type { OutPoint, Output, Script } from "@ckb-lumos/base";
import type { ScriptConfigs } from "./types";
type MaybePromise<T> = T | PromiseLike<T>;
/**
 * resolve the latest `OutPoint[]` that has consumed the old `OutPoint[]`
 */
export type ResolveLatestOutPointsOfTypeIds = (outPoints: OutPoint[]) => MaybePromise<OutPoint[]>;
export type FetchOutputsByTxHashes = (txHashes: string[]) => MaybePromise<{
    outputs: Output[];
}[]>;
/**
 * fetch cells with corresponding type script
 */
export type FetchOutPointsByTypeIds = (scripts: Script[]) => MaybePromise<{
    outPoint: OutPoint;
}[]>;
/**
 * the minimal batch RPC client
 */
export type BatchRequest = {
    createBatchRequest<Params, Result>(params: Params[]): {
        exec(): Promise<Result[]>;
    };
};
export declare function createRpcResolver(rpc: BatchRequest): ResolveLatestOutPointsOfTypeIds;
export declare function createLatestTypeIdResolver(fetchOutputs: FetchOutputsByTxHashes, fetchTypeScriptCell: FetchOutPointsByTypeIds): ResolveLatestOutPointsOfTypeIds;
type RefreshConfig<S> = {
    resolve: ResolveLatestOutPointsOfTypeIds;
    skip?: (keyof S)[];
};
/**
 * Refreshing the config items in {@link ScriptConfigs} which are deployed with type id
 * @example
 * const updatedScriptConfigs = await refreshScriptConfigs(predefined.AGGRON4.SCRIPTS, { resolve: createRpcResolver(rpc) })
 * initializeConfig({ SCRIPTS: updatedScriptConfigs })
 */
export declare function refreshScriptConfigs<S extends ScriptConfigs>(scriptConfigs: S, { resolve, skip, }: RefreshConfig<S>): Promise<S>;
export {};
//# sourceMappingURL=refresh.d.ts.map