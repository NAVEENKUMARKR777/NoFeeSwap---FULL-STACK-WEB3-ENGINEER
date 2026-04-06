const fs = require("fs");
const path = require("path");

const contracts = [
  ["core/out/Nofeeswap.sol/Nofeeswap.json", "Nofeeswap"],
  ["core/out/NofeeswapDelegatee.sol/NofeeswapDelegatee.json", "NofeeswapDelegatee"],
  ["core/out/DeployerHelper.sol/DeployerHelper.json", "DeployerHelper"],
  ["operator/out/Operator.sol/Operator.json", "Operator"],
  ["operator/out/MockQuoter.sol/MockQuoter.json", "MockQuoter"],
  ["out/MockERC20.sol/MockERC20.json", "MockERC20"],
  ["out/MockWETH9.sol/MockWETH9.json", "MockWETH9"],
];

const abiDir = path.join(__dirname, "..", "abis");
if (!fs.existsSync(abiDir)) fs.mkdirSync(abiDir);

for (const [filePath, name] of contracts) {
  const fullPath = path.join(__dirname, "..", filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`${name}: SKIP (not found at ${filePath})`);
    continue;
  }
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  fs.writeFileSync(
    path.join(abiDir, `${name}.json`),
    JSON.stringify(
      { abi: data.abi, bytecode: data.bytecode?.object || data.bytecode },
      null,
      2
    )
  );
  console.log(`${name}: exported (${data.abi.length} ABI entries)`);
}
