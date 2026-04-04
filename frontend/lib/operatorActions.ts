/**
 * Operator action bytecode encoder.
 * Matches the exact format expected by the Operator contract's unlockCallback assembly parser.
 * Reference: operator/tests/Nofee.py swapSequence() and operator/contracts/Operator.sol
 */

// ===== Opcodes (decimal, matching the switch-case in Operator.sol) =====
const PUSH0 = 0;
const PUSH10 = 1;
const PUSH16 = 2;
const PUSH32 = 3;
const NEG = 4;
const LT = 13;
const ISZERO = 16;
const JUMPDEST = 20;
const JUMP = 21;
const TRANSFER_FROM_PAYER_ERC20 = 37;
const TAKE_TOKEN = 42;
const SYNC_TOKEN = 45;
const SETTLE = 47;
const SWAP = 52;
const MODIFY_POSITION = 53;
const REVERT = 59;

const X59 = BigInt(2) ** BigInt(59);
const X63 = BigInt(2) ** BigInt(63);
const X64 = BigInt(2) ** BigInt(64);

// ===== Low-level byte helpers =====

function toBytes(value: number | bigint, length: number): number[] {
  const result: number[] = [];
  let v = BigInt(value);
  // Handle two's complement for negative numbers
  if (v < 0n) {
    v = (1n << BigInt(length * 8)) + v;
  }
  for (let i = length - 1; i >= 0; i--) {
    result[i] = Number(v & 0xFFn);
    v >>= 8n;
  }
  return result;
}

function addressBytes(addr: string): number[] {
  return toBytes(BigInt(addr), 20);
}

function concatBytes(...arrays: number[][]): number[] {
  return arrays.flat();
}

