import { ccc } from "@ckb-ccc/ccc";
import type { CkbJsonRpcTransaction } from "@nervosnetwork/fiber-js";

const normalizeDepType = (depType: string): "code" | "depGroup" => {
  if (depType === "dep_group" || depType === "depGroup") {
    return "depGroup";
  }
  return "code";
};

export const toCccTransaction = (tx: CkbJsonRpcTransaction): ccc.TransactionLike => ({
  version: tx.version,
  cellDeps: tx.cell_deps.map((cellDep) => ({
    depType: normalizeDepType(cellDep.dep_type),
    outPoint: {
      txHash: cellDep.out_point.tx_hash,
      index: cellDep.out_point.index
    }
  })),
  headerDeps: tx.header_deps,
  inputs: tx.inputs.map((input) => ({
    previousOutput: {
      txHash: input.previous_output.tx_hash,
      index: input.previous_output.index
    },
    since: input.since
  })),
  outputs: tx.outputs.map((output) => ({
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
  outputsData: tx.outputs_data,
  witnesses: tx.witnesses
});
