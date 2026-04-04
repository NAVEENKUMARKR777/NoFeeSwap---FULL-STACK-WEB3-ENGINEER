import { ethers } from "ethers";

// Function selectors for NoFeeSwap operations
const UNLOCK_SELECTOR = "0x6198e339"; // unlock(address,bytes)
const SWAP_SELECTOR = "0x32269698"; // swap(uint256,int256,int256,uint256,bytes)

// Operator action opcodes
const ACTION_PUSH32 = 0x03;
const ACTION_SWAP = 0x10;

export interface DecodedSwap {
  poolId: bigint;
  amountSpecified: bigint;
  logPriceLimit: bigint;
  zeroForOne: bigint;
  victim: string;
  gasPrice: bigint;
  nonce: number;
  txHash: string;
  raw: string; // raw transaction for rebroadcast
}

/**
 * Attempts to decode a pending transaction as a NoFeeSwap swap.
 * Returns the decoded swap parameters if successful, null otherwise.
 */
export function decodeSwapTransaction(
  tx: ethers.TransactionResponse,
  nofeeswapAddress: string,
  operatorAddress: string
): DecodedSwap | null {
  try {
    // Check if the transaction is to the Nofeeswap contract
    if (!tx.to || tx.to.toLowerCase() !== nofeeswapAddress.toLowerCase()) {
      return null;
    }

    const data = tx.data;
    if (!data || data.length < 10) return null;

    const selector = data.slice(0, 10).toLowerCase();

    // Check if it's an unlock call
    if (selector !== UNLOCK_SELECTOR) return null;

    // Decode unlock(address unlockTarget, bytes data)
    const iface = new ethers.Interface([
      "function unlock(address unlockTarget, bytes data) external payable returns (bytes)",
    ]);

    const decoded = iface.decodeFunctionData("unlock", data);
    const unlockTarget = decoded[0] as string;
    const actionData = decoded[1] as string;

    // Verify the unlock target is the Operator contract
    if (unlockTarget.toLowerCase() !== operatorAddress.toLowerCase()) {
      return null;
    }

    // Parse the operator action data to find SWAP actions
    // The action data format:
    // - 4 bytes: deadline
    // - Then a series of actions
    const actionBytes = ethers.getBytes(actionData);
    if (actionBytes.length < 4) return null;

    let offset = 4; // skip deadline
    let poolId: bigint | null = null;
    let amountSpecified: bigint | null = null;
    let logPriceLimit: bigint | null = null;
    let zeroForOne: bigint | null = null;

    // Track slot values
    const slots: Map<number, bigint> = new Map();

    while (offset < actionBytes.length) {
      const opcode = actionBytes[offset];
      offset++;

      if (opcode === ACTION_PUSH32) {
        // PUSH32: 1 byte slot + 32 bytes value
        if (offset + 33 > actionBytes.length) break;
        const slot = actionBytes[offset];
        offset++;
        const value = BigInt(
          "0x" +
            Buffer.from(actionBytes.slice(offset, offset + 32)).toString("hex")
        );
        slots.set(slot, value);
        offset += 32;
      } else if (opcode === ACTION_SWAP) {
        // SWAP: poolIdSlot(1), amountSlot(1), limitSlot(1), zeroForOneSlot(1),
        //       amount0OutSlot(1), amount1OutSlot(1), hookDataLen(2)
        if (offset + 8 > actionBytes.length) break;
        const poolIdSlot = actionBytes[offset];
        const amountSlot = actionBytes[offset + 1];
        const limitSlot = actionBytes[offset + 2];
        const zeroForOneSlot = actionBytes[offset + 3];
        // skip output slots (2 bytes) and read hookData length
        const hookDataLen = (actionBytes[offset + 6] << 8) | actionBytes[offset + 7];
        offset += 8 + hookDataLen;

        poolId = slots.get(poolIdSlot) ?? null;
        amountSpecified = slots.get(amountSlot) ?? null;
        logPriceLimit = slots.get(limitSlot) ?? null;
        zeroForOne = slots.get(zeroForOneSlot) ?? null;
        break; // Found the swap, stop parsing
      } else {
        // Skip unknown actions - try to continue
        // Most actions have predictable sizes, but for safety we'll skip
        offset = skipAction(opcode, actionBytes, offset);
        if (offset === -1) break;
      }
    }

    if (
      poolId === null ||
      amountSpecified === null ||
      logPriceLimit === null ||
      zeroForOne === null
    ) {
      return null;
    }

    // Convert two's complement for signed values
    const TWO_255 = BigInt(1) << BigInt(255);
    const TWO_256 = BigInt(1) << BigInt(256);
    if (amountSpecified >= TWO_255) {
      amountSpecified = amountSpecified - TWO_256;
    }
    if (logPriceLimit >= TWO_255) {
      logPriceLimit = logPriceLimit - TWO_256;
    }

    return {
      poolId,
      amountSpecified,
      logPriceLimit,
      zeroForOne,
      victim: tx.from,
      gasPrice: tx.gasPrice ?? tx.maxFeePerGas ?? BigInt(0),
      nonce: tx.nonce,
      txHash: tx.hash,
      raw: tx.data, // for reference
    };
  } catch (err) {
    // Not a decodable swap transaction
    return null;
  }
}

