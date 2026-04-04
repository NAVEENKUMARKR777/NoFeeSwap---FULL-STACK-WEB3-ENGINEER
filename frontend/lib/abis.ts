// ABI definitions for NoFeeSwap protocol contracts

export const NOFEESWAP_ABI = [
  // unlock
  {
    type: "function",
    name: "unlock",
    inputs: [
      { name: "unlockTarget", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
    stateMutability: "payable",
  },
  // dispatch
  {
    type: "function",
    name: "dispatch",
    inputs: [{ name: "input", type: "bytes" }],
    outputs: [
      { name: "output0", type: "int256" },
      { name: "output1", type: "int256" },
    ],
    stateMutability: "nonpayable",
  },
  // swap
  {
    type: "function",
    name: "swap",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "amountSpecified", type: "int256" },
      { name: "logPriceLimit", type: "int256" },
      { name: "zeroForOne", type: "uint256" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [
      { name: "amount0", type: "int256" },
      { name: "amount1", type: "int256" },
    ],
    stateMutability: "nonpayable",
  },
  // settle
  {
    type: "function",
    name: "settle",
    inputs: [],
    outputs: [{ name: "paid", type: "uint256" }],
    stateMutability: "payable",
  },
  // sync(address)
  {
    type: "function",
    name: "sync",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // take(address,address,uint256)
  {
    type: "function",
    name: "take",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // setOperator
  {
    type: "function",
    name: "setOperator",
    inputs: [
      { name: "spender", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  // balanceOf
  {
    type: "function",
    name: "balanceOf",
    inputs: [
      { name: "owner", type: "address" },
      { name: "tag", type: "uint256" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
    stateMutability: "view",
  },
  // events
  {
    type: "event",
    name: "Initialize",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "tag0", type: "uint256", indexed: true },
      { name: "tag1", type: "uint256", indexed: true },
      { name: "data", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "data", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ModifyPosition",
    inputs: [
      { name: "poolId", type: "uint256", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "data", type: "bytes32[6]", indexed: false },
    ],
  },
] as const;

export const NOFEESWAP_DELEGATEE_ABI = [
  // initialize
  {
    type: "function",
    name: "initialize",
    inputs: [
      { name: "unsaltedPoolId", type: "uint256" },
      { name: "tag0", type: "uint256" },
      { name: "tag1", type: "uint256" },
      { name: "poolGrowthPortion", type: "uint256" },
      { name: "kernelCompactArray", type: "uint256[]" },
      { name: "curveArray", type: "uint256[]" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // modifyPosition
  {
    type: "function",
    name: "modifyPosition",
    inputs: [
      { name: "poolId", type: "uint256" },
      { name: "logPriceMin", type: "int256" },
      { name: "logPriceMax", type: "int256" },
      { name: "shares", type: "int256" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [
      { name: "amount0", type: "int256" },
      { name: "amount1", type: "int256" },
    ],
    stateMutability: "nonpayable",
  },
  // modifyProtocol
  {
    type: "function",
    name: "modifyProtocol",
    inputs: [{ name: "protocol", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const OPERATOR_ABI = [
  {
    type: "function",
    name: "nofeeswap",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "permit2",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "weth9",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoter",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  // unlockCallback
  {
    type: "function",
    name: "unlockCallback",
    inputs: [
      { name: "caller", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "returnData", type: "bytes" }],
    stateMutability: "payable",
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;
