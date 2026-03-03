// Check if data_hash matches JoyID code_hash
const joyIdCodeHash = "0xd23761b364210735e19c60561d213fb3beae2fd6172743719eff6920e020baac";
const cellDep1DataHash = "0x1157470ca9de091c21c262bf0754b777f3529e10d2728db8f6b4e04cfc2fbb5f";

console.log("JoyID Code Hash:     ", joyIdCodeHash);
console.log("Cell Dep 1 Data Hash:", cellDep1DataHash);
console.log("Match:", joyIdCodeHash === cellDep1DataHash);