/**
 * Skip past an operator action we don't need to decode.
 * Returns the new offset, or -1 if we can't determine the size.
 */
function skipAction(opcode: number, data: Uint8Array, offset: number): number {
  // Action sizes (after opcode byte):
  const fixedSizes: Record<number, number> = {
    0x00: 1, // PUSH0: slot(1)
    0x01: 11, // PUSH10: slot(1) + value(10)
    0x02: 17, // PUSH16: slot(1) + value(16)
    0x03: 33, // PUSH32: slot(1) + value(32)
    0x04: 2, // NEG: in(1) + out(1)
    0x05: 3, // ADD: a(1) + b(1) + out(1)
    0x06: 3, // SUB
    0x07: 3, // MUL
    0x08: 3, // DIV
    0x20: 0, // SETTLE: no params
    0x24: 20, // SYNC_TOKEN: address(20)
    0x25: 52, // SYNC_MULTITOKEN: address(20) + id(32)
    0x2d: 1, // CLEAR: slot(1)
    0x30: 0, // WRAP_NATIVE
    0x31: 1, // UNWRAP_NATIVE: slot(1)
    0x51: 0, // JUMPDEST
  };

  if (opcode in fixedSizes) {
    return offset + fixedSizes[opcode];
  }

  // Variable-size actions
  if (opcode === 0x21) {
    // TAKE_TOKEN: token(20) + to(20) + amountSlot(1)
    return offset + 41;
  }
  if (opcode === 0x26) {
    // TRANSFER_FROM_PAYER_ERC20: token(20) + amountSlot(1)
    return offset + 21;
  }
  if (opcode === 0x2a) {
    // TRANSFER_TRANSIENT_BALANCE_FROM: from(20) + to(20) + tag(32) + amountSlot(1)
    return offset + 73;
  }
  if (opcode === 0x11) {
    // MODIFY_POSITION: poolId(1) + min(1) + max(1) + payer(20) + shares(1) + out0(1) + out1(1) + hookLen(2)
    if (offset + 28 > data.length) return -1;
    const hookLen = (data[offset + 26] << 8) | data[offset + 27];
    return offset + 28 + hookLen;
  }
  if (opcode === 0x50) {
    // JUMP: offset(2)
    return offset + 2;
  }

  // Unknown action - can't determine size
  return -1;
}

/**
 * Extract the victim's slippage tolerance from decoded swap params.
 * Slippage is derived from the logPriceLimit relative to the amountSpecified direction.
 */
export function estimateSlippage(decoded: DecodedSwap): {
  slippagePercent: number;
  tradeSize: bigint;
} {
  // The slippage is encoded in the logPriceLimit
  // A wider price limit = higher slippage tolerance
  // For simplicity, we estimate based on the distance from a "fair" price

  const tradeSize =
    decoded.amountSpecified < 0n
      ? -decoded.amountSpecified
      : decoded.amountSpecified;

  // Calculate approximate slippage from logPriceLimit
  // In NoFeeSwap, logPriceLimit = (2^59) * ln(priceLimit)
  // The further the limit from current price, the higher the slippage
  const TWO_59 = Number(BigInt(2) ** BigInt(59));
  const limitPrice = Math.exp(Number(decoded.logPriceLimit) / TWO_59);

  // Rough slippage estimate - in practice you'd compare against current pool price
  const slippagePercent = Math.abs(1 - limitPrice) * 100;

  return {
    slippagePercent: Math.min(slippagePercent, 100),
    tradeSize,
  };
}
