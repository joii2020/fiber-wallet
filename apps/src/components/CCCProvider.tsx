import { ccc } from "@ckb-ccc/connector-react";
import type { CSSProperties, ReactNode } from "react";

type CCCProviderProps = {
  children: ReactNode;
};

export function CCCProvider({ children }: CCCProviderProps) {
  return (
    <ccc.Provider
      connectorProps={{
        style: {
          "--background": "#232323",
          "--divider": "rgba(255, 255, 255, 0.1)",
          "--btn-primary": "#2D2F2F",
          "--btn-primary-hover": "#515151",
          "--btn-secondary": "#2D2F2F",
          "--btn-secondary-hover": "#515151",
          "--icon-primary": "#FFFFFF",
          "--icon-secondary": "rgba(255, 255, 255, 0.6)",
          color: "#ffffff",
          "--tip-color": "#666",
        } as CSSProperties,
      }}
      defaultClient={new ccc.ClientPublicTestnet()}
      clientOptions={[
        {
          name: "CKB Testnet",
          client: new ccc.ClientPublicTestnet(),
        },
        // {
        //   name: "CKB Mainnet",
        //   client: new ccc.ClientPublicMainnet(),
        // },
      ]}
    >
      {children}
    </ccc.Provider>
  );
}
