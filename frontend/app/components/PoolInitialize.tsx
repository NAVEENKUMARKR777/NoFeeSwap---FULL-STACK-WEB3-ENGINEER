"use client";

import { useState, useCallback } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { encodeFunctionData, keccak256, encodePacked } from "viem";
import { NOFEESWAP_ABI, NOFEESWAP_DELEGATEE_ABI } from "@/lib/abis";
import type { DeployedAddresses } from "@/lib/contracts";
import {
  LOG_PRICE_SPACING_LARGE_X59,
  LOG_PRICE_SPACING_MEDIUM_X59,
  LOG_PRICE_SPACING_SMALL_X59,
} from "@/lib/contracts";
import { TransactionStatus, type TxState } from "./TransactionStatus";
import { KernelEditor } from "./KernelEditor";

const X15 = BigInt(2) ** BigInt(15);   // 32768 = "1.0" in X15
const X59 = BigInt(2) ** BigInt(59);
const X60 = BigInt(2) ** BigInt(60);
const X63 = BigInt(2) ** BigInt(63);
const X256 = BigInt(2) ** BigInt(256);

const FEE_TIERS = [
  { label: "0.05%", spacing: LOG_PRICE_SPACING_SMALL_X59 },
  { label: "0.3%", spacing: LOG_PRICE_SPACING_MEDIUM_X59 },
  { label: "1.0%", spacing: LOG_PRICE_SPACING_LARGE_X59 },
];

/**
 * Encode kernel compact array matching the Python test implementation.
 * SKIPS the first [0,0] point (it's implicit).
 * Each breakpoint = 80 bits: 16-bit height (X15) + 64-bit position (X59).
 */
function encodeKernelCompactCorrect(
  kernel: Array<[bigint, bigint]> // [position, height]
): bigint[] {
  let k = 0n;
  let bits = 0;
  // Skip first element [0, 0]
  for (const [pos, height] of kernel.slice(1)) {
    k = (k << 16n) + height;
    k = (k << 64n) + pos;
    bits += 80;
  }
  if (bits % 256 !== 0) {
    k = k << BigInt(256 - (bits % 256));
    bits += 256 - (bits % 256);
  }
  const count = bits / 256;
  const result: bigint[] = new Array(count).fill(0n);
  for (let j = count - 1; j >= 0; j--) {
    result[j] = k % X256;
    k = k / X256;
  }
  return result;
}

/**
 * Encode curve array: 4 x 64-bit values per uint256.
 */
function encodeCurveCorrect(curve: bigint[]): bigint[] {
  const len = Math.ceil(curve.length / 4);
  const encoded: bigint[] = new Array(len).fill(0n);
  let shift = 192n;
  let index = 0;
  for (const point of curve) {
    encoded[Math.floor(index / 4)] += point << shift;
    shift -= 64n;
    if (shift < 0n) shift = 192n;
    index++;
  }
  return encoded;
}

interface Props {
  addresses: DeployedAddresses;
}

