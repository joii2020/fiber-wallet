const cachedFiberConfigs = new Map<string, Promise<string>>();

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
