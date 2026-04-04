"use client";

import { http, createConfig } from "wagmi";
import { hardhat } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Local Hardhat/Anvil chain definition
const localChain = {
  ...hardhat,
  id: 31337,
  name: "Localhost",
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
} as const;

export const config = createConfig({
  chains: [localChain],
  connectors: [injected()],
  transports: {
    [localChain.id]: http("http://127.0.0.1:8545"),
  },
  ssr: true,
});

export { localChain };
