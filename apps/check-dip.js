// 检查 DIP 支持情况
console.log("=== Document-Isolation-Policy (DIP) 支持检查 ===\n");

console.log("1. Chrome 版本检查:");
console.log("   用户代理:", navigator.userAgent);
console.log("   DIP 需要 Chrome 137+ (2025年5月发布)\n");

console.log("2. crossOriginIsolated 状态:");
console.log("   ", window.crossOriginIsolated ? "✅ 已启用" : "❌ 未启用");

console.log("\n3. DIP 头部检测:");
// 无法直接读取响应头，但可以通过其他方式推断
console.log("   请检查 DevTools Network 面板查看响应头");

console.log("\n4. 如何启用 DIP:");
console.log("   方法 1: 升级到 Chrome 137+");
console.log("   方法 2: 启用实验性标志:");
console.log("     chrome://flags/#document-isolation-policy");
console.log("   方法 3: 申请 Origin Trial");
console.log("     https://developer.chrome.com/origintrials");

console.log("\n5. 替代方案:");
console.log("   如果 DIP 不可用，继续使用 COOP/COEP 方案");
console.log("   (demo/index.html - 弹窗模式)");
