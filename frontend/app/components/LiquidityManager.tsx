"use client";

import { useState, useCallback } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from "wagmi";
import { formatEther, keccak256, encodeAbiParameters } from "viem";
import { NOFEESWAP_ABI, ERC20_ABI } from "@/lib/abis";
import { buildMintActionData, buildBurnActionData } from "@/lib/operatorActions";
import type { DeployedAddresses } from "@/lib/contracts";
import {
  LOG_PRICE_SPACING_LARGE_X59,
  LOG_PRICE_SPACING_MEDIUM_X59,
  LOG_PRICE_SPACING_SMALL_X59,
} from "@/lib/contracts";

const FEE_TIERS = [
  { label: "0.05%", spacing: LOG_PRICE_SPACING_SMALL_X59 },
  { label: "0.3%", spacing: LOG_PRICE_SPACING_MEDIUM_X59 },
  { label: "1.0%", spacing: LOG_PRICE_SPACING_LARGE_X59 },
];
import { TransactionStatus, type TxState } from "./TransactionStatus";
import { PositionTracker } from "./PositionTracker";

interface Props {
  addresses: DeployedAddresses;
}

export function LiquidityManager({ addresses }: Props) {
  const { address, isConnected } = useAccount();
  const [mode, setMode] = useState<"mint" | "burn">("mint");
  const [shares, setShares] = useState("1000");
  const [priceMin, setPriceMin] = useState("0.5");
  const [priceMax, setPriceMax] = useState("2.0");
  const [poolIdInput, setPoolIdInput] = useState("");
  const [feeTier, setFeeTier] = useState(2); // 0=0.05%, 1=0.3%, 2=1%
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string>();
  const [txError, setTxError] = useState<string>();

  const { writeContract, isPending } = useWriteContract();

  // Read token balances
  const { data: balance0 } = useReadContract({
    address: addresses.token0 as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });

  const { data: balance1 } = useReadContract({
    address: addresses.token1 as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });

  const handleSetOperator = useCallback(() => {
    if (!isConnected) return;
    writeContract({
      address: addresses.nofeeswap as `0x${string}`,
      abi: NOFEESWAP_ABI,
      functionName: "setOperator",
      args: [addresses.operator as `0x${string}`, true],
    });
  }, [isConnected, addresses, writeContract]);

  const handleApprove = useCallback(
    async (tokenAddr: string) => {
      if (!isConnected) return;
      writeContract({
        address: tokenAddr as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [
          addresses.operator as `0x${string}`,
          BigInt(2) ** BigInt(256) - BigInt(1),
        ],
      });
    },
    [isConnected, addresses, writeContract]
  );

  const handleMintBurn = useCallback(async () => {
    if (!isConnected || !address) return;

    try {
      setTxState("pending");
      setTxError(undefined);

      const pMin = parseFloat(priceMin);
      const pMax = parseFloat(priceMax);
      const sharesAmount = BigInt(shares);

      if (isNaN(pMin) || isNaN(pMax) || pMin >= pMax || sharesAmount <= 0n) {
        throw new Error("Invalid parameters");
      }

      const poolId = poolIdInput ? BigInt(poolIdInput) : BigInt(0);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // Compute offsetted log prices for modifyPosition
      // CRITICAL: qMin and qMax must be aligned to the pool's spacing grid
      const X59 = BigInt(2) ** BigInt(59);
      const X63 = BigInt(2) ** BigInt(63);
      const spacing = FEE_TIERS[feeTier].spacing;
      const logOffset = Number((poolId >> 180n) % 256n);
      const signedLogOffset = logOffset >= 128 ? logOffset - 256 : logOffset;

      // Raw offsetted log prices
      const rawQMin = BigInt(Math.floor(Math.log(pMin) * Number(X59))) + X63 - BigInt(signedLogOffset) * X59;
      const rawQMax = BigInt(Math.floor(Math.log(pMax) * Number(X59))) + X63 - BigInt(signedLogOffset) * X59;

      // Snap to spacing grid (floor for min, ceil for max)
      const qMinOffsetted = (rawQMin / spacing) * spacing;
      const qMaxOffsetted = ((rawQMax / spacing) + 1n) * spacing;

      // Non-offsetted values for tagShares computation
      const qMinNonOffset = qMinOffsetted - X63 + BigInt(signedLogOffset) * X59;
      const qMaxNonOffset = qMaxOffsetted - X63 + BigInt(signedLogOffset) * X59;
      const tagShares = BigInt(keccak256(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "int256" }, { type: "int256" }],
          [poolId, qMinNonOffset, qMaxNonOffset]
        )
      ));

      if (mode === "mint") {
        const actionData = buildMintActionData({
          nofeeswapAddress: addresses.nofeeswap,
          token0: addresses.token0,
          token1: addresses.token1,
          payer: address,
          poolId,
          qMinOffsetted,
          qMaxOffsetted,
          shares: sharesAmount,
          tagShares,
          deadline,
        });

        writeContract(
          {
            address: addresses.nofeeswap as `0x${string}`,
            abi: NOFEESWAP_ABI,
            functionName: "unlock",
            args: [addresses.operator as `0x${string}`, actionData],
            gas: 29_000_000n,
          },
          {
            onSuccess: (hash) => {
              setTxHash(hash);
              setTxState("confirming");
            },
            onError: (err) => {
              setTxState("reverted");
              setTxError(err.message.slice(0, 200));
            },
          }
        );
      } else {
        const actionData = buildBurnActionData({
          nofeeswapAddress: addresses.nofeeswap,
          token0: addresses.token0,
          token1: addresses.token1,
          recipient: address,
          poolId,
          qMinOffsetted,
          qMaxOffsetted,
          shares: sharesAmount,
          tagShares,
          deadline,
        });

        writeContract(
          {
            address: addresses.nofeeswap as `0x${string}`,
            abi: NOFEESWAP_ABI,
            functionName: "unlock",
            args: [addresses.operator as `0x${string}`, actionData],
            gas: 29_000_000n,
          },
          {
            onSuccess: (hash) => {
              setTxHash(hash);
              setTxState("confirming");
            },
            onError: (err) => {
              setTxState("reverted");
              setTxError(err.message.slice(0, 200));
            },
          }
        );
      }
    } catch (e: any) {
      setTxState("reverted");
      setTxError(e.message);
    }
  }, [isConnected, address, mode, shares, priceMin, priceMax, poolIdInput, addresses, writeContract]);

  const { isSuccess, isError } = useWaitForTransactionReceipt({
    hash: txHash as `0x${string}` | undefined,
  });

  if (isSuccess && txState === "confirming") setTxState("confirmed");
  if (isError && txState === "confirming") {
    setTxState("reverted");
    setTxError("Transaction failed on-chain");
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-xl font-bold mb-4">Manage Liquidity</h2>

      {/* Mode Toggle */}
      <div className="flex mb-4 bg-gray-800 rounded-lg p-1">
        <button
          onClick={() => setMode("mint")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
            mode === "mint"
              ? "bg-green-600 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Add Liquidity (Mint)
        </button>
        <button
          onClick={() => setMode("burn")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
            mode === "burn"
              ? "bg-red-600 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Remove Liquidity (Burn)
        </button>
      </div>

      {/* Balances */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="p-2 bg-gray-800 rounded">
          <p className="text-xs text-gray-400">{addresses.token0Symbol} Balance</p>
          <p className="font-mono text-sm">
            {balance0 ? formatEther(balance0 as bigint) : "0"}
          </p>
        </div>
        <div className="p-2 bg-gray-800 rounded">
          <p className="text-xs text-gray-400">{addresses.token1Symbol} Balance</p>
          <p className="font-mono text-sm">
            {balance1 ? formatEther(balance1 as bigint) : "0"}
          </p>
        </div>
      </div>

      {/* Pool ID */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">Pool ID</label>
        <input
          type="text"
          value={poolIdInput}
          onChange={(e) => setPoolIdInput(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
          placeholder="Enter pool ID from initialization"
        />
      </div>

      {/* Fee Tier (must match the pool's fee tier) */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Pool Fee Tier (must match pool)</label>
        <div className="grid grid-cols-3 gap-2">
          {FEE_TIERS.map((tier, i) => (
            <button
              key={i}
              onClick={() => setFeeTier(i)}
              className={`py-2 rounded-lg border text-center text-sm transition ${
                feeTier === i
                  ? "border-blue-500 bg-blue-900/30 text-blue-300"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              {tier.label}
            </button>
          ))}
        </div>
      </div>

      {/* Price Range */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Price Range</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Min Price</label>
            <input
              type="number"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
              step="0.01"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Max Price</label>
            <input
              type="number"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
              step="0.01"
            />
          </div>
        </div>

        {/* Price Range Visualization */}
        <div className="mt-2 h-16 bg-gray-800 rounded border border-gray-700 relative overflow-hidden">
          <svg viewBox="0 0 300 50" className="w-full h-full">
            {/* Background grid */}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <line key={i} x1={i * 60} y1="0" x2={i * 60} y2="50" stroke="#374151" strokeWidth="0.5" />
            ))}
            {/* Liquidity bar */}
            <rect
              x={Math.max(0, (parseFloat(priceMin) / 4) * 300)}
              y="5"
              width={Math.max(10, ((parseFloat(priceMax) - parseFloat(priceMin)) / 4) * 300)}
              height="40"
              fill={mode === "mint" ? "#22c55e" : "#ef4444"}
              opacity="0.3"
              rx="3"
            />
            <rect
              x={Math.max(0, (parseFloat(priceMin) / 4) * 300)}
              y="5"
              width={Math.max(10, ((parseFloat(priceMax) - parseFloat(priceMin)) / 4) * 300)}
              height="40"
              stroke={mode === "mint" ? "#22c55e" : "#ef4444"}
              strokeWidth="1"
              fill="none"
              rx="3"
            />
          </svg>
        </div>
      </div>

      {/* Shares */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">
          Shares {mode === "mint" ? "to Mint" : "to Burn"}
        </label>
        <input
          type="number"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
          min="1"
        />
      </div>

      {/* Approve Buttons */}
      {mode === "mint" && (
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => handleApprove(addresses.token0)}
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm"
          >
            Approve {addresses.token0Symbol}
          </button>
          <button
            onClick={() => handleApprove(addresses.token1)}
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm"
          >
            Approve {addresses.token1Symbol}
          </button>
        </div>
      )}
      {mode === "burn" && (
        <div className="mb-4">
          <button
            onClick={handleSetOperator}
            className="w-full py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm"
          >
            Approve Operator (required for burn)
          </button>
          <p className="text-xs text-gray-500 mt-1">
            Grants the Operator permission to decrement your ERC-6909 share balance
          </p>
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={handleMintBurn}
        disabled={!isConnected || isPending || txState === "confirming"}
        className={`w-full py-3 rounded-lg font-semibold text-lg transition disabled:opacity-50 disabled:cursor-not-allowed ${
          mode === "mint"
            ? "bg-green-600 hover:bg-green-500"
            : "bg-red-600 hover:bg-red-500"
        }`}
      >
        {!isConnected
          ? "Connect Wallet"
          : isPending
          ? "Confirm in Wallet..."
          : mode === "mint"
          ? "Add Liquidity"
          : "Remove Liquidity"}
      </button>

      <TransactionStatus state={txState} hash={txHash} error={txError} onDismiss={() => setTxState("idle")} />

      {/* Position Tracker */}
      {isConnected && address && (
        <PositionTracker
          nofeeswapAddress={addresses.nofeeswap}
          userAddress={address}
        />
      )}
    </div>
  );
}
