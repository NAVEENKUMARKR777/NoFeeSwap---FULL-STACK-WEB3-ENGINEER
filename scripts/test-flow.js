const { ethers } = require("ethers");
const fs = require("fs");

const addr = JSON.parse(fs.readFileSync("deployed-addresses.json", "utf8"));
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const deployer = new ethers.Wallet(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  provider
);

const nfsABI = JSON.parse(fs.readFileSync("contracts/abis/Nofeeswap.json", "utf8")).abi;
const delABI = JSON.parse(fs.readFileSync("contracts/abis/NofeeswapDelegatee.json", "utf8")).abi;
const erc20ABI = JSON.parse(fs.readFileSync("contracts/abis/MockERC20.json", "utf8")).abi;

const nfs = new ethers.Contract(addr.nofeeswap, nfsABI, deployer);
const del = new ethers.Contract(addr.nofeeswapDelegatee, delABI, deployer);
const GAS = { gasLimit: 29000000n };

// Helpers
function toBytes(value, length) {
  let v = BigInt(value);
  if (v < 0n) v = (1n << BigInt(length * 8)) + v;
  const result = [];
  for (let i = length - 1; i >= 0; i--) { result[i] = Number(v & 0xFFn); v >>= 8n; }
  return result;
}
function addrBytes(a) { return toBytes(BigInt(a), 20); }
function cat(...arrs) { return arrs.flat(); }
function hex(bytes) { return "0x" + bytes.map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function freshNonce() {
  const h = await provider.send("eth_getTransactionCount", [deployer.address, "latest"]);
  return parseInt(h, 16);
}

const PUSH32=3, NEG=4, LT=13, ISZERO=16, JUMPDEST=20, JUMP=21, REVERT=59;
const TRANSFER_FROM_PAYER_ERC20=37, TAKE_TOKEN=42, SYNC_TOKEN=45, SETTLE=47;
const MODIFY_SINGLE_BALANCE=50, SWAP=52, MODIFY_POSITION=53;
const X59=2n**59n, X60=2n**60n, X63=2n**63n, X64=2n**64n, X256=2n**256n;

function encodeKernelCompact(kernel) {
  let k = 0n, i = 0;
  for (const [pos, height] of kernel.slice(1)) { k = (k << 16n) + height; k = (k << 64n) + pos; i += 80; }
  if (i % 256 !== 0) { k = k << BigInt(256 - (i % 256)); i += 256 - (i % 256); }
  const l = i / 256;
  const r = new Array(l).fill(0n);
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

async function main() {
  console.log("=== Full Flow Test ===\n");

  // 1. Init Pool
  const spacing = 200n * 57643193118714n;
  const kernel = [[0n, 0n], [spacing, 2n ** 15n]];
  const kca = encodeKernelCompact(kernel);

  const sqrtPriceX96 = 67254909186229727392878661970n;
  const X96 = 2n ** 96n;
  const logPrice = BigInt(Math.floor(Number(X60) * Math.log(Number(sqrtPriceX96) / Number(X96))));
  const logPriceOffsetted = logPrice + X63;
  const lower = (logPriceOffsetted / spacing) * spacing;
  const upper = lower + spacing;
  let qCurrent = logPriceOffsetted;
  if (qCurrent <= lower) qCurrent = lower + 1n;
  if (qCurrent >= upper) qCurrent = upper - 1n;
  const ca = encodeCurve([lower, upper, qCurrent]);

  const unsaltedPoolId = 1n << 188n;
  const tag0 = BigInt(addr.token0), tag1 = BigInt(addr.token1);
  const pgp = BigInt("0x800000000000");

  const initData = del.interface.encodeFunctionData("initialize", [unsaltedPoolId, tag0, tag1, pgp, kca, ca, "0x"]);
  let tx = await nfs.dispatch(initData, { ...GAS, nonce: await freshNonce() });
  let r = await tx.wait();
  console.log("1. Init Pool:", r.status === 1 ? "SUCCESS" : "FAILED", "gas:", r.gasUsed.toString());

  const salt = ethers.keccak256(ethers.solidityPacked(["address", "uint256"], [deployer.address, unsaltedPoolId]));
  const poolId = (unsaltedPoolId + (BigInt(salt) << 188n)) % X256;
  console.log("   Pool ID:", poolId.toString().slice(0, 20) + "...");

  // 2. Approve
  const t0 = new ethers.Contract(addr.token0, erc20ABI, deployer);
  const t1 = new ethers.Contract(addr.token1, erc20ABI, deployer);
  await (await t0.approve(addr.operator, ethers.MaxUint256, { nonce: await freshNonce() })).wait();
  await (await t1.approve(addr.operator, ethers.MaxUint256, { nonce: await freshNonce() })).wait();
  console.log("2. Tokens approved");

  // 3. Mint via unlock -> operator
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const sharesSlot = 1, successSlot = 2, amt0Slot = 3, amt1Slot = 4;
  const sTr0 = 7, sTr1 = 8, vS0 = 9, sS0 = 10, rS0 = 11, vS1 = 12, sS1 = 13, rS1 = 14;

  const shares = 1000000000000000000n;
  const sharesSuccessSlot = 16;

  // Compute tagShares = keccak256(abi.encode(poolId, qMin, qMax))
  // qMin/qMax are non-offsetted: logPriceMin = (2^59)*ln(price)
  const _logOffset = Number((poolId >> 180n) % 256n);
  const _signedLogOffset = _logOffset >= 128 ? _logOffset - 256 : _logOffset;
  const _qMinNonOffset = lower - X63 + BigInt(_signedLogOffset) * X59;
  const _qMaxNonOffset = upper - X63 + BigInt(_signedLogOffset) * X59;
  const tagShares = BigInt(ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "int256", "int256"],
      [poolId, _qMinNonOffset, _qMaxNonOffset]
    )
  ));

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
  // MODIFY_SINGLE_BALANCE for ERC-6909 shares tracking
  mintSeq.push(cat([MODIFY_SINGLE_BALANCE], toBytes(tagShares, 32), [sharesSlot], [sharesSuccessSlot]));

  const mintData = hex(cat(toBytes(deadline, 4), ...mintSeq));
  try {
    tx = await nfs.unlock(addr.operator, mintData, { ...GAS, nonce: await freshNonce() });
    r = await tx.wait();
    console.log("3. Mint:", r.status === 1 ? "SUCCESS" : "FAILED", "gas:", r.gasUsed.toString());
  } catch (e) { console.log("3. Mint ERROR:", e.message?.slice(0, 200)); }

  // 4. Swap via unlock -> operator
  const amtSpecSlot = 15, zeroSlot = 100, logicSlot = 200;
  const swapAmt = ethers.parseEther("0.01");
  // limitOffsetted = limit + (1<<63) for logOffset=0
  // For zeroForOne=1 (price decreases), use ln(0.01) as low limit
  const limitNonOffset = BigInt(Math.floor(Math.log(0.01) * Number(X59)));
  const limitOff = limitNonOffset + X63; // = 6568672166954784256n
  const zeroForOne = 1;

  // Matching Python exactly: set placeholders first, then overwrite JUMPs
  const s = new Array(27).fill(null).map(() => []);
  s[0] = cat([PUSH32], toBytes(swapAmt, 32), [amtSpecSlot]);
  s[1] = cat([SWAP], toBytes(poolId, 32), [amtSpecSlot], toBytes(limitOff, 8), [zeroForOne], [zeroSlot], [successSlot], [amt0Slot], [amt1Slot], toBytes(0, 2));
  s[2] = [0, 0, 0, 0]; // placeholder JUMP (4 bytes)
  s[3] = [REVERT];
  s[4] = [JUMPDEST];
  // Now overwrite s[2] with correct target
  s[2] = cat([JUMP], toBytes(s.slice(0, 4).flat().length, 2), [successSlot]);

  s[5] = [LT, zeroSlot, amt0Slot, logicSlot];
  s[6] = [0, 0, 0, 0]; // placeholder
  s[7] = [NEG, amt0Slot, amt0Slot];
  s[8] = cat([TAKE_TOKEN], addrBytes(addr.token0), addrBytes(deployer.address), [amt0Slot], [sS0]);
  s[9] = [JUMPDEST];
  s[6] = cat([JUMP], toBytes(s.slice(0, 9).flat().length, 2), [logicSlot]);

  s[10] = [ISZERO, logicSlot, logicSlot];
  s[11] = [0, 0, 0, 0]; // placeholder
  s[12] = cat([SYNC_TOKEN], addrBytes(addr.token0));
  s[13] = cat([TRANSFER_FROM_PAYER_ERC20], addrBytes(addr.token0), [amt0Slot], addrBytes(addr.nofeeswap), [sTr0], [0]);
  s[14] = [SETTLE, vS0, sS0, rS0];
  s[15] = [JUMPDEST];
  s[11] = cat([JUMP], toBytes(s.slice(0, 15).flat().length, 2), [logicSlot]);

  s[16] = [LT, zeroSlot, amt1Slot, logicSlot];
  s[17] = [0, 0, 0, 0]; // placeholder
  s[18] = [NEG, amt1Slot, amt1Slot];
  s[19] = cat([TAKE_TOKEN], addrBytes(addr.token1), addrBytes(deployer.address), [amt1Slot], [sS1]);
  s[20] = [JUMPDEST];
  s[17] = cat([JUMP], toBytes(s.slice(0, 20).flat().length, 2), [logicSlot]);

  s[21] = [ISZERO, logicSlot, logicSlot];
  s[22] = [0, 0, 0, 0]; // placeholder
  s[23] = cat([SYNC_TOKEN], addrBytes(addr.token1));
  s[24] = cat([TRANSFER_FROM_PAYER_ERC20], addrBytes(addr.token1), [amt1Slot], addrBytes(addr.nofeeswap), [sTr1], [0]);
  s[25] = [SETTLE, vS1, sS1, rS1];
  s[26] = [JUMPDEST];
  s[22] = cat([JUMP], toBytes(s.slice(0, 26).flat().length, 2), [logicSlot]);

  const swapData = hex(cat(toBytes(deadline, 4), ...s));
  try {
    tx = await nfs.unlock(addr.operator, swapData, { ...GAS, nonce: await freshNonce() });
    r = await tx.wait();
    console.log("4. Swap:", r.status === 1 ? "SUCCESS" : "FAILED", "gas:", r.gasUsed.toString());
  } catch (e) { console.log("4. Swap ERROR:", e.message?.slice(0, 300)); }

  // Final balances
  const b0 = await t0.balanceOf(deployer.address);
  const b1 = await t1.balanceOf(deployer.address);
  console.log("\nFinal Balances:");
  console.log("  Token0:", ethers.formatEther(b0));
  console.log("  Token1:", ethers.formatEther(b1));
}

main().catch((e) => console.error(e.message?.slice(0, 300)));
