"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { polygon } from "wagmi/chains";
import { http } from "viem";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "polymarket-terminal-local";

export const wagmiConfig = getDefaultConfig({
  appName: "Polymarket Terminal",
  projectId,
  chains: [polygon],
  transports: {
    [polygon.id]: http(process.env.NEXT_PUBLIC_POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com"),
  },
  ssr: true,
});
