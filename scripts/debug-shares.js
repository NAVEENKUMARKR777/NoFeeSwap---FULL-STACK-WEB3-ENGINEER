const { ethers } = require("ethers");
const fs = require("fs");

const addr = JSON.parse(fs.readFileSync("deployed-addresses.json", "utf8"));
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const nfsABI = JSON.parse(fs.readFileSync("contracts/abis/Nofeeswap.json", "utf8")).abi;
const nfs = new ethers.Contract(addr.nofeeswap, nfsABI, provider);
const user = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const X59 = 2n ** 59n, X60 = 2n ** 60n, X63 = 2n ** 63n, X256 = 2n ** 256n;
const spacing = 200n * 57643193118714n;
const sqrtPriceX96 = 67254909186229727392878661970n;
const X96 = 2n ** 96n;
const logPrice = BigInt(Math.floor(Number(X60) * Math.log(Number(sqrtPriceX96) / Number(X96))));
const logPriceOffsetted = logPrice + X63;
const lower = (logPriceOffsetted / spacing) * spacing;
const upper = lower + spacing;
const unsaltedPoolId = 1n << 188n;
const salt = ethers.keccak256(ethers.solidityPacked(["address", "uint256"], [user, unsaltedPoolId]));
const poolId = (unsaltedPoolId + (BigInt(salt) << 188n)) % X256;

async function main() {
  console.log("Pool ID:", poolId.toString().slice(0, 20) + "...");
  console.log("lower (offsetted):", lower.toString());
  console.log("upper (offsetted):", upper.toString());

  // The Python test computes tagShares = keccak256(abi.encode(poolId, qMin, qMax))
  // where qMin/qMax are the NON-offsetted logPriceMin/logPriceMax values
  // These are: (2^59) * ln(priceMin) and (2^59) * ln(priceMax)
  // NOT the offsetted curve values

  // From modifyPosition docs: logPriceMin = (2^59) * log(pMin)
  // The offsetted form used in the operator: lower_op = qMin + (1<<63) - logOffset*(1<<59)
  // Since logOffset=0: lower_op = qMin + (1<<63)
  // So qMin = lower_op - (1<<63) = lower - X63

  const qMin = lower - X63;
  const qMax = upper - X63;
  console.log("qMin (non-offset):", qMin.toString());
  console.log("qMax (non-offset):", qMax.toString());

  // Try different tagShares encodings
  const tag1 = BigInt(ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "int256", "int256"], [poolId, qMin, qMax])
  ));
  const bal1 = await nfs.balanceOf(user, tag1);
  console.log("\ntagShares(poolId, qMin, qMax):", bal1.toString());

  // Maybe it uses logPriceMin/Max directly (X59 * ln(price))
  const tag2 = BigInt(ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "int256", "int256"], [poolId, lower, upper])
  ));
  const bal2 = await nfs.balanceOf(user, tag2);
  console.log("tagShares(poolId, lower, upper):", bal2.toString());

  // Check ALL ERC-6909 Transfer events to see what tags were used
  const transferTopic = ethers.id("Transfer(address,address,address,uint256,uint256)");
  const modifyBalTopic = ethers.id("ModifyDoubleBalanceEvent(address,address,uint256,int256,uint256)");

  const logs = await provider.getLogs({
    address: addr.nofeeswap,
    fromBlock: 0,
    toBlock: "latest",
  });

  console.log("\nAll Nofeeswap events:");
  for (const log of logs) {
    if (log.topics[0] === transferTopic) {
      // Transfer(caller, from, to, tag, amount)
      const caller = "0x" + log.topics[1]?.slice(26);
      const from = "0x" + log.topics[2]?.slice(26);
      const to = "0x" + log.topics[3]?.slice(26);
      const data = ethers.AbiCoder.defaultAbiCoder().decode(["uint256", "uint256"], log.data);
      console.log(`  Transfer block=${log.blockNumber}: from=${from.slice(0,10)} to=${to.slice(0,10)} tag=${data[0].toString().slice(0,20)}... amount=${data[1]}`);
    }
  }
}
main();
