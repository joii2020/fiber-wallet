import { ccc } from "@ckb-ccc/ccc";

const joyIdCodeHash = "0xd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac";

// Try to find a cell with type script hash matching JoyID code hash
// We'll check some known cells first

const cellsToCheck = [
  // From transaction 0x8f8c79eb...
  { txHash: "0x8f8c79eb6671709633fe6a46de93c0fedc9c1b8a6527a18d3983879542635c9f", index: "0x1" },
  { txHash: "0x8f8c79eb6671709633fe6a46de93c0fedc9c1b8a6527a18d3983879542635c9f", index: "0x2" },
  { txHash: "0x8f8c79eb6671709633fe6a46de93c0fedc9c1b8a6527a18d3983879542635c9f", index: "0x4" },
  // From SDK's old Cell Dep
  { txHash: "0x4dcf3f3b09efac8995d6cbee87c5345e812d310094651e0c3d9a730f32dc9263", index: "0x0" },
];

console.log("JoyID Code Hash:", joyIdCodeHash);
console.log("");

// We can't easily query the RPC from here, so let's just print the type scripts
// we need to check
const typeScripts = [
  {
    codeHash: "0x00000000000000000000000000000000000000000000000000545950455f4944",
    hashType: "type",
    args: "0x8536c9d5d908bd89fc70099e4284870708b6632356aad98734fcf43f6f71c304"
  },
  {
    codeHash: "0x00000000000000000000000000000000000000000000000000545950455f4944",
    hashType: "type",
    args: "0xb2a8500929d6a1294bf9bf1bf565f549fa4a5f1316a3306ad3d4783e64bcf626"
  },
  {
    codeHash: "0x00000000000000000000000000000000000000000000000000545950455f4944",
    hashType: "type",
    args: "0xd813c1b15bd79c8321ad7f5819e5d9f659a1042b72e64659a2c092be68ea9758"
  }
];

for (let i = 0; i < typeScripts.length; i++) {
  const script = typeScripts[i];
  const scriptObj = ccc.Script.from(script);
  const scriptHash = ccc.hashCkb(scriptObj.toBytes());
  console.log(`Type Script ${i + 1}: ${script.args}`);
  console.log(`  Hash: ${scriptHash}`);
  console.log(`  Match: ${scriptHash === joyIdCodeHash}`);
  console.log("");
}

console.log("None of these match JoyID code hash.");
console.log("We need to find the correct type script that produces hash:", joyIdCodeHash);
