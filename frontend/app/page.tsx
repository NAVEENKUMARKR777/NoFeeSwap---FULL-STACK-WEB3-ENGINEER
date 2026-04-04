"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { WalletButton } from "./components/WalletButton";
import { PoolInitialize } from "./components/PoolInitialize";
import { LiquidityManager } from "./components/LiquidityManager";
import { SwapInterface } from "./components/SwapInterface";
import { AddressConfig } from "./components/AddressConfig";
import { DEFAULT_ADDRESSES, type DeployedAddresses } from "@/lib/contracts";

type Tab = "swap" | "pool" | "liquidity";

export default function Home() {
  const { isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<Tab>("swap");
  const [addresses, setAddresses] = useState<DeployedAddresses>(DEFAULT_ADDRESSES);

  const handleAddressUpdate = useCallback((addr: DeployedAddresses) => {
    setAddresses(addr);
  }, []);

  const isConfigured = addresses.nofeeswap !== "0x0000000000000000000000000000000000000000";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              NoFeeSwap
            </h1>
            <span className="text-xs px-2 py-0.5 bg-gray-800 rounded-full text-gray-400">
              Local Dev
            </span>
          </div>

          <nav className="flex items-center gap-1 bg-gray-900 rounded-lg p-1">
            {(["swap", "pool", "liquidity"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                  activeTab === tab
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tab === "swap" ? "Swap" : tab === "pool" ? "New Pool" : "Liquidity"}
              </button>
            ))}
          </nav>

          <WalletButton />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-lg space-y-4">
          {/* Address Configuration */}
          {!isConfigured && (
            <AddressConfig onUpdate={handleAddressUpdate} />
          )}

          {/* Connection Status */}
          {!isConnected && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
              <p className="text-gray-400 mb-4">Connect your wallet to get started</p>
              <WalletButton />
            </div>
          )}

          {/* Tab Content */}
          {isConnected && isConfigured && (
            <>
              {activeTab === "swap" && <SwapInterface addresses={addresses} />}
              {activeTab === "pool" && <PoolInitialize addresses={addresses} />}
              {activeTab === "liquidity" && <LiquidityManager addresses={addresses} />}
            </>
          )}

          {isConnected && !isConfigured && (
            <div className="bg-gray-900 border border-yellow-800/50 rounded-xl p-6 text-center">
              <p className="text-yellow-400 text-sm">
                Load contract addresses above to interact with the protocol.
                Run the deployment script first.
              </p>
            </div>
          )}

          {/* Footer Info */}
          <div className="text-center space-y-1">
            <AddressConfig onUpdate={handleAddressUpdate} />
            {isConfigured && (
              <div className="text-xs text-gray-600 space-y-0.5">
                <p>Nofeeswap: {addresses.nofeeswap.slice(0, 10)}...</p>
                <p>Operator: {addresses.operator.slice(0, 10)}...</p>
                <p>
                  Tokens: {addresses.token0Symbol} ({addresses.token0.slice(0, 10)}...) / {addresses.token1Symbol} ({addresses.token1.slice(0, 10)}...)
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
