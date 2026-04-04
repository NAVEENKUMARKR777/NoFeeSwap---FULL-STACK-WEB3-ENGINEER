const { ethers } = require("ethers");
const fs = require("fs");

const addr = JSON.parse(fs.readFileSync("deployed-addresses.json", "utf8"));
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const deployer = new ethers.Wallet(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  provider
);
const nfsABI = JSON.parse(fs.readFileSync("contracts/abis/Nofeeswap.json", "utf8")).abi;
const nfs = new ethers.Contract(addr.nofeeswap, nfsABI, deployer);
const GAS = { gasLimit: 29000000n };
async function freshNonce() {
  return parseInt(await provider.send("eth_getTransactionCount", [deployer.address, "latest"]), 16);
}

function toBytes(v, l) { let n = BigInt(v); if (n < 0n) n = (1n << BigInt(l * 8)) + n; const r = []; for (let i = l - 1; i >= 0; i--) { r[i] = Number(n & 0xFFn); n >>= 8n; } return r; }
function addrBytes(a) { return toBytes(BigInt(a), 20); }
function cat(...a) { return a.flat(); }
function hex(b) { return "0x" + b.map(x => x.toString(16).padStart(2, "0")).join(""); }

const PUSH32 = 3, NEG = 4, TAKE_TOKEN = 42, SYNC_TOKEN = 45, TRANSFER_FROM_PAYER_ERC20 = 37;
const SETTLE = 47, MODIFY_SINGLE_BALANCE = 50, MODIFY_POSITION = 53;
const X59 = 2n ** 59n, X60 = 2n ** 60n, X63 = 2n ** 63n, X64 = 2n ** 64n, X256 = 2n ** 256n;

const spacing = 200n * 57643193118714n;
const sqrtPriceX96 = 67254909186229727392878661970n;
const X96 = 2n ** 96n;
const logPrice = BigInt(Math.floor(Number(X60) * Math.log(Number(sqrtPriceX96) / Number(X96))));
const logPriceOffsetted = logPrice + X63;
const lower = (logPriceOffsetted / spacing) * spacing;
const upper = lower + spacing;
const unsaltedPoolId = 1n << 188n;
const salt = ethers.keccak256(ethers.solidityPacked(["address", "uint256"], [deployer.address, unsaltedPoolId]));
const poolId = (unsaltedPoolId + (BigInt(salt) << 188n)) % X256;

// Compute tagShares matching the Solidity: keccak256(poolId:32 || qMin:32 || qMax:32)
// qMin and qMax are the NON-offsetted values from _removeOffset
// _removeOffset(offsetted, poolId) = offsetted - (1<<63) + signextend(logOffset)*(1<<59)
const logOffset = Number((poolId >> 180n) % 256n);
const signedLogOffset = logOffset >= 128 ? logOffset - 256 : logOffset;
const qMin = lower - X63 + BigInt(signedLogOffset) * X59;
const qMax = upper - X63 + BigInt(signedLogOffset) * X59;

// The Solidity tag() function does: mstore(0, poolId); mstore(32, qMin); mstore(64, qMax); keccak256(0, 96)
// This is equivalent to abi.encode(poolId, qMin, qMax) since all are 32 bytes
const tagShares = BigInt(ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "int256", "int256"],
    [poolId, qMin, qMax]
  )
));

