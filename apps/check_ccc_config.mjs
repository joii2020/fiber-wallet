import { ccc } from "@ckb-ccc/ccc";

// Check if ccc has predefined scripts
console.log("Available predefined scripts in CCC:");
console.log(Object.keys(ccc.predefinedScripts || {}));
console.log("");

// Check if there's any mention of joyid
for (const [name, script] of Object.entries(ccc.predefinedScripts || {})) {
  if (name.toLowerCase().includes("joy")) {
    console.log(`Found JoyID script: ${name}`, script);
  }
}
