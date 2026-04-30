export type AppPageMode = "default" | "dip" | "coop" /* | "joyid" */;

export type RuntimeCapabilities = {
  pageMode: AppPageMode;
  joyIdOnly: boolean;
};

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
  // if (currentPathname.endsWith("/joyid.html")) {
  //   return "joyid";
  // }
  return "default";
};

export const getRuntimeCapabilities = (pathname?: string): RuntimeCapabilities => {
  const pageMode = getAppPageMode(pathname);
  return {
    pageMode,
    joyIdOnly: false // pageMode === "joyid" — temporarily disabled
  };
};

export const isJoyIdPageMode = (pathname?: string): boolean =>
  getRuntimeCapabilities(pathname).joyIdOnly;
