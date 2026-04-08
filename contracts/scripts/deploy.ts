import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

// Load contract artifacts
function loadArtifact(name: string) {
  const filePath = path.join(__dirname, "..", "abis", `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// Output file for deployed addresses
const DEPLOY_OUTPUT = path.join(__dirname, "..", "..", "deployed-addresses.json");

async function main() {
  const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Use the first Anvil/Hardhat account as deployer
  const DEPLOYER_PK =
    process.env.DEPLOYER_PK ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const deployer = new ethers.Wallet(DEPLOYER_PK, provider);

  console.log("=== NoFeeSwap Local Deployment ===");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(
    `Balance: ${ethers.formatEther(await provider.getBalance(deployer.address))} ETH`
  );
  console.log("");

  // Gas settings for large contract deployments
  const gasOverrides = { gasLimit: 29_000_000n };

  // ===== Step 1: Deploy DeployerHelper (CREATE3 factory) =====
  console.log("1. Deploying DeployerHelper...");
  const deployerHelperArt = loadArtifact("DeployerHelper");
  const DeployerHelperFactory = new ethers.ContractFactory(
    deployerHelperArt.abi,
    deployerHelperArt.bytecode,
    deployer
  );
  const deployerHelper = await DeployerHelperFactory.deploy(deployer.address, gasOverrides);
  await deployerHelper.waitForDeployment();
  const deployerHelperAddr = await deployerHelper.getAddress();
  console.log(`   DeployerHelper: ${deployerHelperAddr}`);

  // ===== Step 2: Compute deterministic addresses =====
  console.log("2. Computing deterministic addresses...");
  const salt1 = ethers.zeroPadValue("0x01", 32);
  const salt2 = ethers.zeroPadValue("0x02", 32);

  const delegateeAddr = await (deployerHelper as any).addressOf(salt1);
  const nofeeswapAddr = await (deployerHelper as any).addressOf(salt2);
  console.log(`   NofeeswapDelegatee (predicted): ${delegateeAddr}`);
  console.log(`   Nofeeswap (predicted): ${nofeeswapAddr}`);

  // ===== Step 3: Deploy NofeeswapDelegatee via CREATE3 =====
  console.log("3. Deploying NofeeswapDelegatee via CREATE3...");
  const delegateeArt = loadArtifact("NofeeswapDelegatee");
  const delegateeBytecode =
    delegateeArt.bytecode +
    ethers.AbiCoder.defaultAbiCoder()
      .encode(["address"], [nofeeswapAddr])
      .slice(2);

  // Use explicit nonce to avoid caching issues
  let nonce = await provider.getTransactionCount(deployer.address, "latest");
  console.log(`   Current nonce: ${nonce}`);

  const create3Fn = deployerHelper.getFunction("create3(bytes32,bytes)");
  const tx1 = await create3Fn!(
    salt1,
    delegateeBytecode,
    { ...gasOverrides, nonce: nonce++ }
  );
  const receipt1 = await tx1.wait();
  console.log(`   NofeeswapDelegatee deployed: ${delegateeAddr} (gas: ${receipt1?.gasUsed})`);

  // ===== Step 4: Deploy Nofeeswap via CREATE3 =====
  console.log("4. Deploying Nofeeswap via CREATE3...");
  const nofeeswapArt = loadArtifact("Nofeeswap");
  const nofeeswapBytecode =
    nofeeswapArt.bytecode +
    ethers.AbiCoder.defaultAbiCoder()
      .encode(["address", "address"], [delegateeAddr, deployer.address])
      .slice(2);

  const tx2 = await create3Fn!(
    salt2,
    nofeeswapBytecode,
    { ...gasOverrides, nonce: nonce++ }
  );
  const receipt2 = await tx2.wait();
  console.log(`   Nofeeswap deployed: ${nofeeswapAddr} (gas: ${receipt2?.gasUsed})`);

  // Verify deployment
  const code = await provider.getCode(nofeeswapAddr);
  if (code === "0x") {
    throw new Error("Nofeeswap contract not deployed correctly!");
  }
  console.log(`   Verified: contract code exists at ${nofeeswapAddr}`);

  // ===== Step 5: Configure protocol =====
  console.log("5. Configuring protocol...");
  const nofeeswap = new ethers.Contract(
    nofeeswapAddr,
    nofeeswapArt.abi,
    deployer
  );

  // modifyProtocol: (maxPoolGrowthPortion << 208) + (protocolGrowthPortion << 160) + protocolOwner
  const maxPoolGrowthPortion = BigInt(2) ** BigInt(47) - BigInt(1);
  const protocolGrowthPortion = BigInt(0);
  const protocolSlot =
    (maxPoolGrowthPortion << BigInt(208)) +
    (protocolGrowthPortion << BigInt(160)) +
    BigInt(deployer.address);

  const delegateeContract = new ethers.Contract(
    delegateeAddr,
    delegateeArt.abi,
    deployer
  );
  const modifyProtocolData =
    delegateeContract.interface.encodeFunctionData("modifyProtocol", [
      protocolSlot,
    ]);
  const tx3 = await nofeeswap.dispatch(modifyProtocolData, { ...gasOverrides, nonce: nonce++ });
  await tx3.wait();
  console.log("   Protocol configured");

  // ===== Step 6: Deploy MockWETH9 =====
  console.log("6. Deploying MockWETH9...");
  const weth9Art = loadArtifact("MockWETH9");
  const WETH9Factory = new ethers.ContractFactory(
    weth9Art.abi,
    weth9Art.bytecode,
    deployer
  );
  const weth9 = await WETH9Factory.deploy({ ...gasOverrides, nonce: nonce++ });
  await weth9.waitForDeployment();
  const weth9Addr = await weth9.getAddress();
  console.log(`   MockWETH9: ${weth9Addr}`);

  // ===== Step 7: Deploy MockQuoter =====
  console.log("7. Deploying MockQuoter...");
  const quoterArt = loadArtifact("MockQuoter");
  const QuoterFactory = new ethers.ContractFactory(
    quoterArt.abi,
    quoterArt.bytecode,
    deployer
  );
  const quoter = await QuoterFactory.deploy({ ...gasOverrides, nonce: nonce++ });
  await quoter.waitForDeployment();
  const quoterAddr = await quoter.getAddress();
  console.log(`   MockQuoter: ${quoterAddr}`);

  // ===== Step 8: Deploy Operator =====
  console.log("8. Deploying Operator...");
  const operatorArt = loadArtifact("Operator");
  const permit2Addr = ethers.ZeroAddress;
  const OperatorFactory = new ethers.ContractFactory(
    operatorArt.abi,
    operatorArt.bytecode,
    deployer
  );
  const operator = await OperatorFactory.deploy(
    nofeeswapAddr,
    permit2Addr,
    weth9Addr,
    quoterAddr,
    { ...gasOverrides, nonce: nonce++ }
  );
  await operator.waitForDeployment();
  const operatorAddr = await operator.getAddress();
  console.log(`   Operator: ${operatorAddr}`);

  // ===== Step 9: Deploy Mock ERC-20 Tokens =====
  console.log("9. Deploying Mock ERC-20 Tokens...");
  const erc20Art = loadArtifact("MockERC20");
  const ERC20Factory = new ethers.ContractFactory(
    erc20Art.abi,
    erc20Art.bytecode,
    deployer
  );

  const tokenA = await ERC20Factory.deploy("Token Alpha", "ALPHA", 18, { ...gasOverrides, nonce: nonce++ });
  await tokenA.waitForDeployment();
  const tokenAAddr = await tokenA.getAddress();

  const tokenB = await ERC20Factory.deploy("Token Beta", "BETA", 18, { ...gasOverrides, nonce: nonce++ });
  await tokenB.waitForDeployment();
  const tokenBAddr = await tokenB.getAddress();

  // Ensure token0 < token1 (arithmetic ordering)
  let token0Addr: string, token1Addr: string;
  if (BigInt(tokenAAddr) < BigInt(tokenBAddr)) {
    token0Addr = tokenAAddr;
    token1Addr = tokenBAddr;
  } else {
    token0Addr = tokenBAddr;
    token1Addr = tokenAAddr;
  }

  console.log(`   Token0 (${token0Addr === tokenAAddr ? "ALPHA" : "BETA"}): ${token0Addr}`);
  console.log(`   Token1 (${token1Addr === tokenAAddr ? "ALPHA" : "BETA"}): ${token1Addr}`);

  // ===== Step 10: Mint tokens =====
  console.log("10. Minting tokens...");
  const mintAmount = ethers.parseEther("1000000");

  const token0 = new ethers.Contract(token0Addr, erc20Art.abi, deployer);
  const token1 = new ethers.Contract(token1Addr, erc20Art.abi, deployer);

  await (await token0.mint(deployer.address, mintAmount, { nonce: nonce++ })).wait();
  await (await token1.mint(deployer.address, mintAmount, { nonce: nonce++ })).wait();

  // Mint to Anvil test accounts (1-3) and bot account (9)
  const testAccounts = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720", // bot wallet
  ];
  for (const acct of testAccounts) {
    await (await token0.mint(acct, mintAmount, { nonce: nonce++ })).wait();
    await (await token1.mint(acct, mintAmount, { nonce: nonce++ })).wait();
  }
  console.log(`   Minted ${ethers.formatEther(mintAmount)} tokens each to deployer, 3 test accounts, and bot`);

  // ===== Step 11: Initialize a default pool with large liquidity =====
  console.log("11. Initializing default pool with 10000 shares liquidity...");

  // Protocol constants
  const X60 = BigInt(2) ** BigInt(60);
  const X63 = BigInt(2) ** BigInt(63);
  const X256 = BigInt(2) ** BigInt(256);
  const spacing = BigInt(200) * BigInt("57643193118714"); // 1% fee tier

  // Kernel: linear [0,0] -> [spacing, 2^15]
  function encodeKernelCompact(kernel: [bigint, bigint][]) {
    let k = BigInt(0); let bits = 0;
    for (const [pos, height] of kernel.slice(1)) { k = (k << BigInt(16)) + height; k = (k << BigInt(64)) + pos; bits += 80; }
    if (bits % 256 !== 0) { k = k << BigInt(256 - (bits % 256)); bits += 256 - (bits % 256); }
    const count = bits / 256; const result: bigint[] = new Array(count).fill(BigInt(0));
    let remaining = k; for (let j = count - 1; j >= 0; j--) { result[j] = remaining % X256; remaining = remaining / X256; }
    return result;
  }
  function encodeCurve(curve: bigint[]) {
    const len = Math.ceil(curve.length / 4); const encoded: bigint[] = new Array(len).fill(BigInt(0));
    let shift = BigInt(192); let idx = 0;
    for (const p of curve) { encoded[Math.floor(idx / 4)] += p << shift; shift -= BigInt(64); if (shift < BigInt(0)) shift = BigInt(192); idx++; }
    return encoded;
  }

  const kernelCompactArray = encodeKernelCompact([[BigInt(0), BigInt(0)], [spacing, BigInt(2) ** BigInt(15)]]);

  // Curve: price ≈ 0.85 (from sqrtPriceX96 used in tests)
  const sqrtPriceX96 = BigInt("67254909186229727392878661970");
  const X96 = BigInt(2) ** BigInt(96);
  const logPrice = BigInt(Math.floor(Number(X60) * Math.log(Number(sqrtPriceX96) / Number(X96))));
  const logPriceOffsetted = logPrice + X63;
  const lower = (logPriceOffsetted / spacing) * spacing;
  const upper = lower + spacing;
  let qCurrent = logPriceOffsetted;
  if (qCurrent <= lower) qCurrent = lower + BigInt(1);
  if (qCurrent >= upper) qCurrent = upper - BigInt(1);
  const curveArray = encodeCurve([lower, upper, qCurrent]);

  const unsaltedPoolId = (BigInt(1) << BigInt(188));
  const tag0 = BigInt(token0Addr);
  const tag1 = BigInt(token1Addr);
  const poolGrowthPortion = BigInt("0x800000000000");

  // Initialize pool
  const poolInitData = delegateeContract.interface.encodeFunctionData("initialize", [
    unsaltedPoolId, tag0, tag1, poolGrowthPortion, kernelCompactArray, curveArray, "0x",
  ]);
  await (await nofeeswap.dispatch(poolInitData, { ...gasOverrides, nonce: nonce++ })).wait();

  const poolSalt = ethers.keccak256(ethers.solidityPacked(["address", "uint256"], [deployer.address, unsaltedPoolId]));
  const poolId = (unsaltedPoolId + (BigInt(poolSalt) << BigInt(188))) % X256;
  console.log(`   Pool initialized. ID: ${poolId}`);

  // Approve tokens to Operator
  await (await token0.approve(operatorAddr, ethers.MaxUint256, { nonce: nonce++ })).wait();
  await (await token1.approve(operatorAddr, ethers.MaxUint256, { nonce: nonce++ })).wait();
  console.log("   Tokens approved to Operator");

  // Add 10000 shares of liquidity via unlock -> operator
  function toBytes(v: bigint, l: number): number[] { let n = v; if (n < BigInt(0)) n = (BigInt(1) << BigInt(l * 8)) + n; const r: number[] = []; for (let i = l - 1; i >= 0; i--) { r[i] = Number(n & BigInt(0xFF)); n >>= BigInt(8); } return r; }
  function addrBytes(a: string): number[] { return toBytes(BigInt(a), 20); }
  function cat(...arrays: number[][]): number[] { return arrays.flat(); }
  function toHex(bytes: number[]): string { return "0x" + bytes.map(b => b.toString(16).padStart(2, "0")).join(""); }

  const shares = BigInt("10000000000000000000000"); // 10000 shares
  const tagShares = BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "int256", "int256"], [poolId, lower - X63, upper - X63]
  )));
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  const mintSeq: number[][] = [];
  mintSeq.push(cat([3], toBytes(shares, 32), [1])); // PUSH32 shares -> slot 1
  mintSeq.push(cat([53], toBytes(poolId, 32), toBytes(lower, 8), toBytes(upper, 8), [1], [2], [3], [4], toBytes(BigInt(0), 2))); // MODIFY_POSITION
  mintSeq.push(cat([45], addrBytes(token0Addr))); // SYNC token0
  mintSeq.push(cat([37], addrBytes(token0Addr), [3], addrBytes(nofeeswapAddr), [7], [0])); // TRANSFER token0
  mintSeq.push([47, 9, 10, 11]); // SETTLE
  mintSeq.push(cat([45], addrBytes(token1Addr))); // SYNC token1
  mintSeq.push(cat([37], addrBytes(token1Addr), [4], addrBytes(nofeeswapAddr), [8], [0])); // TRANSFER token1
  mintSeq.push([47, 12, 13, 14]); // SETTLE
  mintSeq.push(cat([50], toBytes(tagShares, 32), [1], [16])); // MODIFY_SINGLE_BALANCE

  const mintData = toHex(cat(toBytes(BigInt(deadline), 4), ...mintSeq));
  await (await nofeeswap.unlock(operatorAddr, mintData, { ...gasOverrides, nonce: nonce++ })).wait();
  console.log("   10000 shares liquidity added");

  // Set operator approval for ERC-6909 (needed for burn)
  await (await nofeeswap.setOperator(operatorAddr, true, { nonce: nonce++ })).wait();
  console.log("   Operator approved for ERC-6909 (burn ready)");

  // ===== Save deployed addresses =====
  const addresses = {
    deployerHelper: deployerHelperAddr,
    nofeeswap: nofeeswapAddr,
    nofeeswapDelegatee: delegateeAddr,
    operator: operatorAddr,
    weth9: weth9Addr,
    quoter: quoterAddr,
    token0: token0Addr,
    token1: token1Addr,
    token0Symbol: token0Addr === tokenAAddr ? "ALPHA" : "BETA",
    token1Symbol: token1Addr === tokenAAddr ? "ALPHA" : "BETA",
    deployer: deployer.address,
    poolId: poolId.toString(),
    chainId: Number((await provider.getNetwork()).chainId),
    rpcUrl: RPC_URL,
  };

  fs.writeFileSync(DEPLOY_OUTPUT, JSON.stringify(addresses, null, 2));
  console.log("");
  console.log("=== Deployment Complete ===");
  console.log(`Addresses saved to: ${DEPLOY_OUTPUT}`);
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
