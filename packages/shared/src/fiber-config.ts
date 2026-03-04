const isHex32 = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value.trim());

const bytesToHex = (bytes: Uint8Array): `0x${string}` => {
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
};

let cachedFiberConfigs = new Map<string, Promise<string>>();

export const DEMO_FIBER_CONFIG_PATH = "/demo/fiber-config-testnet.yml";

export const getFiberConfig = (configPath: string = DEMO_FIBER_CONFIG_PATH): Promise<string> => {
  const existing = cachedFiberConfigs.get(configPath);
  if (existing) {
    return existing;
  }

  const fetchPromise = fetch(configPath).then(async (res) => {
    if (!res.ok) {
      throw new Error(`Failed to load fiber config: ${res.status} ${res.statusText}`);
    }
    return res.text();
  });

  cachedFiberConfigs.set(configPath, fetchPromise);
  return fetchPromise;
};
