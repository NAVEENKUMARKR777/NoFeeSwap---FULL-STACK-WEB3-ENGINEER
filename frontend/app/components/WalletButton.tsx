"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs px-2 py-1 bg-green-900/40 border border-green-700/50 rounded-lg text-green-400">
          {chain?.name ?? "Unknown"}
        </span>
        <button
          onClick={() => disconnect()}
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition"
        >
          <span className="w-2 h-2 rounded-full bg-green-400" />
          {address.slice(0, 6)}...{address.slice(-4)}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];
        if (injected) connect({ connector: injected });
      }}
      disabled={isPending}
      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition disabled:opacity-50"
    >
      {isPending ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
