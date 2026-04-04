"use client";

import { useState, useCallback, useEffect } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem, formatEther } from "viem";

interface Position {
  poolId: string;
  blockNumber: bigint;
  txHash: string;
  data: readonly `0x${string}`[];
}

interface PositionTrackerProps {
  nofeeswapAddress: string;
  userAddress: string;
}

export function PositionTracker({
  nofeeswapAddress,
  userAddress,
}: PositionTrackerProps) {
  const publicClient = usePublicClient();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const fetchPositions = useCallback(async () => {
    if (!publicClient || !userAddress || !nofeeswapAddress) return;
    setLoading(true);
    setError(undefined);

    try {
      // The ModifyPosition event's "caller" is the Operator (not the user),
      // because the Operator calls modifyPosition inside the unlock callback.
      // We fetch ALL ModifyPosition events, then filter by tx.from === userAddress.
      const logs = await publicClient.getLogs({
        address: nofeeswapAddress as `0x${string}`,
        event: parseAbiItem(
          "event ModifyPosition(uint256 indexed poolId, address indexed caller, bytes32[6] data)"
        ),
        fromBlock: 0n,
        toBlock: "latest",
      });

      // Filter to only txs sent by this user
      const userLogs = [];
      for (const log of logs) {
        try {
          const tx = await publicClient.getTransaction({ hash: log.transactionHash });
          if (tx.from.toLowerCase() === userAddress.toLowerCase()) {
            userLogs.push(log);
          }
        } catch {
          // If we can't fetch the tx, include it anyway
          userLogs.push(log);
        }
      }

      const parsed: Position[] = userLogs.map((log) => ({
        poolId: log.args.poolId?.toString() ?? "unknown",
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        data: (log.args.data ?? []) as readonly `0x${string}`[],
      }));

      setPositions(parsed);
    } catch (err: any) {
      setError(err.message?.slice(0, 100));
    } finally {
      setLoading(false);
    }
  }, [publicClient, userAddress, nofeeswapAddress]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  return (
    <div className="bg-gray-800/50 rounded-lg p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">Your Positions</h3>
        <button
          onClick={fetchPositions}
          disabled={loading}
          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-2">{error}</p>
      )}

      {positions.length === 0 && !loading && (
        <p className="text-xs text-gray-500 text-center py-4">
          No positions found. Add liquidity to see your positions here.
        </p>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <svg className="w-5 h-5 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}

      <div className="space-y-2">
        {positions.map((pos, i) => {
          // Parse data[0] for logPriceMinOffsetted (first 8 bytes) and logPriceMaxOffsetted (next 8 bytes)
          const raw = pos.data[0] ?? "0x";
          const logPriceMinHex = raw.slice(2, 18);
          const logPriceMaxHex = raw.slice(18, 34);
          const logPriceMin = logPriceMinHex ? BigInt("0x" + logPriceMinHex) : 0n;
          const logPriceMax = logPriceMaxHex ? BigInt("0x" + logPriceMaxHex) : 0n;

          // Parse shares from data[1] (bytes32 = int256)
          const sharesHex = pos.data[1] ?? "0x0";
          let shares = BigInt(sharesHex);
          // Two's complement for negative
          if (shares > BigInt(2) ** BigInt(255)) {
            shares = shares - BigInt(2) ** BigInt(256);
          }

          return (
            <div
              key={`${pos.txHash}-${i}`}
              className="bg-gray-800 rounded p-3 border border-gray-700"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono text-gray-400">
                  Pool: {pos.poolId.slice(0, 12)}...
                </span>
                <span className={`text-xs font-medium ${shares > 0n ? "text-green-400" : "text-red-400"}`}>
                  {shares > 0n ? "MINT" : "BURN"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Shares: </span>
                  <span className="font-mono">{formatEther(shares < 0n ? -shares : shares)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Block: </span>
                  <span className="font-mono">{pos.blockNumber.toString()}</span>
                </div>
              </div>
              {/* Visual range bar */}
              <div className="mt-2 h-2 bg-gray-900 rounded-full overflow-hidden relative">
                <div
                  className={`absolute h-full rounded-full ${shares > 0n ? "bg-green-600" : "bg-red-600"}`}
                  style={{
                    left: `${Math.max(0, Number(logPriceMin % 100n))}%`,
                    width: `${Math.max(5, Number((logPriceMax - logPriceMin) % 100n))}%`,
                  }}
                />
              </div>
              <div className="mt-1 text-xs text-gray-600 font-mono truncate">
                tx: {pos.txHash.slice(0, 14)}...
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
