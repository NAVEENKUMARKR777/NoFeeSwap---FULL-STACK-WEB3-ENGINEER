// Deployed contract addresses - loaded from deployed-addresses.json
// These are updated after deployment

export interface DeployedAddresses {
  deployerHelper: string;
  nofeeswap: string;
  nofeeswapDelegatee: string;
  operator: string;
  weth9: string;
  quoter: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  deployer: string;
  chainId: number;
  rpcUrl: string;
}

// Default addresses for local development (Anvil/Hardhat)
// These will be overwritten by the actual deployment
export const DEFAULT_ADDRESSES: DeployedAddresses = {
  deployerHelper: "0x0000000000000000000000000000000000000000",
  nofeeswap: "0x0000000000000000000000000000000000000000",
  nofeeswapDelegatee: "0x0000000000000000000000000000000000000000",
  operator: "0x0000000000000000000000000000000000000000",
  weth9: "0x0000000000000000000000000000000000000000",
  quoter: "0x0000000000000000000000000000000000000000",
  token0: "0x0000000000000000000000000000000000000000",
  token1: "0x0000000000000000000000000000000000000000",
  token0Symbol: "ALPHA",
  token1Symbol: "BETA",
  deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
};

// NoFeeSwap protocol constants
export const LOG_PRICE_TICK_X59 = BigInt("57643193118714");
export const FEE_SPACING_LARGE_X59 = BigInt("5793624167011548"); // ~1% fee tier
export const LOG_PRICE_SPACING_LARGE_X59 = BigInt(200) * LOG_PRICE_TICK_X59; // 200 ticks
export const FEE_SPACING_MEDIUM_X59 = BigInt("1731981530143823"); // ~0.3% fee tier
export const LOG_PRICE_SPACING_MEDIUM_X59 = BigInt(60) * LOG_PRICE_TICK_X59;
export const FEE_SPACING_SMALL_X59 = BigInt("288302457773874"); // ~0.05% fee tier
export const LOG_PRICE_SPACING_SMALL_X59 = BigInt(10) * LOG_PRICE_TICK_X59;

// One in X47 representation (100%)
export const ONE_X47 = BigInt(2) ** BigInt(47) - BigInt(1);
// Zero in X47
export const ZERO_X47 = BigInt(0);

// Kernel encoding helpers
export function encodeKernelCompact(
  breakpoints: Array<{ height: bigint; position: bigint }>
): bigint[] {
  // Each breakpoint = 80 bits (2 bytes X15 height + 8 bytes X59 position)
  // Pack tightly into uint256[] (3 breakpoints per slot, with 16 bits unused)
  const bits: bigint[] = [];
  for (const bp of breakpoints) {
    bits.push((bp.height << BigInt(64)) | bp.position);
  }

  // Pack 80-bit values into 256-bit slots
  const result: bigint[] = [];
  let current = BigInt(0);
  let bitsUsed = 0;

  for (const val of bits) {
    if (bitsUsed + 80 > 256) {
      result.push(current);
      current = BigInt(0);
      bitsUsed = 0;
    }
    current = (current << BigInt(80)) | val;
    bitsUsed += 80;
  }

  if (bitsUsed > 0) {
    // Left-align the remaining bits
    current = current << BigInt(256 - bitsUsed);
    result.push(current);
  }

  return result;
}

// Curve encoding helper
export function encodeCurve(prices: bigint[]): bigint[] {
  // Each price occupies 64 bits, pack 4 per uint256
  const result: bigint[] = [];
  let current = BigInt(0);
  let count = 0;

  for (const price of prices) {
    current = (current << BigInt(64)) | price;
    count++;
    if (count === 4) {
      result.push(current);
      current = BigInt(0);
      count = 0;
    }
  }

  if (count > 0) {
    current = current << (BigInt(64) * BigInt(4 - count));
    result.push(current);
  }

  return result;
}

// Convert a price ratio to X59 log price representation
// logPrice = (2^59) * ln(price)
export function priceToLogPriceX59(price: number): bigint {
  const TWO_59 = BigInt(2) ** BigInt(59);
  const logPrice = Math.log(price);
  return BigInt(Math.floor(logPrice * Number(TWO_59)));
}

// Convert X59 log price to price
export function logPriceX59ToPrice(logPriceX59: bigint): number {
  const TWO_59 = Number(BigInt(2) ** BigInt(59));
  return Math.exp(Number(logPriceX59) / TWO_59);
}

// Convert price to offsetted log price for curve: (2^59) * (16 + ln(price/pOffset))
export function priceToLogPriceOffsetted(
  price: number,
  pOffset: number = 1
): bigint {
  const TWO_59 = BigInt(2) ** BigInt(59);
  const logPriceOffsetted = 16 + Math.log(price / pOffset);
  return BigInt(Math.floor(logPriceOffsetted * Number(TWO_59)));
}

// Compute unsalted pool ID
export function computeUnsaltedPoolId(
  hookAddress: string = "0x0000000000000000000000000000000000000000",
  flags: number = 0,
  logOffset: number = 0
): bigint {
  const hookBigInt = BigInt(hookAddress);
  const flagsBigInt = BigInt(flags);
  // Two's complement for int8 logOffset
  const logOffsetBigInt =
    logOffset >= 0 ? BigInt(logOffset) : BigInt(256 + logOffset);
  return (
    (logOffsetBigInt << BigInt(180)) +
    (flagsBigInt << BigInt(160)) +
    hookBigInt
  );
}

// Create default kernel (simple linear from 0 to 1 over spacing)
export function createDefaultKernel(spacing: bigint): bigint[] {
  const breakpoints = [
    { height: BigInt(0), position: BigInt(0) },
    { height: BigInt(2) ** BigInt(15), position: spacing },
  ];
  return encodeKernelCompact(breakpoints);
}

// Create default curve for a given price
export function createDefaultCurve(
  price: number,
  spacing: bigint,
  logOffset: number = 0
): bigint[] {
  const TWO_59 = BigInt(2) ** BigInt(59);
  const pOffset = Math.exp(logOffset);
  const logPrice = Math.log(price / pOffset);
  const logPriceOffsetted = BigInt(
    Math.floor((16 + logPrice) * Number(TWO_59))
  );

  // lower = logPriceOffsetted - (logPriceOffsetted % spacing)
  // But we need to align to the spacing grid relative to the offset center
  const center = BigInt(16) * TWO_59; // center at logOffset=0
  const relativePrice = logPriceOffsetted - center;
  const spacingNum = Number(spacing);
  const relNum = Number(relativePrice);
  const lowerRel = BigInt(Math.floor(relNum / spacingNum)) * spacing;
  const lower = center + lowerRel;
  const upper = lower + spacing;

  const prices = [lower, upper, logPriceOffsetted];
  return encodeCurve(prices);
}
