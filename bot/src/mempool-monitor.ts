import { ethers } from "ethers";
import { BOT_CONFIG } from "./config";
import { decodeSwapTransaction, type DecodedSwap } from "./decoder";

export type SwapHandler = (swap: DecodedSwap) => Promise<void>;

/**
 * Monitors the local node's mempool for pending NoFeeSwap swap transactions.
 *
 * Uses eth_getFilterChanges polling since Anvil/Hardhat may not support
 * WebSocket pending transaction subscriptions reliably.
 */
export class MempoolMonitor {
  private provider: ethers.JsonRpcProvider;
  private nofeeswapAddress: string;
  private operatorAddress: string;
  private handler: SwapHandler;
  private running = false;
  private seenTxs = new Set<string>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    provider: ethers.JsonRpcProvider,
    nofeeswapAddress: string,
    operatorAddress: string,
    handler: SwapHandler
  ) {
    this.provider = provider;
    this.nofeeswapAddress = nofeeswapAddress;
    this.operatorAddress = operatorAddress;
    this.handler = handler;
  }

  async start(): Promise<void> {
    this.running = true;
    console.log("[Mempool] Starting mempool monitor...");
    console.log(`[Mempool] Watching for swaps to: ${this.nofeeswapAddress}`);
    console.log(`[Mempool] Operator: ${this.operatorAddress}`);
    console.log(`[Mempool] Poll interval: ${BOT_CONFIG.POLL_INTERVAL_MS}ms`);

    // Try WebSocket subscription first
    try {
      await this.startWebSocket();
      return;
    } catch (err) {
      console.log("[Mempool] WebSocket not available, falling back to polling");
    }

    // Fallback: poll pending transactions via eth_pendingTransactions or txpool_content
    this.pollInterval = setInterval(async () => {
      if (!this.running) return;
      await this.pollPendingTransactions();
    }, BOT_CONFIG.POLL_INTERVAL_MS);
  }

  private async startWebSocket(): Promise<void> {
    // Try to create a WebSocket provider
    const wsProvider = new ethers.WebSocketProvider(BOT_CONFIG.WS_URL);

    wsProvider.on("pending", async (txHash: string) => {
      if (!this.running || this.seenTxs.has(txHash)) return;
      this.seenTxs.add(txHash);

      try {
        const tx = await this.provider.getTransaction(txHash);
        if (!tx) return;
        await this.processTx(tx);
      } catch (err) {
        // Transaction may have been mined already
      }
    });

    console.log("[Mempool] Listening via WebSocket for pending transactions");
  }

  private async pollPendingTransactions(): Promise<void> {
    try {
      // Use txpool_content (supported by Anvil)
      const txpool: any = await this.provider.send("txpool_content", []);
      const pending = txpool?.pending || {};

      for (const sender of Object.values(pending) as any[]) {
        for (const tx of Object.values(sender) as any[]) {
          const txHash = tx.hash;
          if (this.seenTxs.has(txHash)) continue;
          this.seenTxs.add(txHash);

          const fullTx = await this.provider.getTransaction(txHash);
          if (fullTx) {
            await this.processTx(fullTx);
          }
        }
      }
    } catch {
      // txpool_content not available - silently continue
    }

    // Periodically clean up seen transactions to prevent memory leak
    if (this.seenTxs.size > 10000) {
      this.seenTxs.clear();
    }
  }

  private async processTx(tx: ethers.TransactionResponse): Promise<void> {
    const decoded = decodeSwapTransaction(
      tx,
      this.nofeeswapAddress,
      this.operatorAddress
    );

    if (decoded) {
      console.log(
        `\n[Mempool] Detected swap transaction from ${decoded.victim}`
      );
      console.log(`  TxHash: ${decoded.txHash}`);
      console.log(`  Pool ID: ${decoded.poolId}`);
      console.log(`  Amount: ${decoded.amountSpecified}`);
      console.log(`  ZeroForOne: ${decoded.zeroForOne}`);
      console.log(`  Gas Price: ${decoded.gasPrice}`);

      try {
        await this.handler(decoded);
      } catch (err) {
        console.error("[Mempool] Error in swap handler:", err);
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log("[Mempool] Monitor stopped");
  }
}