async function main() {
  console.log("=== Burn Fix Investigation ===");
  console.log("poolId:", poolId.toString().slice(0, 20) + "...");
  console.log("lower (offsetted):", lower.toString());
  console.log("upper (offsetted):", upper.toString());
  console.log("qMin (non-offset):", qMin.toString());
  console.log("qMax (non-offset):", qMax.toString());
  console.log("tagShares:", tagShares.toString().slice(0, 20) + "...");

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const sharesSlot = 1, successSlot = 2, amt0Slot = 3, amt1Slot = 4;
  const sTr0 = 7, sTr1 = 8, vS0 = 9, sS0 = 10, rS0 = 11, vS1 = 12, sS1 = 13, rS1 = 14;
  const sharesSuccessSlot = 16;

  // Step 1: Init pool
  console.log("\n--- 1. Init Pool ---");
  const delABI = JSON.parse(fs.readFileSync("contracts/abis/NofeeswapDelegatee.json", "utf8")).abi;
  const del = new ethers.Contract(addr.nofeeswapDelegatee, delABI, deployer);

  function encodeKernelCompact(kernel) {
    let k = 0n, i = 0;
    for (const [pos, height] of kernel.slice(1)) { k = (k << 16n) + height; k = (k << 64n) + pos; i += 80; }
    if (i % 256 !== 0) { k = k << BigInt(256 - (i % 256)); i += 256 - (i % 256); }
    const l = i / 256; const r = new Array(l).fill(0n);
    for (let j = l - 1; j >= 0; j--) { r[j] = k % X256; k = k / X256; }
    return r;
  }
  function encodeCurve(curve) {
    const len = Math.ceil(curve.length / 4);
    const e = new Array(len).fill(0n);
    let shift = 192n, idx = 0;
    for (const p of curve) { e[Math.floor(idx / 4)] += p << shift; shift -= 64n; if (shift < 0n) shift = 192n; idx++; }
    return e;
  }

  const kca = encodeKernelCompact([[0n, 0n], [spacing, 2n ** 15n]]);
  let qCurrent = logPriceOffsetted;
  if (qCurrent <= lower) qCurrent = lower + 1n;
  if (qCurrent >= upper) qCurrent = upper - 1n;
  const ca = encodeCurve([lower, upper, qCurrent]);
  const pgp = BigInt("0x800000000000");
  const initData = del.interface.encodeFunctionData("initialize", [unsaltedPoolId, BigInt(addr.token0), BigInt(addr.token1), pgp, kca, ca, "0x"]);
  let tx = await nfs.dispatch(initData, { ...GAS, nonce: await freshNonce() });
  let r = await tx.wait();
  console.log("Init:", r.status === 1 ? "SUCCESS" : "FAILED");

  // Step 2: Approve tokens to OPERATOR
  console.log("\n--- 2. Approve ---");
  const erc20ABI = JSON.parse(fs.readFileSync("contracts/abis/MockERC20.json", "utf8")).abi;
  const t0 = new ethers.Contract(addr.token0, erc20ABI, deployer);
  const t1 = new ethers.Contract(addr.token1, erc20ABI, deployer);
  await (await t0.approve(addr.operator, ethers.MaxUint256, { nonce: await freshNonce() })).wait();
  await (await t1.approve(addr.operator, ethers.MaxUint256, { nonce: await freshNonce() })).wait();
  console.log("Approved");

  // Step 3: Mint WITH tagShares
  console.log("\n--- 3. Mint ---");
  const shares = 1000000000000000000n;
  const mintSeq = [];
  mintSeq.push(cat([PUSH32], toBytes(shares, 32), [sharesSlot]));
  mintSeq.push(cat([MODIFY_POSITION], toBytes(poolId, 32), toBytes(lower, 8), toBytes(upper, 8),
    [sharesSlot], [successSlot], [amt0Slot], [amt1Slot], toBytes(0, 2)));
  mintSeq.push(cat([SYNC_TOKEN], addrBytes(addr.token0)));
  mintSeq.push(cat([TRANSFER_FROM_PAYER_ERC20], addrBytes(addr.token0), [amt0Slot], addrBytes(addr.nofeeswap), [sTr0], [0]));
  mintSeq.push([SETTLE, vS0, sS0, rS0]);
  mintSeq.push(cat([SYNC_TOKEN], addrBytes(addr.token1)));
  mintSeq.push(cat([TRANSFER_FROM_PAYER_ERC20], addrBytes(addr.token1), [amt1Slot], addrBytes(addr.nofeeswap), [sTr1], [0]));
  mintSeq.push([SETTLE, vS1, sS1, rS1]);
  mintSeq.push(cat([MODIFY_SINGLE_BALANCE], toBytes(tagShares, 32), [sharesSlot], [sharesSuccessSlot]));

  const mintData = hex(cat(toBytes(deadline, 4), ...mintSeq));
  tx = await nfs.unlock(addr.operator, mintData, { ...GAS, nonce: await freshNonce() });
  r = await tx.wait();
  console.log("Mint:", r.status === 1 ? "SUCCESS" : "FAILED", "gas:", r.gasUsed?.toString());

  // Check share balance
  const bal = await nfs.balanceOf(deployer.address, tagShares);
  console.log("Share balance after mint:", bal.toString());

  // Also check Transfer events to see what tag was actually used
  const transferTopic = ethers.id("Transfer(address,address,address,uint256,uint256)");
  const logs = await provider.getLogs({
    address: addr.nofeeswap,
    topics: [transferTopic],
    fromBlock: r.blockNumber,
    toBlock: r.blockNumber,
  });
  for (const log of logs) {
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["uint256", "uint256"], log.data);
    const tag = log.topics[3]; // indexed tag
    console.log("  Transfer event: tag=", tag?.slice(0, 20) + "...", "amount=", decoded[1]?.toString());
  }

  // Step 3.5: Set Operator approval for ERC-6909 (required for burn's MODIFY_SINGLE_BALANCE)
  console.log("\n--- 3.5. setOperator ---");
  tx = await nfs.setOperator(addr.operator, true, { nonce: await freshNonce() });
  await tx.wait();
  console.log("Operator approved for ERC-6909");

  // Step 4: Burn
  console.log("\n--- 4. Burn ---");
  const burnShares = 500000000000000000n;
  const burnSeq = [];
  burnSeq.push(cat([PUSH32], toBytes(-burnShares, 32), [sharesSlot]));
  burnSeq.push(cat([MODIFY_POSITION], toBytes(poolId, 32), toBytes(lower, 8), toBytes(upper, 8),
    [sharesSlot], [successSlot], [amt0Slot], [amt1Slot], toBytes(0, 2)));
  burnSeq.push([NEG, amt0Slot, amt0Slot]);
  burnSeq.push([NEG, amt1Slot, amt1Slot]);
  burnSeq.push(cat([TAKE_TOKEN], addrBytes(addr.token0), addrBytes(deployer.address), [amt0Slot], [sS0]));
  burnSeq.push(cat([TAKE_TOKEN], addrBytes(addr.token1), addrBytes(deployer.address), [amt1Slot], [sS1]));
  burnSeq.push(cat([MODIFY_SINGLE_BALANCE], toBytes(tagShares, 32), [sharesSlot], [sharesSuccessSlot]));

  const burnData = hex(cat(toBytes(deadline, 4), ...burnSeq));

  // eth_call first
  const iface = new ethers.Interface(["function unlock(address,bytes) payable returns (bytes)"]);
  const calldata = iface.encodeFunctionData("unlock", [addr.operator, burnData]);
  try {
    await provider.send("eth_call", [{ from: deployer.address, to: addr.nofeeswap, data: calldata, gas: "0x1BA8140" }, "latest"]);
    console.log("eth_call: SUCCESS!");

    tx = await nfs.unlock(addr.operator, burnData, { ...GAS, nonce: await freshNonce() });
    r = await tx.wait();
    console.log("Burn:", r.status === 1 ? "SUCCESS" : "FAILED", "gas:", r.gasUsed?.toString());
  } catch (e) {
    const d = e.info?.error?.data || "";
    const known = { "0x3bce3d40": "OutstandingAmount()", "0xf87815b3": "SafeMathError()", "0x0c21b20e": "BalanceOverflow(uint256)" };
    console.log("Burn error:", known[d.slice(0, 10)] || d.slice(0, 80));
  }

  // Final balances
  const b0 = await t0.balanceOf(deployer.address);
  const b1 = await t1.balanceOf(deployer.address);
  console.log("\nFinal Token0:", ethers.formatEther(b0));
  console.log("Final Token1:", ethers.formatEther(b1));
  const shareBal = await nfs.balanceOf(deployer.address, tagShares);
  console.log("Final shares:", shareBal.toString());
}

main().catch(e => console.error(e.message?.slice(0, 300)));
