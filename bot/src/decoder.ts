import { ethers } from "ethers";

// Correct unlock selector
const UNLOCK_SELECTOR = "0x738c440a";

// Correct operator action opcodes (DECIMAL, not hex)
const ACTION_PUSH32 = 3;
const ACTION_SWAP = 52;

export interface DecodedSwap {
  poolId: bigint;
  amountSpecified: bigint;
  logPriceLimit: bigint;
  zeroForOne: bigint;
  victim: string;
  gasPrice: bigint;
  nonce: number;
  txHash: string;
  raw: string;
}

/**
 * Attempts to decode a pending transaction as a NoFeeSwap swap.
 */
export function decodeSwapTransaction(
  tx: ethers.TransactionResponse,
  nofeeswapAddress: string,
  operatorAddress: string
): DecodedSwap | null {
  try {
    if (!tx.to || tx.to.toLowerCase() !== nofeeswapAddress.toLowerCase()) {
      return null;
    }

    const data = tx.data;
    if (!data || data.length < 10) return null;

    const selector = data.slice(0, 10).toLowerCase();
    if (selector !== UNLOCK_SELECTOR) return null;

    // Decode unlock(address, bytes)
    const iface = new ethers.Interface([
      "function unlock(address unlockTarget, bytes data) external payable returns (bytes)",
    ]);

    const decoded = iface.decodeFunctionData("unlock", data);
    const unlockTarget = decoded[0] as string;
    const actionData = decoded[1] as string;

    if (unlockTarget.toLowerCase() !== operatorAddress.toLowerCase()) {
      return null;
    }

    // Parse operator action bytecode
    const actionBytes = ethers.getBytes(actionData);
    if (actionBytes.length < 4) return null;

    let offset = 4; // skip deadline (4 bytes)

    // Track slot values from PUSH32 actions
    const slots: Map<number, bigint> = new Map();
    let poolId: bigint | null = null;
    let amountSpecified: bigint | null = null;
    let limitOffsetted: bigint | null = null;
    let zeroForOne: bigint | null = null;

    while (offset < actionBytes.length) {
      const opcode = actionBytes[offset];
      offset++;

      if (opcode === ACTION_PUSH32) {
        // PUSH32 format: [value:32] [slot:1] (value FIRST, slot LAST)
        if (offset + 33 > actionBytes.length) break;
        const value = BigInt(
          "0x" +
            Buffer.from(actionBytes.slice(offset, offset + 32)).toString("hex")
        );
        offset += 32;
        const slot = actionBytes[offset];
        offset++;
        slots.set(slot, value);
      } else if (opcode === ACTION_SWAP) {
        // SWAP format: [poolId:32] [amountSpecifiedSlot:1] [limitOffsetted:8]
        //              [zeroForOne:1] [crossThresholdSlot:1] [successSlot:1]
        //              [amount0Slot:1] [amount1Slot:1] [hookDataLen:2] [hookData]
        if (offset + 46 > actionBytes.length) break;

        poolId = BigInt(
          "0x" +
            Buffer.from(actionBytes.slice(offset, offset + 32)).toString("hex")
        );
        offset += 32;

        const amountSlot = actionBytes[offset];
        offset++;

        limitOffsetted = BigInt(
          "0x" +
            Buffer.from(actionBytes.slice(offset, offset + 8)).toString("hex")
        );
        offset += 8;

        zeroForOne = BigInt(actionBytes[offset]);
        offset++;

        // crossThresholdSlot(1) + successSlot(1) + amount0Slot(1) + amount1Slot(1)
        offset += 4;

        const hookDataLen = (actionBytes[offset] << 8) | actionBytes[offset + 1];
        offset += 2 + hookDataLen;

        amountSpecified = slots.get(amountSlot) ?? null;

        break; // Found swap, stop parsing
      } else {
        // Skip other opcodes
        offset = skipAction(opcode, actionBytes, offset);
        if (offset === -1) break;
      }
    }

    if (poolId === null || amountSpecified === null || limitOffsetted === null || zeroForOne === null) {
      return null;
    }

    // Convert two's complement for signed values
    const TWO_255 = BigInt(1) << BigInt(255);
    const TWO_256 = BigInt(1) << BigInt(256);
    if (amountSpecified >= TWO_255) {
      amountSpecified = amountSpecified - TWO_256;
    }

    // Convert limitOffsetted back to logPriceLimit
    // logPriceLimit = limitOffsetted - (1<<63) + logOffset*(1<<59)
    const X63 = BigInt(1) << BigInt(63);
    const logPriceLimit = BigInt(limitOffsetted) - X63;

    return {
      poolId,
      amountSpecified,
      logPriceLimit,
      zeroForOne,
      victim: tx.from,
      gasPrice: tx.gasPrice ?? tx.maxFeePerGas ?? BigInt(0),
      nonce: tx.nonce,
      txHash: tx.hash,
      raw: tx.data,
    };
  } catch {
    return null;
  }
}

function skipAction(opcode: number, data: Uint8Array, offset: number): number {
  // Known action sizes (bytes AFTER opcode)
  const sizes: Record<number, number> = {
    0: 1,     // PUSH0: slot(1)
    1: 11,    // PUSH10: value(10) + slot(1)
    2: 17,    // PUSH16: value(16) + slot(1)
    4: 2,     // NEG: in(1) + out(1)
    5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3, 11: 3, // arithmetic
    12: 3,    // LTEQ
    13: 3,    // LT
    14: 3,    // EQ
    15: 2,    // ISZERO
    16: 2,    // (also ISZERO in some versions)
    20: 0,    // JUMPDEST
    21: 3,    // JUMP: offset(2) + slot(1)
    37: 43,   // TRANSFER_FROM_PAYER_ERC20: token(20)+slot(1)+to(20)+success(1)+result(1)
    42: 42,   // TAKE_TOKEN: token(20)+to(20)+slot(1)+success(1)
    45: 20,   // SYNC_TOKEN: token(20)
    47: 3,    // SETTLE: value(1)+success(1)+result(1)
    50: 34,   // MODIFY_SINGLE_BALANCE: tag(32)+slot(1)+success(1)
    59: 0,    // REVERT
  };

  if (opcode in sizes) {
    return offset + sizes[opcode];
  }

  // MODIFY_POSITION: poolId(32)+qMin(8)+qMax(8)+shares(1)+success(1)+amt0(1)+amt1(1)+hookLen(2)
  if (opcode === 53) {
    if (offset + 54 > data.length) return -1;
    const hookLen = (data[offset + 52] << 8) | data[offset + 53];
    return offset + 54 + hookLen;
  }

  return -1; // Unknown opcode
}

/**
 * Extract slippage tolerance from decoded swap params.
 */
export function estimateSlippage(decoded: DecodedSwap): {
  slippagePercent: number;
  tradeSize: bigint;
} {
  const tradeSize =
    decoded.amountSpecified < 0n
      ? -decoded.amountSpecified
      : decoded.amountSpecified;

  const TWO_59 = Number(BigInt(2) ** BigInt(59));
  const limitPrice = Math.exp(Number(decoded.logPriceLimit) / TWO_59);
  const slippagePercent = Math.min(Math.abs(1 - limitPrice) * 100, 100);

  return { slippagePercent, tradeSize };
}
