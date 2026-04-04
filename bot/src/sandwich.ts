import { ethers } from "ethers";
import { BOT_CONFIG, type DeployedAddresses } from "./config";
import { type DecodedSwap, estimateSlippage } from "./decoder";

const NOFEESWAP_ABI = [
  "function unlock(address unlockTarget, bytes data) external payable returns (bytes)",
];

// Opcodes (decimal, matching Operator.sol switch-case)
const PUSH32 = 3, NEG = 4, LT = 13, ISZERO = 16, JUMPDEST = 20, JUMP = 21, REVERT = 59;
const TRANSFER_FROM_PAYER_ERC20 = 37, TAKE_TOKEN = 42, SYNC_TOKEN = 45, SETTLE = 47, SWAP = 52;
const X59 = BigInt(2) ** BigInt(59);
const X63 = BigInt(2) ** BigInt(63);
const X64 = BigInt(2) ** BigInt(64);

// Byte helpers
function toBytes(value: bigint | number, length: number): number[] {
  let v = BigInt(value);
  if (v < 0n) v = (1n << BigInt(length * 8)) + v;
  const result: number[] = [];
  for (let i = length - 1; i >= 0; i--) { result[i] = Number(v & 0xFFn); v >>= 8n; }
  return result;
}
function addrBytes(addr: string): number[] { return toBytes(BigInt(addr), 20); }
function cat(...arrays: number[][]): number[] { return arrays.flat(); }
function toHex(bytes: number[]): string {
  return "0x" + bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

export class SandwichExecutor {
  private wallet: ethers.Wallet;
  private provider: ethers.JsonRpcProvider;
  private addresses: DeployedAddresses;
  private nofeeswap: ethers.Contract;

  constructor(
    provider: ethers.JsonRpcProvider,
    wallet: ethers.Wallet,
    addresses: DeployedAddresses
  ) {
    this.provider = provider;
    this.wallet = wallet;
    this.addresses = addresses;
    this.nofeeswap = new ethers.Contract(addresses.nofeeswap, NOFEESWAP_ABI, wallet);
  }

  analyzeProfitability(decoded: DecodedSwap) {
    const { slippagePercent, tradeSize } = estimateSlippage(decoded);
    const extractionFactor = 0.3;
    const estimatedProfit = BigInt(
      Math.floor(Number(tradeSize) * (slippagePercent / 100) * extractionFactor)
    );
    const frontRunAmount = tradeSize / 2n;
    const profitable = estimatedProfit > BOT_CONFIG.MIN_PROFIT_WEI;
    return { profitable, estimatedProfit, frontRunAmount, slippagePercent, tradeSize };
  }

  async executeSandwich(decoded: DecodedSwap) {
    const analysis = this.analyzeProfitability(decoded);

    console.log("\n=== Sandwich Analysis ===");
    console.log(`  Victim: ${decoded.victim}`);
    console.log(`  Trade Size: ${ethers.formatEther(analysis.tradeSize)} tokens`);
    console.log(`  Slippage: ${analysis.slippagePercent.toFixed(2)}%`);
    console.log(`  Est. Profit: ${ethers.formatEther(analysis.estimatedProfit)} tokens`);

    if (!analysis.profitable) {
      console.log("  -> Skipping: Not profitable");
      return null;
    }

    console.log("\n=== Executing Sandwich ===");

    try {
      const nonce = await this.wallet.getNonce("pending");
      const victimGasPrice = decoded.gasPrice;
      const frontRunGasPrice = victimGasPrice * BigInt(BOT_CONFIG.FRONTRUN_GAS_MULTIPLIER);
      const backRunGasPrice = victimGasPrice / BigInt(BOT_CONFIG.BACKRUN_GAS_DIVISOR);

      // Front-run: same direction as victim
      console.log(`\n  [1/3] Front-run: ${ethers.formatEther(analysis.frontRunAmount)} tokens`);
      console.log(`    Gas: ${ethers.formatUnits(frontRunGasPrice, "gwei")} gwei, Nonce: ${nonce}`);

      const frontRunAction = this.buildSwapActionData({
        poolId: decoded.poolId,
        amountSpecified: analysis.frontRunAmount,
        logPriceLimit: decoded.logPriceLimit,
        zeroForOne: Number(decoded.zeroForOne),
        deadline: Math.floor(Date.now() / 1000) + 120,
      });

      const frontRunTx = await this.nofeeswap.unlock(
        this.addresses.operator, frontRunAction,
        { gasPrice: frontRunGasPrice, gasLimit: BOT_CONFIG.MAX_GAS, nonce }
      );
      console.log(`    Tx: ${frontRunTx.hash}`);

      // Victim is already pending
      console.log(`\n  [2/3] Victim: ${decoded.txHash}`);

      // Back-run: opposite direction
      const backRunZeroForOne = decoded.zeroForOne === 1n ? 0 : 1;
      const backRunLimit = backRunZeroForOne === 1
        ? BigInt(Math.floor(Math.log(0.0001) * Number(X59)))
        : BigInt(Math.floor(Math.log(10000) * Number(X59)));

      console.log(`\n  [3/3] Back-run (reverse direction)`);
      console.log(`    Gas: ${ethers.formatUnits(backRunGasPrice > 0n ? backRunGasPrice : 1n, "gwei")} gwei, Nonce: ${nonce + 1}`);

      const backRunAction = this.buildSwapActionData({
        poolId: decoded.poolId,
        amountSpecified: analysis.frontRunAmount,
        logPriceLimit: backRunLimit,
        zeroForOne: backRunZeroForOne,
        deadline: Math.floor(Date.now() / 1000) + 120,
      });

      const backRunTx = await this.nofeeswap.unlock(
        this.addresses.operator, backRunAction,
        { gasPrice: backRunGasPrice > 0n ? backRunGasPrice : 1n, gasLimit: BOT_CONFIG.MAX_GAS, nonce: nonce + 1 }
      );
      console.log(`    Tx: ${backRunTx.hash}`);

      console.log("\n  Waiting for mining...");
      const fr = await frontRunTx.wait();
      console.log(`  Front-run: ${fr?.status === 1 ? "SUCCESS" : "FAILED"}`);
      const br = await backRunTx.wait();
      console.log(`  Back-run: ${br?.status === 1 ? "SUCCESS" : "FAILED"}`);

      return { frontRunHash: frontRunTx.hash, backRunHash: backRunTx.hash, profit: analysis.estimatedProfit };
    } catch (err: any) {
      console.error("\n  Sandwich failed:", err.message?.slice(0, 200));
      return null;
    }
  }

  /**
   * Build swap action data matching the Python swapSequence exactly.
   * Uses correct opcodes, PUSH32 byte order, JUMP placeholders, and conditional logic.
   */
  private buildSwapActionData(params: {
    poolId: bigint;
    amountSpecified: bigint;
    logPriceLimit: bigint; // non-offsetted X59
    zeroForOne: number;
    deadline: number;
  }): string {
    const { poolId, amountSpecified, logPriceLimit, zeroForOne, deadline } = params;
    const payer = this.wallet.address;
    const nofeeswapAddr = this.addresses.nofeeswap;
    const token0 = this.addresses.token0;
    const token1 = this.addresses.token1;

    // Slot assignments
    const successSlot = 2, amt0Slot = 3, amt1Slot = 4;
    const sTr0 = 7, sTr1 = 8;
    const vS0 = 9, sS0 = 10, rS0 = 11;
    const vS1 = 12, sS1 = 13, rS1 = 14;
    const amtSpecSlot = 15, zeroSlot = 100, logicSlot = 200;

    // Compute limitOffsetted
    const logOffset = Number((poolId >> 180n) % 256n);
    const signedLogOffset = logOffset >= 128 ? logOffset - 256 : logOffset;
    let limitOff = logPriceLimit + X63 - BigInt(signedLogOffset) * X59;
    if (limitOff < 0n) limitOff = 0n;
    if (limitOff >= X64) limitOff = X64 - 1n;

    // Build sequence with placeholder JUMPs (4 bytes each)
    const s: number[][] = Array.from({ length: 27 }, () => []);

    s[0] = cat([PUSH32], toBytes(amountSpecified, 32), [amtSpecSlot]);
    s[1] = cat([SWAP], toBytes(poolId, 32), [amtSpecSlot], toBytes(limitOff, 8),
      [zeroForOne], [zeroSlot], [successSlot], [amt0Slot], [amt1Slot], toBytes(0, 2));
    s[2] = [0, 0, 0, 0]; // placeholder
    s[3] = [REVERT];
    s[4] = [JUMPDEST];
    s[2] = cat([JUMP], toBytes(s.slice(0, 4).flat().length, 2), [successSlot]);

    s[5] = [LT, zeroSlot, amt0Slot, logicSlot];
    s[6] = [0, 0, 0, 0];
    s[7] = [NEG, amt0Slot, amt0Slot];
    s[8] = cat([TAKE_TOKEN], addrBytes(token0), addrBytes(payer), [amt0Slot], [sS0]);
    s[9] = [JUMPDEST];
    s[6] = cat([JUMP], toBytes(s.slice(0, 9).flat().length, 2), [logicSlot]);

    s[10] = [ISZERO, logicSlot, logicSlot];
    s[11] = [0, 0, 0, 0];
    s[12] = cat([SYNC_TOKEN], addrBytes(token0));
    s[13] = cat([TRANSFER_FROM_PAYER_ERC20], addrBytes(token0), [amt0Slot], addrBytes(nofeeswapAddr), [sTr0], [0]);
    s[14] = [SETTLE, vS0, sS0, rS0];
    s[15] = [JUMPDEST];
    s[11] = cat([JUMP], toBytes(s.slice(0, 15).flat().length, 2), [logicSlot]);

    s[16] = [LT, zeroSlot, amt1Slot, logicSlot];
    s[17] = [0, 0, 0, 0];
    s[18] = [NEG, amt1Slot, amt1Slot];
    s[19] = cat([TAKE_TOKEN], addrBytes(token1), addrBytes(payer), [amt1Slot], [sS1]);
    s[20] = [JUMPDEST];
    s[17] = cat([JUMP], toBytes(s.slice(0, 20).flat().length, 2), [logicSlot]);

    s[21] = [ISZERO, logicSlot, logicSlot];
    s[22] = [0, 0, 0, 0];
    s[23] = cat([SYNC_TOKEN], addrBytes(token1));
    s[24] = cat([TRANSFER_FROM_PAYER_ERC20], addrBytes(token1), [amt1Slot], addrBytes(nofeeswapAddr), [sTr1], [0]);
    s[25] = [SETTLE, vS1, sS1, rS1];
    s[26] = [JUMPDEST];
    s[22] = cat([JUMP], toBytes(s.slice(0, 26).flat().length, 2), [logicSlot]);

    return toHex(cat(toBytes(deadline, 4), ...s));
  }
}
