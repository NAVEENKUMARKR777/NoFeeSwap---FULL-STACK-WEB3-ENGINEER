import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

// Load deployed addresses
const ADDRESSES_PATH = path.join(__dirname, "..", "..", "deployed-addresses.json");

export interface DeployedAddresses {
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

export function loadAddresses(): DeployedAddresses {
  if (!fs.existsSync(ADDRESSES_PATH)) {
    throw new Error(
      `deployed-addresses.json not found at ${ADDRESSES_PATH}. Run the deployment script first.`
    );
  }
  return JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
}

export const BOT_CONFIG = {
  // RPC endpoint (HTTP for transactions, WS for subscriptions)
  RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
  WS_URL: process.env.WS_URL || "ws://127.0.0.1:8545",

  // Bot's private key (Anvil account #9 by default)
  BOT_PRIVATE_KEY:
    process.env.BOT_PRIVATE_KEY ||
    "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",

  // Minimum profit threshold (in wei) to execute sandwich
  MIN_PROFIT_WEI: BigInt(process.env.MIN_PROFIT_WEI || "0"),

  // Gas price multiplier for front-run (higher = more priority)
  FRONTRUN_GAS_MULTIPLIER: 2,

  // Gas price for back-run (lower than victim)
  BACKRUN_GAS_DIVISOR: 2,

  // Polling interval for pending transactions (ms)
  POLL_INTERVAL_MS: 100,

  // Maximum gas to use for sandwich transactions
  MAX_GAS: 500000n,
};