function bytesToHex(bytes: number[]): `0x${string}` {
  return ("0x" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

// ===== Action encoders =====

function encodePush32(value: bigint, slot: number): number[] {
  // Format: [PUSH32:1] [value:32] [slot:1]
  return concatBytes([PUSH32], toBytes(value, 32), [slot]);
}

function encodeSwap(
  poolId: bigint,
  amountSpecifiedSlot: number,
  limitOffsetted: bigint,
  zeroForOne: number,
  crossThresholdSlot: number,
  successSlot: number,
  amount0Slot: number,
  amount1Slot: number,
  hookData: number[] = []
): number[] {
  // Format: [SWAP:1] [poolId:32] [amountSpecifiedSlot:1] [limitOffsetted:8]
  //         [zeroForOne:1] [crossThresholdSlot:1] [successSlot:1]
  //         [amount0Slot:1] [amount1Slot:1] [hookDataLen:2] [hookData]
  // Clamp limitOffsetted to uint64 range
  let lo = limitOffsetted;
  if (lo < 0n) lo = 0n;
  if (lo >= X64) lo = X64 - 1n;

  return concatBytes(
    [SWAP],
    toBytes(poolId, 32),
    [amountSpecifiedSlot],
    toBytes(lo, 8),
    [zeroForOne],
    [crossThresholdSlot],
    [successSlot],
    [amount0Slot],
    [amount1Slot],
    toBytes(hookData.length, 2),
    hookData
  );
}

function encodeNeg(valueSlot: number, resultSlot: number): number[] {
  return [NEG, valueSlot, resultSlot];
}

function encodeLt(value0Slot: number, value1Slot: number, resultSlot: number): number[] {
  return [LT, value0Slot, value1Slot, resultSlot];
}

function encodeIszero(valueSlot: number, resultSlot: number): number[] {
  return [ISZERO, valueSlot, resultSlot];
}

function encodeJumpdest(): number[] {
  return [JUMPDEST];
}

function encodeJump(offset: number, conditionSlot: number): number[] {
  return concatBytes([JUMP], toBytes(offset, 2), [conditionSlot]);
}

function encodeRevert(): number[] {
  return [REVERT];
}

function encodeSyncToken(token: string): number[] {
  return concatBytes([SYNC_TOKEN], addressBytes(token));
}

function encodeTransferFromPayerERC20(
  token: string,
  amountSlot: number,
  to: string,
  successSlot: number,
  resultSlot: number
): number[] {
  // Format: [37:1] [token:20] [amountSlot:1] [to:20] [successSlot:1] [resultSlot:1]
  return concatBytes(
    [TRANSFER_FROM_PAYER_ERC20],
    addressBytes(token),
    [amountSlot],
    addressBytes(to),
    [successSlot],
    [resultSlot]
  );
}

function encodeTakeToken(
  token: string,
  to: string,
  amountSlot: number,
  successSlot: number
): number[] {
  // Format: [42:1] [token:20] [to:20] [amountSlot:1] [successSlot:1]
  return concatBytes(
    [TAKE_TOKEN],
    addressBytes(token),
    addressBytes(to),
    [amountSlot],
    [successSlot]
  );
}

function encodeSettle(
  valueSlot: number,
  successSlot: number,
  resultSlot: number
): number[] {
  return [SETTLE, valueSlot, successSlot, resultSlot];
}

// ===== High-level sequence builders (matching Python test exactly) =====

/**
 * Build complete swap action data for the Operator.
 * This matches swapSequence() from operator/tests/Nofee.py exactly.
 */
export function buildSwapActionData(params: {
  nofeeswapAddress: string;
  token0: string;
  token1: string;
  payer: string;
  poolId: bigint;
  amountSpecified: bigint;
  limit: bigint; // logPriceLimit in X59 (non-offsetted)
  zeroForOne: number; // 0 or 1
  deadline: number;
}): `0x${string}` {
  const {
    nofeeswapAddress,
    token0,
    token1,
    payer,
    poolId,
    amountSpecified,
    limit,
    zeroForOne,
    deadline,
  } = params;

  // Slot assignments (matching Python test)
  const successSlot = 2;
  const amount0Slot = 3;
  const amount1Slot = 4;
  const successSlotTransfer0 = 7;
  const successSlotTransfer1 = 8;
  const valueSlotSettle0 = 9;
  const successSlotSettle0 = 10;
  const resultSlotSettle0 = 11;
  const valueSlotSettle1 = 12;
  const successSlotSettle1 = 13;
  const resultSlotSettle1 = 14;
  const amountSpecifiedSlot = 15;
  const zeroSlot = 100;
  const logicSlot = 200;

  // Compute limitOffsetted
  const logOffset = Number((poolId >> 180n) % 256n);
  const signedLogOffset = logOffset >= 128 ? logOffset - 256 : logOffset;
  let limitOffsetted = limit + X63 - BigInt(signedLogOffset) * X59;
  if (limitOffsetted < 0n) limitOffsetted = 0n;
  if (limitOffsetted >= X64) limitOffsetted = X64 - 1n;

  // Build sequence (27 actions, same as Python)
  // IMPORTANT: each element must be a unique array (not shared reference)
  const sequence: number[][] = Array.from({ length: 27 }, () => []);

  // [0] PUSH32 amountSpecified -> amountSpecifiedSlot
  sequence[0] = encodePush32(amountSpecified, amountSpecifiedSlot);

  // [1] SWAP
  sequence[1] = encodeSwap(
    poolId,
    amountSpecifiedSlot,
    limitOffsetted,
    zeroForOne,
    zeroSlot,        // crossThresholdSlot (0 = no threshold)
    successSlot,
    amount0Slot,
    amount1Slot
  );

  // [2] placeholder for JUMP (4 bytes - must set BEFORE computing offset)
  sequence[2] = [0, 0, 0, 0];
  sequence[3] = encodeRevert();
  sequence[4] = encodeJumpdest();

  // Fill [2]: JUMP past revert if success
  const jumpTarget0 = sequence.slice(0, 4).reduce((acc, s) => acc + s.length, 0);
  sequence[2] = encodeJump(jumpTarget0, successSlot);

  // === Handle token0 (amount0) ===
  // [5] Check if amount0 < 0 (outgoing = needs TAKE)
  sequence[5] = encodeLt(zeroSlot, amount0Slot, logicSlot);
  sequence[6] = [0, 0, 0, 0]; // placeholder JUMP

  // [7] NEG amount0 (make positive for take)
  sequence[7] = encodeNeg(amount0Slot, amount0Slot);

  // [8] TAKE token0 to payer
  sequence[8] = encodeTakeToken(token0, payer, amount0Slot, successSlotSettle0);

  // [9] JUMPDEST (landing for the skip)
  sequence[9] = encodeJumpdest();

  // Fill [6]: JUMP to [9] if NOT (amount0 < 0) — i.e., amount0 >= 0 means incoming
  const jumpTarget1 = sequence.slice(0, 9).reduce((acc, s) => acc + s.length, 0);
  sequence[6] = encodeJump(jumpTarget1, logicSlot);

  // [10] ISZERO logicSlot -> logicSlot (invert: now logicSlot=1 if amount0 >= 0)
  sequence[10] = encodeIszero(logicSlot, logicSlot);
  sequence[11] = [0, 0, 0, 0]; // placeholder JUMP (set before computing target)

  // [12] SYNC token0
  sequence[12] = encodeSyncToken(token0);

  // [13] TRANSFER_FROM_PAYER token0
  sequence[13] = encodeTransferFromPayerERC20(
    token0,
    amount0Slot,
    nofeeswapAddress,
    successSlotTransfer0,
    0 // resultSlot (unused)
  );

  // [14] SETTLE for token0
  sequence[14] = encodeSettle(valueSlotSettle0, successSlotSettle0, resultSlotSettle0);

  // [15] JUMPDEST
  sequence[15] = encodeJumpdest();

  // Fill [11]: JUMP to [15] if logicSlot=0 (amount0 was outgoing, skip settle)
  const jumpTarget2 = sequence.slice(0, 15).reduce((acc, s) => acc + s.length, 0);
  sequence[11] = encodeJump(jumpTarget2, logicSlot);

  // === Handle token1 (amount1) - same pattern ===
  sequence[16] = encodeLt(zeroSlot, amount1Slot, logicSlot);
  sequence[17] = [0, 0, 0, 0]; // placeholder JUMP

  sequence[18] = encodeNeg(amount1Slot, amount1Slot);
  sequence[19] = encodeTakeToken(token1, payer, amount1Slot, successSlotSettle1);
  sequence[20] = encodeJumpdest();

  const jumpTarget3 = sequence.slice(0, 20).reduce((acc, s) => acc + s.length, 0);
  sequence[17] = encodeJump(jumpTarget3, logicSlot);

  sequence[21] = encodeIszero(logicSlot, logicSlot);
  sequence[22] = [0, 0, 0, 0]; // placeholder JUMP

  sequence[23] = encodeSyncToken(token1);
  sequence[24] = encodeTransferFromPayerERC20(
    token1,
    amount1Slot,
    nofeeswapAddress,
    successSlotTransfer1,
    0
  );
  sequence[25] = encodeSettle(valueSlotSettle1, successSlotSettle1, resultSlotSettle1);
  sequence[26] = encodeJumpdest();

  const jumpTarget4 = sequence.slice(0, 26).reduce((acc, s) => acc + s.length, 0);
  sequence[22] = encodeJump(jumpTarget4, logicSlot);

  // Concatenate: [deadline:4] [sequence bytes]
  const deadlineBytes = toBytes(deadline, 4);
  const allBytes = concatBytes(deadlineBytes, ...sequence);

  return bytesToHex(allBytes);
}

/**
 * Compute tagShares for ERC-6909 share tracking.
 * tagShares = keccak256(abi.encode(poolId, qMin, qMax))
 * where qMin/qMax are NON-offsetted X59 log prices.
 */
function computeTagShares(
  poolId: bigint,
  qMinOffsetted: bigint,
  qMaxOffsetted: bigint
): bigint {
  // Convert offsetted -> non-offsetted: qNonOffset = qOffsetted - (1<<63) + logOffset*(1<<59)
  const logOffset = Number((poolId >> 180n) % 256n);
  const signedLogOffset = logOffset >= 128 ? logOffset - 256 : logOffset;
  const qMinNonOffset = qMinOffsetted - X63 + BigInt(signedLogOffset) * X59;
  const qMaxNonOffset = qMaxOffsetted - X63 + BigInt(signedLogOffset) * X59;

  // keccak256(abi.encode(uint256, int256, int256))
  // Manual ABI encoding: each value is 32 bytes, concatenated
  const encoded = concatBytes(
    toBytes(poolId, 32),
    toBytes(qMinNonOffset, 32),
    toBytes(qMaxNonOffset, 32)
  );
  // Use a simple keccak256 - we need to import from somewhere
  // For browser compatibility, compute it inline
  const hex = bytesToHex(encoded);
  // We'll need to pass this from the caller who has access to viem's keccak256
  // For now, return 0 and let the caller compute it
  return BigInt(0); // placeholder - overridden by caller
}

function encodeModifySingleBalance(
  tag: bigint,
  amountSlot: number,
  successSlot: number
): number[] {
  // Format: [MODIFY_SINGLE_BALANCE:1] [tag:32B] [amountSlot:1B] [successSlot:1B]
  return concatBytes(
    [50], // MODIFY_SINGLE_BALANCE opcode
    toBytes(tag, 32),
    [amountSlot],
    [successSlot]
  );
}

/**
 * Build complete modifyPosition (mint) action data.
 * tagShares must be precomputed by the caller as:
 *   keccak256(abi.encode(poolId, logPriceMin, logPriceMax))
 */
export function buildMintActionData(params: {
  nofeeswapAddress: string;
  token0: string;
  token1: string;
  payer: string;
  poolId: bigint;
  qMinOffsetted: bigint;
  qMaxOffsetted: bigint;
  shares: bigint;
  tagShares: bigint; // keccak256(abi.encode(poolId, qMin, qMax))
  deadline: number;
}): `0x${string}` {
  const {
    nofeeswapAddress,
    token0,
    token1,
    poolId,
    qMinOffsetted,
    qMaxOffsetted,
    shares,
    tagShares,
    deadline,
  } = params;

  const sharesSlot = 1;
  const successSlot = 2;
  const amount0Slot = 3;
  const amount1Slot = 4;
  const successSlotTransfer0 = 7;
  const successSlotTransfer1 = 8;
  const valueSlotSettle0 = 9;
  const successSlotSettle0 = 10;
  const resultSlotSettle0 = 11;
  const valueSlotSettle1 = 12;
  const successSlotSettle1 = 13;
  const resultSlotSettle1 = 14;
  const sharesSuccessSlot = 15;

  let qMin = qMinOffsetted;
  let qMax = qMaxOffsetted;
  if (qMin < 0n) qMin = 0n;
  if (qMin >= X64) qMin = X64 - 1n;
  if (qMax < 0n) qMax = 0n;
  if (qMax >= X64) qMax = X64 - 1n;

  const sequence: number[][] = [];

  sequence.push(encodePush32(shares, sharesSlot));

  sequence.push(
    concatBytes(
      [MODIFY_POSITION],
      toBytes(poolId, 32),
      toBytes(qMin, 8),
      toBytes(qMax, 8),
      [sharesSlot],
      [successSlot],
      [amount0Slot],
      [amount1Slot],
      toBytes(0, 2)
    )
  );

  sequence.push(encodeSyncToken(token0));
  sequence.push(
    encodeTransferFromPayerERC20(token0, amount0Slot, nofeeswapAddress, successSlotTransfer0, 0)
  );
  sequence.push(encodeSettle(valueSlotSettle0, successSlotSettle0, resultSlotSettle0));

  sequence.push(encodeSyncToken(token1));
  sequence.push(
    encodeTransferFromPayerERC20(token1, amount1Slot, nofeeswapAddress, successSlotTransfer1, 0)
  );
  sequence.push(encodeSettle(valueSlotSettle1, successSlotSettle1, resultSlotSettle1));

  // MODIFY_SINGLE_BALANCE for ERC-6909 shares tracking
  sequence.push(encodeModifySingleBalance(tagShares, sharesSlot, sharesSuccessSlot));

  const deadlineBytes = toBytes(deadline, 4);
  const allBytes = concatBytes(deadlineBytes, ...sequence);
  return bytesToHex(allBytes);
}

/**
 * Build burn action (negative shares).
 * tagShares must be precomputed by the caller.
 */
export function buildBurnActionData(params: {
  nofeeswapAddress: string;
  token0: string;
  token1: string;
  recipient: string;
  poolId: bigint;
  qMinOffsetted: bigint;
  qMaxOffsetted: bigint;
  shares: bigint; // positive value, will be negated
  tagShares: bigint;
  deadline: number;
}): `0x${string}` {
  const {
    token0,
    token1,
    recipient,
    poolId,
    qMinOffsetted,
    qMaxOffsetted,
    shares,
    tagShares,
    deadline,
  } = params;

  const sharesSlot = 1;
  const successSlot = 2;
  const amount0Slot = 3;
  const amount1Slot = 4;
  const successSlotTake0 = 7;
  const successSlotTake1 = 8;
  const sharesSuccessSlot = 15;

  let qMin = qMinOffsetted;
  let qMax = qMaxOffsetted;
  if (qMin < 0n) qMin = 0n;
  if (qMin >= X64) qMin = X64 - 1n;
  if (qMax < 0n) qMax = 0n;
  if (qMax >= X64) qMax = X64 - 1n;

  const sequence: number[][] = [];

  // PUSH32 negative shares
  sequence.push(encodePush32(-shares, sharesSlot));

  // MODIFY_POSITION (negative shares = burn)
  sequence.push(
    concatBytes(
      [MODIFY_POSITION],
      toBytes(poolId, 32),
      toBytes(qMin, 8),
      toBytes(qMax, 8),
      [sharesSlot],
      [successSlot],
      [amount0Slot],
      [amount1Slot],
      toBytes(0, 2)
    )
  );

  // NEG amounts (burn returns negative)
  sequence.push(encodeNeg(amount0Slot, amount0Slot));
  sequence.push(encodeNeg(amount1Slot, amount1Slot));

  // TAKE tokens to recipient
  sequence.push(encodeTakeToken(token0, recipient, amount0Slot, successSlotTake0));
  sequence.push(encodeTakeToken(token1, recipient, amount1Slot, successSlotTake1));

  // MODIFY_SINGLE_BALANCE with negative shares
  sequence.push(encodeModifySingleBalance(tagShares, sharesSlot, sharesSuccessSlot));

  const deadlineBytes = toBytes(deadline, 4);
  const allBytes = concatBytes(deadlineBytes, ...sequence);
  return bytesToHex(allBytes);
}
