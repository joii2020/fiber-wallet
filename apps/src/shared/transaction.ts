import { ccc } from "@ckb-ccc/ccc";
import type { CkbJsonRpcTransaction } from "@nervosnetwork/fiber-js";

const normalizeDepType = (depType: string): "code" | "depGroup" => {
  if (depType === "dep_group" || depType === "depGroup") {
    return "depGroup";
  }
  return "code";
};

const toArray = <T>(value: T[] | undefined): T[] => value ?? [];

const toCccScript = (script: {
  code_hash?: string;
  codeHash?: string;
  hash_type?: string;
  hashType?: string;
  args: string;
}) => ({
  codeHash: script.code_hash ?? script.codeHash ?? "0x",
  hashType: (script.hash_type ?? script.hashType ?? "type") as ccc.ScriptLike["hashType"],
  args: script.args
});

export const toCccTransaction = (tx: CkbJsonRpcTransaction): ccc.TransactionLike => {
  const rawTx = tx as CkbJsonRpcTransaction & {
    cell_deps?: Array<{
      dep_type?: string;
      depType?: string;
      out_point?: {
        tx_hash?: string;
        index: string;
      };
      outPoint?: {
        txHash?: string;
        index: string;
      };
    }>;
    cellDeps?: Array<{
      dep_type?: string;
      depType?: string;
      out_point?: {
        tx_hash?: string;
        index: string;
      };
      outPoint?: {
        txHash?: string;
        index: string;
      };
    }>;
    header_deps?: string[];
    headerDeps?: string[];
    inputs?: Array<{
      previous_output?: {
        tx_hash?: string;
        index: string;
      };
      previousOutput?: {
        txHash?: string;
        index: string;
      };
      since: string;
    }>;
    outputs?: Array<{
      capacity: string;
      lock: {
        code_hash?: string;
        codeHash?: string;
        hash_type?: string;
        hashType?: string;
        args: string;
      };
      type?: {
        code_hash?: string;
        codeHash?: string;
        hash_type?: string;
        hashType?: string;
        args: string;
      };
    }>;
    outputs_data?: string[];
    outputsData?: string[];
    witnesses?: string[];
  };

  const cellDeps = rawTx.cell_deps ?? rawTx.cellDeps;
  const headerDeps = rawTx.header_deps ?? rawTx.headerDeps;
  const inputs = rawTx.inputs;
  const outputs = rawTx.outputs;
  const outputsData = rawTx.outputs_data ?? rawTx.outputsData;
  const witnesses = rawTx.witnesses;

  return {
    version: tx.version,
    cellDeps: toArray(cellDeps).map((cellDep) => ({
      depType: normalizeDepType(cellDep.dep_type ?? cellDep.depType ?? "code"),
      outPoint: {
        txHash: cellDep.out_point?.tx_hash ?? cellDep.outPoint?.txHash ?? "0x",
        index: cellDep.out_point?.index ?? cellDep.outPoint?.index ?? "0x0"
      }
    })),
    headerDeps: toArray(headerDeps),
    inputs: toArray(inputs).map((input) => ({
      previousOutput: {
        txHash: input.previous_output?.tx_hash ?? input.previousOutput?.txHash ?? "0x",
        index: input.previous_output?.index ?? input.previousOutput?.index ?? "0x0"
      },
      since: input.since
    })),
    outputs: toArray(outputs).map((output) => ({
      capacity: output.capacity,
      lock: toCccScript(output.lock),
      type: output.type ? toCccScript(output.type) : undefined
    })),
    outputsData: toArray(outputsData),
    witnesses: toArray(witnesses)
  };
};
