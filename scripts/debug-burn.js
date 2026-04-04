const { ethers } = require("ethers");
const fs = require("fs");
const addr = JSON.parse(fs.readFileSync("deployed-addresses.json", "utf8"));
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const deployer = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", provider);
const nfsABI = JSON.parse(fs.readFileSync("contracts/abis/Nofeeswap.json", "utf8")).abi;
const nfs = new ethers.Contract(addr.nofeeswap, nfsABI, deployer);

function toBytes(v, l) { let n = BigInt(v); if (n < 0n) n = (1n << BigInt(l * 8)) + n; const r = []; for (let i = l - 1; i >= 0; i--) { r[i] = Number(n & 0xFFn); n >>= 8n; } return r; }
function addrBytes(a) { return toBytes(BigInt(a), 20); }
function cat(...a) { return a.flat(); }
function hex(b) { return "0x" + b.map(x => x.toString(16).padStart(2, "0")).join(""); }
async function freshNonce() { return parseInt(await provider.send("eth_getTransactionCount", [deployer.address, "latest"]), 16); }

const PUSH32 = 3, NEG = 4, TAKE_TOKEN = 42, MODIFY_POSITION = 53;
const SYNC_TOKEN = 45, TRANSFER_FROM_PAYER_ERC20 = 37, SETTLE = 47;
const X59 = 2n ** 59n, X60 = 2n ** 60n, X63 = 2n ** 63n, X256 = 2n ** 256n;

async function main() {
  // Step 1: Get the actual qMin/qMax from the test-flow mint
  const spacing = 200n * 57643193118714n;
  const sqrtPriceX96 = 67254909186229727392878661970n;
  const X96 = 2n ** 96n;
  const logPrice = BigInt(Math.floor(Number(X60) * Math.log(Number(sqrtPriceX96) / Number(X96))));
  const lower = (logPrice + X63) / spacing * spacing;
  const upper = lower + spacing;
  const unsaltedPoolId = 1n << 188n;
  const salt = ethers.keccak256(ethers.solidityPacked(["address", "uint256"], [deployer.address, unsaltedPoolId]));
  const poolId = (unsaltedPoolId + (BigInt(salt) << 188n)) % X256;

  console.log("Pool:", poolId.toString().slice(0, 20) + "...");
  console.log("lower:", lower.toString());
  console.log("upper:", upper.toString());

  // Step 2: First do a fresh mint so we know we have shares
  console.log("\n--- Fresh Mint ---");
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const shares = 100000000000000000n; // 0.1

  const mintSeq = [];
  mintSeq.push(cat([PUSH32], toBytes(shares, 32), [1]));
  mintSeq.push(cat([MODIFY_POSITION], toBytes(poolId, 32), toBytes(lower, 8), toBytes(upper, 8), [1], [2], [3], [4], toBytes(0, 2)));
  mintSeq.push(cat([SYNC_TOKEN], addrBytes(addr.token0)));
  mintSeq.push(cat([TRANSFER_FROM_PAYER_ERC20], addrBytes(addr.token0), [3], addrBytes(addr.nofeeswap), [7], [0]));
  mintSeq.push([SETTLE, 9, 10, 11]);
  mintSeq.push(cat([SYNC_TOKEN], addrBytes(addr.token1)));
  mintSeq.push(cat([TRANSFER_FROM_PAYER_ERC20], addrBytes(addr.token1), [4], addrBytes(addr.nofeeswap), [8], [0]));
  mintSeq.push([SETTLE, 12, 13, 14]);
  // Skip MODIFY_SINGLE_BALANCE for now

  const mintData = hex(cat(toBytes(deadline, 4), ...mintSeq));
  try {
    const tx = await nfs.unlock(addr.operator, mintData, { gasLimit: 29000000n, nonce: await freshNonce() });
    const r = await tx.wait();
    console.log("Mint:", r.status === 1 ? "SUCCESS" : "FAILED", "gas:", r.gasUsed.toString());
  } catch (e) {
    console.log("Mint error:", e.message?.slice(0, 100));
  }

  // Step 3: Now try burn with the SAME lower/upper
  console.log("\n--- Burn ---");
  const burnShares = 50000000000000000n; // half of what we just minted

  const burnSeq = [];
  burnSeq.push(cat([PUSH32], toBytes(-burnShares, 32), [1]));
  burnSeq.push(cat([MODIFY_POSITION], toBytes(poolId, 32), toBytes(lower, 8), toBytes(upper, 8), [1], [2], [3], [4], toBytes(0, 2)));
  burnSeq.push([NEG, 3, 3]);
  burnSeq.push([NEG, 4, 4]);
  burnSeq.push(cat([TAKE_TOKEN], addrBytes(addr.token0), addrBytes(deployer.address), [3], [7]));
  burnSeq.push(cat([TAKE_TOKEN], addrBytes(addr.token1), addrBytes(deployer.address), [4], [8]));

  const burnData = hex(cat(toBytes(deadline, 4), ...burnSeq));

  // Test with eth_call first
  const iface = new ethers.Interface(["function unlock(address,bytes) payable returns (bytes)"]);
  const calldata = iface.encodeFunctionData("unlock", [addr.operator, burnData]);
  try {
    await provider.send("eth_call", [{ from: deployer.address, to: addr.nofeeswap, data: calldata, gas: "0x1BA8140" }, "latest"]);
    console.log("eth_call: SUCCESS!");
  } catch (e) {
    const d = e.info?.error?.data || "";
    const known = { "0x3bce3d40": "OutstandingAmount()", "0xf87815b3": "SafeMathError()", "0x0c21b20e": "BalanceOverflow()" };
    console.log("eth_call error:", known[d.slice(0, 10)] || d.slice(0, 40));
  }

  // If eth_call succeeds, do the real tx
  try {
    const tx = await nfs.unlock(addr.operator, burnData, { gasLimit: 29000000n, nonce: await freshNonce() });
    const r = await tx.wait();
    console.log("Burn:", r.status === 1 ? "SUCCESS" : "FAILED", "gas:", r.gasUsed.toString());
  } catch (e) {
    console.log("Burn tx error:", e.message?.slice(0, 100));
  }
}
main();
