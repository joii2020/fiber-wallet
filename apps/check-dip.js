// Check DIP support
console.log("=== Document-Isolation-Policy (DIP) Support Check ===\n");

console.log("1. Chrome Version Check:");
console.log("   User Agent:", navigator.userAgent);
console.log("   DIP requires Chrome 137+ (May 2025 release)\n");

console.log("2. crossOriginIsolated Status:");
console.log("   ", window.crossOriginIsolated ? "✅ Enabled" : "❌ Not Enabled");

console.log("\n3. DIP Header Detection:");
// Cannot directly read response headers, but can infer through other methods
console.log("   Please check DevTools Network panel to view response headers");

console.log("\n4. How to Enable DIP:");
console.log("   Method 1: Upgrade to Chrome 137+");
console.log("   Method 2: Enable experimental flag:");
console.log("     chrome://flags/#document-isolation-policy");
console.log("   Method 3: Apply for Origin Trial");
console.log("     https://developer.chrome.com/origintrials");

console.log("\n5. Alternative Solution:");
console.log("   If DIP is not available, continue using COOP/COEP solution");
console.log("   (demo/index.html - popup mode)");