export function PoolInitialize({ addresses }: Props) {
  const { address, isConnected } = useAccount();
  const [feeTier, setFeeTier] = useState(2);
  const [initialPrice, setInitialPrice] = useState("1.0");
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<string>();
  const [txError, setTxError] = useState<string>();
  const [poolId, setPoolId] = useState<string>();
  // Kernel breakpoints: [[position, height], ...] where height is in X15 (0-32768)
  const [kernelBreakpoints, setKernelBreakpoints] = useState<Array<[bigint, bigint]>>([]);

  const { writeContract, isPending } = useWriteContract();

  const handleInitialize = useCallback(async () => {
    if (!isConnected || !address) return;

    try {
      setTxState("pending");
      setTxError(undefined);

      const price = parseFloat(initialPrice);
      if (isNaN(price) || price <= 0) {
        throw new Error("Invalid price");
      }

      const spacing = FEE_TIERS[feeTier].spacing;

      // === Kernel: use custom breakpoints from editor, or default linear ===
      const kernel: Array<[bigint, bigint]> =
        kernelBreakpoints.length >= 2
          ? kernelBreakpoints
          : [
              [0n, 0n],
              [spacing, X15],
            ];
      const kernelCompactArray = encodeKernelCompactCorrect(kernel);

      // === Curve: [qLower, qUpper, qCurrent] ===
      // Use sqrtPriceX96 representation like the protocol tests
      // For a given price p: sqrtPriceX96 = sqrt(p) * 2^96
      const sqrtPrice = Math.sqrt(price);
      const sqrtPriceX96 = sqrtPrice * Number(BigInt(2) ** BigInt(96));

      // logPrice = floor((2^60) * ln(sqrtPriceX96 / 2^96))
      const X96 = Number(BigInt(2) ** BigInt(96));
      const logPrice = BigInt(Math.floor(Number(X60) * Math.log(sqrtPriceX96 / X96)));

      // Offsetted = logPrice + (1 << 63)  (logOffset = 0)
      const logPriceOffsetted = logPrice + X63;

      // Align to spacing grid
      const spacingN = Number(spacing);
      const lpN = Number(logPriceOffsetted);
      const lower = BigInt(Math.floor(lpN / spacingN)) * spacing;
      const upper = lower + spacing;

      // CRITICAL: qCurrent must be strictly between qLower and qUpper
      // If qCurrent == qLower (happens at exact grid boundaries), nudge it
      let qCurrent = logPriceOffsetted;
      if (qCurrent <= lower) {
        qCurrent = lower + 1n;
      }
      if (qCurrent >= upper) {
        qCurrent = upper - 1n;
      }

      const curveArray = encodeCurveCorrect([lower, upper, qCurrent]);

      // === unsaltedPoolId ===
      // Use a unique n value based on timestamp to avoid PoolExists
      // n occupies the top 68 bits (bits 188-255)
      const uniqueN = BigInt(Math.floor(Date.now() / 1000));
      const unsaltedPoolId = (uniqueN << 188n) + (0n << 180n);

      // poolGrowthPortion ~50% in X47
      const poolGrowthPortion = BigInt("0x800000000000");

      // Tags = token addresses
      const tag0 = BigInt(addresses.token0);
      const tag1 = BigInt(addresses.token1);

      // Compute pool ID for display
      const salt = keccak256(
        encodePacked(
          ["address", "uint256"],
          [address as `0x${string}`, unsaltedPoolId]
        )
      );
      const computedPoolId = (unsaltedPoolId + (BigInt(salt) << 188n)) % X256;

      // Encode initialize call for dispatch
      const initializeData = encodeFunctionData({
        abi: NOFEESWAP_DELEGATEE_ABI,
        functionName: "initialize",
        args: [
          unsaltedPoolId,
          tag0,
          tag1,
          poolGrowthPortion,
          kernelCompactArray,
          curveArray,
          "0x",
        ],
      });

      writeContract(
        {
          address: addresses.nofeeswap as `0x${string}`,
          abi: NOFEESWAP_ABI,
          functionName: "dispatch",
          args: [initializeData],
          gas: 29_000_000n,
        },
        {
          onSuccess: (hash) => {
            setTxHash(hash);
            setTxState("confirming");
            setPoolId(computedPoolId.toString());
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
  }, [isConnected, address, initialPrice, feeTier, addresses, kernelBreakpoints, writeContract]);

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
      <h2 className="text-xl font-bold mb-4">Initialize Liquidity Pool</h2>

      <div className="mb-4 p-3 bg-gray-800 rounded-lg">
        <p className="text-sm text-gray-400 mb-1">Token Pair</p>
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 bg-blue-900/50 rounded text-sm font-mono">
            {addresses.token0Symbol}
          </span>
          <span className="text-gray-500">/</span>
          <span className="px-2 py-1 bg-purple-900/50 rounded text-sm font-mono">
            {addresses.token1Symbol}
          </span>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Fee Tier</label>
        <div className="grid grid-cols-3 gap-2">
          {FEE_TIERS.map((tier, i) => (
            <button
              key={i}
              onClick={() => setFeeTier(i)}
              className={`p-3 rounded-lg border text-center transition ${
                feeTier === i
                  ? "border-blue-500 bg-blue-900/30 text-blue-300"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <div className="text-lg font-bold">{tier.label}</div>
              <div className="text-xs mt-1">
                {i === 0 ? "Stables" : i === 1 ? "Standard" : "Exotic"}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">
          Initial Price ({addresses.token1Symbol} per {addresses.token0Symbol})
        </label>
        <input
          type="number"
          value={initialPrice}
          onChange={(e) => setInitialPrice(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-lg font-mono focus:outline-none focus:border-blue-500"
          placeholder="1.0"
          step="0.001"
        />
      </div>

      <KernelEditor
        spacing={FEE_TIERS[feeTier].spacing}
        onChange={setKernelBreakpoints}
      />

      <button
        onClick={handleInitialize}
        disabled={!isConnected || isPending || txState === "confirming"}
        className="w-full py-3 rounded-lg font-semibold text-lg transition disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500"
      >
        {!isConnected
          ? "Connect Wallet"
          : isPending
          ? "Confirm in Wallet..."
          : txState === "confirming"
          ? "Confirming..."
          : "Initialize Pool"}
      </button>

      {poolId && txState === "confirmed" && (
        <div className="mt-3 p-3 bg-green-900/20 border border-green-800 rounded-lg">
          <p className="text-sm text-green-400">Pool created successfully!</p>
          <p className="text-xs text-gray-400 mt-1 font-mono break-all">
            Pool ID: {poolId}
          </p>
        </div>
      )}

      <TransactionStatus
        state={txState}
        hash={txHash}
        error={txError}
        onDismiss={() => setTxState("idle")}
      />
    </div>
  );
}
