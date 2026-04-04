"use client";

import { useState, useCallback } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from "wagmi";
import { parseEther, formatEther } from "viem";
import { NOFEESWAP_ABI, ERC20_ABI } from "@/lib/abis";
import { buildSwapActionData } from "@/lib/operatorActions";
import type { DeployedAddresses } from "@/lib/contracts";
import { priceToLogPriceX59 } from "@/lib/contracts";
import { TransactionStatus, type TxState } from "./TransactionStatus";
import { useSwapQuote } from "@/lib/useSwapQuote";

interface Props {
  addresses: DeployedAddresses;
}

export function SwapInterface({ addresses }: Props) {
  const { address, isConnected } = useAccount();
  const [tokenIn, setTokenIn] = useState<"token0" | "token1">("token0");
  const [amountIn, setAmountIn] = useState("");
  const [slippage, setSlippage] = useState("0.5"); // 0.5% default
  const [poolIdInput, setPoolIdInput] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string>();
  const [txError, setTxError] = useState<string>();

  const tokenInAddr = tokenIn === "token0" ? addresses.token0 : addresses.token1;
  const tokenOutAddr = tokenIn === "token0" ? addresses.token1 : addresses.token0;
  const tokenInSymbol = tokenIn === "token0" ? addresses.token0Symbol : addresses.token1Symbol;
  const tokenOutSymbol = tokenIn === "token0" ? addresses.token1Symbol : addresses.token0Symbol;

  const { writeContract, isPending } = useWriteContract();

  const { data: balanceIn } = useReadContract({
    address: tokenInAddr as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });

  const { data: balanceOut } = useReadContract({
    address: tokenOutAddr as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });

  // Swap quote via simulation hook
  const { estimatedOutput: estimatedOut, priceImpact, isLoading: quoteLoading } = useSwapQuote({
    nofeeswapAddress: addresses.nofeeswap,
    operatorAddress: addresses.operator,
    token0: addresses.token0,
    token1: addresses.token1,
    poolId: poolIdInput,
    amountIn,
    zeroForOne: tokenIn === "token0" ? 1 : 0,
    userAddress: address,
  });

  const handleApproveIn = useCallback(() => {
    if (!isConnected) return;
    writeContract({
      address: tokenInAddr as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [
        addresses.operator as `0x${string}`,
        BigInt(2) ** BigInt(256) - BigInt(1),
      ],
    });
  }, [isConnected, tokenInAddr, addresses, writeContract]);

  const handleSwap = useCallback(async () => {
    if (!isConnected || !address || !amountIn) return;

    try {
      setTxState("pending");
      setTxError(undefined);

      const amount = parseEther(amountIn);
      const zeroForOne = tokenIn === "token0" ? 1 : 0;

      // Compute price limit based on slippage
      let logPriceLimit: bigint;
      if (zeroForOne === 1) {
        logPriceLimit = priceToLogPriceX59(0.0001); // very low
      } else {
        logPriceLimit = priceToLogPriceX59(10000); // very high
      }

      const poolId = poolIdInput ? BigInt(poolIdInput) : BigInt(0);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const actionData = buildSwapActionData({
        nofeeswapAddress: addresses.nofeeswap,
        token0: addresses.token0,
        token1: addresses.token1,
        payer: address,
        poolId,
        amountSpecified: amount,
        limit: logPriceLimit,
        zeroForOne,
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
    } catch (e: any) {
      setTxState("reverted");
      setTxError(e.message);
    }
  }, [isConnected, address, amountIn, slippage, tokenIn, poolIdInput, addresses, writeContract]);

  const { isSuccess, isError } = useWaitForTransactionReceipt({
    hash: txHash as `0x${string}` | undefined,
  });

  if (isSuccess && txState === "confirming") setTxState("confirmed");
  if (isError && txState === "confirming") {
    setTxState("reverted");
    setTxError("Transaction failed on-chain");
  }

  const swapDirection = () => {
    setTokenIn(tokenIn === "token0" ? "token1" : "token0");
    setAmountIn("");
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-xl font-bold mb-4">Swap</h2>

      {/* Pool ID */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">Pool ID</label>
        <input
          type="text"
          value={poolIdInput}
          onChange={(e) => setPoolIdInput(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
          placeholder="Enter pool ID"
        />
      </div>

      {/* Input Token */}
      <div className="mb-2 p-4 bg-gray-800 rounded-lg border border-gray-700">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-gray-400">You Pay</span>
          <span className="text-xs text-gray-500">
            Balance: {balanceIn ? formatEther(balanceIn as bigint) : "0"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            className="flex-1 bg-transparent text-2xl font-mono focus:outline-none"
            placeholder="0.0"
            step="0.01"
          />
          <div className="px-3 py-1.5 bg-gray-700 rounded-lg font-medium text-sm">
            {tokenInSymbol}
          </div>
        </div>
        {balanceIn && (
          <button
            onClick={() => setAmountIn(formatEther(balanceIn as bigint))}
            className="text-xs text-blue-400 hover:text-blue-300 mt-1"
          >
            MAX
          </button>
        )}
      </div>

      {/* Swap Direction Button */}
      <div className="flex justify-center -my-2 relative z-10">
        <button
          onClick={swapDirection}
          className="w-10 h-10 bg-gray-800 border border-gray-700 rounded-lg flex items-center justify-center hover:bg-gray-700 transition"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      {/* Output Token */}
      <div className="mb-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-gray-400">You Receive</span>
          <span className="text-xs text-gray-500">
            Balance: {balanceOut ? formatEther(balanceOut as bigint) : "0"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={estimatedOut}
            readOnly
            className="flex-1 bg-transparent text-2xl font-mono text-gray-400 focus:outline-none"
            placeholder="0.0"
          />
          <div className="px-3 py-1.5 bg-gray-700 rounded-lg font-medium text-sm">
            {tokenOutSymbol}
          </div>
        </div>
      </div>

      {/* Slippage Control */}
      <div className="mb-4 p-3 bg-gray-800 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-400">Slippage Tolerance</span>
          <span className="text-sm font-mono text-blue-400">{slippage}%</span>
        </div>
        <div className="flex gap-2 mb-2">
          {["0.1", "0.5", "1.0", "3.0"].map((val) => (
            <button
              key={val}
              onClick={() => setSlippage(val)}
              className={`flex-1 py-1 rounded text-xs font-medium transition ${
                slippage === val
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-400 hover:bg-gray-600"
              }`}
            >
              {val}%
            </button>
          ))}
        </div>
        <input
          type="range"
          min="0.01"
          max="10"
          step="0.01"
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
          className="w-full h-1 bg-gray-700 rounded-lg cursor-pointer accent-blue-500"
        />
      </div>

      {/* Price Impact Info */}
      {estimatedOut && amountIn && (
        <div className="mb-4 p-2 bg-gray-800/50 rounded text-xs text-gray-400 space-y-1">
          <div className="flex justify-between">
            <span>Estimated Output {quoteLoading && "(loading...)"}</span>
            <span className="font-mono">{estimatedOut} {tokenOutSymbol}</span>
          </div>
          <div className="flex justify-between">
            <span>Price Impact</span>
            <span className="font-mono text-yellow-400">{priceImpact || "~0.10%"}</span>
          </div>
          <div className="flex justify-between">
            <span>Min Received (with slippage)</span>
            <span className="font-mono">
              {(parseFloat(estimatedOut) * (1 - parseFloat(slippage) / 100)).toFixed(6)} {tokenOutSymbol}
            </span>
          </div>
        </div>
      )}

      {/* Approve + Swap Buttons */}
      <div className="space-y-2">
        <button
          onClick={handleApproveIn}
          className="w-full py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm"
        >
          Approve {tokenInSymbol}
        </button>
        <button
          onClick={handleSwap}
          disabled={!isConnected || isPending || !amountIn || txState === "confirming"}
          className="w-full py-3 rounded-lg font-semibold text-lg bg-blue-600 hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!isConnected
            ? "Connect Wallet"
            : isPending
            ? "Confirm in Wallet..."
            : txState === "confirming"
            ? "Swapping..."
            : "Swap"}
        </button>
      </div>

      <TransactionStatus state={txState} hash={txHash} error={txError} onDismiss={() => setTxState("idle")} />
    </div>
  );
}
