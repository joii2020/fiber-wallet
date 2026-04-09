import type { CkbJsonRpcTransaction } from "@nervosnetwork/fiber-js";

export const logFundingTxDebug = (
  label: string,
  channelId: string,
  tx: CkbJsonRpcTransaction,
  extra?: Record<string, unknown>
): void => {
  const firstInput = tx.inputs?.[0];
  const firstWitness = tx.witnesses?.[0];
  console.log(`[funding-tx] ${label}`, {
    channelId,
    version: tx.version,
    inputCount: tx.inputs?.length ?? 0,
    outputCount: tx.outputs?.length ?? 0,
    witnessCount: tx.witnesses?.length ?? 0,
    firstInputPreviousOutput: firstInput?.previous_output ?? null,
    firstInputSince: firstInput?.since ?? null,
    firstWitness: firstWitness ?? null,
    cellDeps: tx.cell_deps ?? [],
    headerDeps: tx.header_deps ?? [],
    inputs: tx.inputs ?? [],
    outputs: tx.outputs ?? [],
    outputsData: tx.outputs_data ?? [],
    witnesses: tx.witnesses ?? [],
    ...extra
  });
};
