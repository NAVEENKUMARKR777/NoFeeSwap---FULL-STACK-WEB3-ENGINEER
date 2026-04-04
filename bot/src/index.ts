import { ethers } from "ethers";
import { BOT_CONFIG, loadAddresses } from "./config";
import { MempoolMonitor } from "./mempool-monitor";
import { SandwichExecutor } from "./sandwich";
import { type DecodedSwap } from "./decoder";

async function main() {
  console.log("========================================");
  console.log("  NoFeeSwap Sandwich Bot");
  console.log("  (Local Test Environment Only)");
  console.log("========================================\n");

  // Load deployed contract addresses
  let addresses;
  try {
    addresses = loadAddresses();
    console.log("[Config] Loaded deployed addresses:");
    console.log(`  Nofeeswap:  ${addresses.nofeeswap}`);
    console.log(`  Operator:   ${addresses.operator}`);
    console.log(`  Token0:     ${addresses.token0} (${addresses.token0Symbol})`);
    console.log(`  Token1:     ${addresses.token1} (${addresses.token1Symbol})`);
  } catch (err: any) {
    console.error(`[Error] ${err.message}`);
    process.exit(1);
  }

  // Connect to local node
  const provider = new ethers.JsonRpcProvider(BOT_CONFIG.RPC_URL);

  try {
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    console.log(`\n[Network] Connected to chain ${network.chainId}`);
    console.log(`[Network] Current block: ${blockNumber}`);
  } catch (err) {
    console.error("[Error] Cannot connect to local node at", BOT_CONFIG.RPC_URL);
    console.error("  Make sure Anvil is running with: anvil --no-mining");
    process.exit(1);
  }

  // Initialize bot wallet
  const botWallet = new ethers.Wallet(BOT_CONFIG.BOT_PRIVATE_KEY, provider);
  const botBalance = await provider.getBalance(botWallet.address);
  console.log(`\n[Bot] Address: ${botWallet.address}`);
  console.log(`[Bot] ETH Balance: ${ethers.formatEther(botBalance)} ETH`);

  // Check bot's token balances
  const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
  const token0 = new ethers.Contract(addresses.token0, erc20Abi, provider);
  const token1 = new ethers.Contract(addresses.token1, erc20Abi, provider);
  const bal0 = await token0.balanceOf(botWallet.address);
  const bal1 = await token1.balanceOf(botWallet.address);
  console.log(
    `[Bot] ${addresses.token0Symbol} Balance: ${ethers.formatEther(bal0)}`
  );
  console.log(
    `[Bot] ${addresses.token1Symbol} Balance: ${ethers.formatEther(bal1)}`
  );

  // Approve tokens for the Nofeeswap contract (max approval)
  console.log("\n[Bot] Approving tokens for Nofeeswap...");
  const erc20WriteAbi = [
    "function approve(address spender, uint256 amount) returns (bool)",
  ];
  const token0Write = new ethers.Contract(
    addresses.token0,
    erc20WriteAbi,
    botWallet
  );
  const token1Write = new ethers.Contract(
    addresses.token1,
    erc20WriteAbi,
    botWallet
  );
  const maxUint = ethers.MaxUint256;

  await (await token0Write.approve(addresses.operator, maxUint)).wait();
  await (await token1Write.approve(addresses.operator, maxUint)).wait();
  console.log("[Bot] Token approvals set");

  // Initialize sandwich executor
  const executor = new SandwichExecutor(provider, botWallet, addresses);

  // Track statistics
  let totalDetected = 0;
  let totalExecuted = 0;
  let totalProfit = BigInt(0);

  // Handler for detected swaps
  const onSwapDetected = async (decoded: DecodedSwap) => {
    totalDetected++;

    // Skip transactions from the bot itself
    if (
      decoded.victim.toLowerCase() === botWallet.address.toLowerCase()
    ) {
      console.log("  [Skip] Own transaction detected, ignoring");
      return;
    }

    console.log(`\n[Bot] Processing swap #${totalDetected}`);

    const result = await executor.executeSandwich(decoded);

    if (result) {
      totalExecuted++;
      totalProfit += result.profit;
      console.log(`\n[Stats] Sandwiches: ${totalExecuted}/${totalDetected}`);
      console.log(
        `[Stats] Total Estimated Profit: ${ethers.formatEther(totalProfit)} tokens`
      );
    }
  };

  // Start mempool monitor
  const monitor = new MempoolMonitor(
    provider,
    addresses.nofeeswap,
    addresses.operator,
    onSwapDetected
  );

  await monitor.start();

  console.log("\n[Bot] Sandwich bot is running. Waiting for swap transactions...");
  console.log("[Bot] Press Ctrl+C to stop.\n");

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n[Bot] Shutting down...");
    monitor.stop();
    console.log(`[Stats] Final Statistics:`);
    console.log(`  Swaps Detected: ${totalDetected}`);
    console.log(`  Sandwiches Executed: ${totalExecuted}`);
    console.log(
      `  Total Estimated Profit: ${ethers.formatEther(totalProfit)} tokens`
    );
    process.exit(0);
  });

  // Keep the process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
