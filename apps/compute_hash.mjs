import { ccc } from "@ckb-ccc/ccc";

// JoyID code_hash
const joyIdCodeHash = "0xd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac";

// Type scripts from cells in transaction 0x8f8c...
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

console.log("JoyID Code Hash:", joyIdCodeHash);
console.log("");

for (let i = 0; i < typeScripts.length; i++) {
  const script = typeScripts[i];
  const scriptObj = ccc.Script.from(script);
  const scriptHash = ccc.hashCkb(scriptObj.toBytes());
  console.log(`Type Script ${i + 1}:`);
  console.log(`  Args: ${script.args}`);
  console.log(`  Hash: ${scriptHash}`);
  console.log(`  Match: ${scriptHash === joyIdCodeHash}`);
  console.log("");
}
