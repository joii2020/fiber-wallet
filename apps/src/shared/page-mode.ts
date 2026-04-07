export type AppPageMode = "default" | "dip" | "coop" | "joyid";

const getPathname = (pathname?: string): string => {
  if (pathname) {
    return pathname;
  }

  if (typeof window !== "undefined") {
    return window.location.pathname;
  }

  return "/";
};

export const getAppPageMode = (pathname?: string): AppPageMode => {
  const currentPathname = getPathname(pathname);

  if (currentPathname.endsWith("/dip.html")) {
    return "dip";
  }
  if (currentPathname.endsWith("/coop.html")) {
    return "coop";
  }
  if (currentPathname.endsWith("/joyid.html")) {
    return "joyid";
  }
  return "default";
};

export const isJoyIdPageMode = (pathname?: string): boolean => getAppPageMode(pathname) === "joyid";
