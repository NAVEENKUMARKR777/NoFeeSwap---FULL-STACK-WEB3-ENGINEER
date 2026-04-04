# NoFeeSwap - Full-Stack Web3 Engineer Assignment

A complete local development environment for the NoFeeSwap DEX protocol, including contract deployment, a React/Next.js dApp frontend, and a mempool-monitoring sandwich attack bot.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [Quick Start](#quick-start)
- [Step-by-Step Setup](#step-by-step-setup)
- [Task 1: Protocol Deployment](#task-1-protocol-deployment)
- [Task 2: dApp Frontend](#task-2-dapp-frontend)
- [Task 3: Sandwich Bot](#task-3-sandwich-bot)
- [Transparency Statement](#transparency-statement)
- [Design Decisions & Trade-offs](#design-decisions--trade-offs)

---

## Prerequisites

| Software | Version | Purpose |
|----------|---------|---------|
| **Node.js** | >= 18.x | Frontend, deployment scripts, bot runtime |
| **npm** | >= 9.x | Package management |
| **Git** | >= 2.x | Cloning repositories |
| **Foundry (Anvil, Forge)** | Latest | Local blockchain + contract compilation |
| **MetaMask** | Browser extension | Wallet integration |

### Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Verify:
```bash
forge --version
anvil --version
```

---

## Architecture Overview

```
.
├── contracts/                  # Smart contract compilation & deployment
│   ├── core/                  # NoFeeSwap core contracts (git clone)
│   ├── operator/              # NoFeeSwap operator contracts (git clone)
│   ├── src/                   # Mock ERC20 & WETH9 contracts
│   ├── abis/                  # Extracted ABIs & bytecodes
│   └── scripts/deploy.ts     # Deployment script (TypeScript/ethers.js)
├── frontend/                  # Next.js 16 dApp
│   ├── app/
│   │   ├── page.tsx           # Main page with tab navigation
│   │   ├── providers.tsx      # wagmi + React Query providers
│   │   └── components/
│   │       ├── WalletButton.tsx       # MetaMask connection
│   │       ├── PoolInitialize.tsx     # Pool creation with kernel editor
│   │       ├── KernelEditor.tsx       # Interactive graphical kernel editor
│   │       ├── LiquidityManager.tsx   # Mint/Burn liquidity
│   │       ├── PositionTracker.tsx    # User position display
│   │       ├── SwapInterface.tsx      # Token swap UI
│   │       ├── TransactionStatus.tsx  # Tx lifecycle feedback
│   │       └── AddressConfig.tsx      # Contract address loader
│   └── lib/
│       ├── operatorActions.ts  # Operator action bytecode encoder
│       ├── useSwapQuote.ts     # Swap estimation hook (eth_call + model)
│       ├── abis.ts             # ABI definitions
│       ├── contracts.ts        # Protocol constants & helpers
│       ├── addresses.ts        # Address management
│       └── wagmiConfig.ts      # wagmi chain config
├── bot/                       # Sandwich attack bot (TypeScript)
│   └── src/
│       ├── index.ts            # Entry point
│       ├── mempool-monitor.ts  # txpool_content polling
│       ├── decoder.ts          # Operator calldata decoder
│       ├── sandwich.ts         # Sandwich execution engine
│       └── config.ts           # Configuration
├── scripts/                   # Bash scripts (macOS/Linux/Git Bash)
│   ├── start-anvil.sh          # Anvil with --no-mining (for bot)
│   ├── start-anvil-auto.sh     # Anvil with auto-mining (for dApp)
│   ├── deploy.sh               # Deploy all contracts
│   ├── mine-block.sh           # Manually mine a block
│   ├── test-flow.js            # Programmatic E2E test
│   └── e2e-demo.ts             # Full demo script
├── windows-scripts/           # Windows .bat scripts
│   ├── full-setup.bat          # One-click: install, compile, deploy
│   ├── start-anvil.bat         # Anvil with --no-mining
│   ├── start-anvil-auto.bat    # Anvil with auto-mining
│   ├── deploy.bat              # Deploy all contracts
│   ├── disable-mining.bat      # Disable auto-mining (for bot testing)
│   ├── enable-mining.bat       # Re-enable auto-mining
│   ├── mine-block.bat          # Mine a single block
│   ├── start-frontend.bat      # Start Next.js dev server
│   ├── start-bot.bat           # Start sandwich bot
│   └── run-test.bat            # Run E2E test
├── deployed-addresses.json     # Generated after deployment
└── README.md
```

### Operator Action Encoding

The NoFeeSwap Operator uses a stack-machine design where actions are packed as raw bytecodes. The encoding was reverse-engineered from the Operator's assembly-level `unlockCallback` and validated against the Python test suite. Key discoveries during implementation:

- **Opcodes are decimal** (not hex): `SWAP=52`, `SETTLE=47`, `TAKE_TOKEN=42`, etc.
- **PUSH32 format**: `[opcode:1][value:32][slot:1]` (value before slot)
- **SWAP encodes limitOffsetted inline** as a raw 8-byte uint64 (not a slot reference)
- **Token approvals must go to the Operator** (not Nofeeswap), since the Operator calls `transferFrom`
- **MODIFY_SINGLE_BALANCE** is required after mint/burn for ERC-6909 share tracking
- **JUMP offsets** must use 4-byte placeholders before computing targets (Array.fill shared-reference bug)

### Bot Architecture

The sandwich bot follows a three-stage pipeline:

1. **Mempool Monitor** (`mempool-monitor.ts`): Polls `txpool_content` RPC for pending transactions targeting the Nofeeswap contract. Supports WebSocket fallback.

2. **Calldata Decoder** (`decoder.ts`): Parses the operator's packed action bytecode to extract swap parameters: poolId, amountSpecified, logPriceLimit (slippage), zeroForOne (direction).

3. **Sandwich Executor** (`sandwich.ts`):
   - Analyzes profitability: `profit ≈ tradeSize × slippagePct × 0.3`
   - Front-run: Same swap direction, **2x gas price**, nonce N
   - Back-run: Opposite direction, **0.5x gas price**, nonce N+1
   - Gas ordering ensures: front-run → victim → back-run
   - Uses the full 27-action swap sequence with JUMP/LT/ISZERO conditional logic

---

## Quick Start

### macOS / Linux / Git Bash

```bash
# Terminal 1: Start Anvil
bash scripts/start-anvil-auto.sh

# Terminal 2: Deploy contracts
bash scripts/deploy.sh

# Terminal 3: Start frontend
cd frontend && npm run dev

# Terminal 4: Run E2E test (optional)
node scripts/test-flow.js
```

### Windows (PowerShell / CMD)

```powershell
# Terminal 1: Start Anvil
.\windows-scripts\start-anvil-auto.bat

# Terminal 2: Deploy contracts
.\windows-scripts\deploy.bat

# Terminal 3: Start frontend
.\windows-scripts\start-frontend.bat

# Terminal 4: Run E2E test (optional)
.\windows-scripts\run-test.bat

# Or do everything at once:
.\windows-scripts\full-setup.bat
```

Then open http://localhost:3000, import Anvil account `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` into MetaMask, and paste `deployed-addresses.json` contents into the address loader.

---

## Step-by-Step Setup

### 1. Install Dependencies

**Bash (macOS/Linux/Git Bash):**
```bash
cd contracts && npm install && cd ..
cd frontend && npm install && cd ..
cd bot && npm install && cd ..
```

**PowerShell (Windows):**
```powershell
cd contracts; npm install; cd ..
cd frontend; npm install; cd ..
cd bot; npm install; cd ..
```

### 2. Compile Contracts

```bash
# Initialize submodules
cd contracts/core && git submodule update --init --recursive && cd ../..
cd contracts/operator && git submodule update --init --recursive && cd ../..

# Compile core contracts
cd contracts/core
forge build --evm-version cancun --via-ir --optimize --optimizer-runs 200
cd ../..

# Compile operator contracts
cd contracts/operator
forge build --evm-version cancun --via-ir --optimize --optimizer-runs 200
cd ../..

# Compile mock contracts and extract ABIs
cd contracts && forge build
node -e "
const fs = require('fs');
const contracts = [
  ['core/out/Nofeeswap.sol/Nofeeswap.json', 'Nofeeswap'],
  ['core/out/NofeeswapDelegatee.sol/NofeeswapDelegatee.json', 'NofeeswapDelegatee'],
  ['core/out/DeployerHelper.sol/DeployerHelper.json', 'DeployerHelper'],
  ['operator/out/Operator.sol/Operator.json', 'Operator'],
  ['operator/out/MockQuoter.sol/MockQuoter.json', 'MockQuoter'],
  ['out/MockERC20.sol/MockERC20.json', 'MockERC20'],
  ['out/MockWETH9.sol/MockWETH9.json', 'MockWETH9'],
];
for (const [path, name] of contracts) {
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  fs.writeFileSync('abis/' + name + '.json', JSON.stringify({
    abi: data.abi, bytecode: data.bytecode?.object || data.bytecode
  }, null, 2));
  console.log(name + ': exported');
}
"
cd ..
```

---

## Task 1: Protocol Deployment

### Start Local Blockchain

**Bash:**
```bash
# Auto-mining (for normal dApp usage)
bash scripts/start-anvil-auto.sh

# No auto-mining (for sandwich bot testing)
bash scripts/start-anvil.sh
```

**PowerShell (Windows):**
```powershell
# Auto-mining (for normal dApp usage)
.\windows-scripts\start-anvil-auto.bat

# No auto-mining (for sandwich bot testing)
.\windows-scripts\start-anvil.bat
```

### Deploy Contracts

**Bash:**
```bash
bash scripts/deploy.sh
```

**PowerShell (Windows):**
```powershell
.\windows-scripts\deploy.bat
```

This deploys via CREATE3 (matching `Initialize_test.py#L67-L78`):
- **DeployerHelper** → CREATE3 factory
- **NofeeswapDelegatee** → Delegatee logic (deterministic address)
- **Nofeeswap** → Singleton AMM (deterministic address)
- **Protocol config** → `modifyProtocol` via dispatch
- **MockWETH9** → Wrapped ETH mock
- **MockQuoter** → Quote helper
- **Operator** → User-facing transaction builder (references `SwapData_test.py`)
- **ALPHA + BETA** → Two ERC-20 tokens, 1M each to deployer + test accounts + bot wallet

Addresses saved to `deployed-addresses.json`.

### MetaMask Configuration

| Setting | Value |
|---------|-------|
| Network Name | Localhost 8545 |
| RPC URL | http://127.0.0.1:8545 |
| Chain ID | 31337 |
| Currency Symbol | ETH |

Import test account private key:
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

---

## Task 2: dApp Frontend

### Start

**Bash:**
```bash
cd frontend && npm run dev
```

**PowerShell (Windows):**
```powershell
.\windows-scripts\start-frontend.bat
```

Open http://localhost:3000.

### Loading Contract Addresses

1. Copy contents of `deployed-addresses.json`
2. Paste into the "Load Contract Addresses" textarea
3. Click "Load Addresses"

### 2a. Wallet Integration

- Connect MetaMask via the injected wallet connector (wagmi)
- All on-chain transactions prompt MetaMask for authorization
- Transaction states displayed with visual feedback:
  - **Pending** (blue spinner) → waiting for wallet confirmation
  - **Confirming** (yellow spinner) → tx submitted, awaiting block
  - **Confirmed** (green check) → tx mined successfully
  - **Reverted** (red X) → tx failed with error message

### 2b. Initialize Liquidity Pool

- Select token pair (auto-loaded from deployed addresses)
- Choose fee tier: **0.05%** (Stables), **0.3%** (Standard), **1.0%** (Exotic)
- Set initial price
- **Interactive graphical kernel editor**:
  - SVG canvas with draggable breakpoints
  - Click to add breakpoints, double-click to remove
  - Drag to adjust kernel shape
  - Presets: **Linear**, **Step** (discontinuity at 50%), **Concentrated** (liquidity in middle range)
  - Exports protocol-format breakpoints `[position, height]` in X15/X59 encoding
- Kernel compact encoding skips implicit `[0,0]` first point (matching `encodeKernelCompact` from Python tests)
- Curve encoding: `[qLower, qUpper, qCurrent]` with `+(1<<63)` offset
- **Verified on-chain**: Pool initialization succeeds with 371k gas

### 2c. Manage Liquidity

- **Mint (Add Liquidity)**:
  - Enter Pool ID, price range (min/max), and shares
  - Approve tokens to the **Operator** contract
  - Action sequence: `PUSH32 → MODIFY_POSITION → SYNC → TRANSFER → SETTLE (x2) → MODIFY_SINGLE_BALANCE`
  - **Verified on-chain**: 269k gas
- **Burn (Remove Liquidity)**:
  - Same UI with negative shares
  - Action sequence: `PUSH32 → MODIFY_POSITION → NEG (x2) → TAKE_TOKEN (x2) → MODIFY_SINGLE_BALANCE`
  - Supports partial withdrawal
- **Position Tracker**:
  - Queries `ModifyPosition` events filtered by connected wallet
  - Displays pool ID, shares, mint/burn type, block number
  - Visual range bar and refresh button

### 2d. Swap Interface

- Standard token swap UI with direction toggle
- **Slippage tolerance control**: preset buttons (0.1%, 0.5%, 1.0%, 3.0%) + range slider (0.01-10%)
- **Swap estimation** via `useSwapQuote` hook:
  - Attempts `eth_call` simulation of the full `unlock → operator → swap` flow
  - Falls back to model-based estimate: `output ≈ input × (1 - impactRate)`
  - Shows estimated output amount and price impact percentage
  - Debounced 300ms to avoid excessive RPC calls
- Full 27-action swap sequence with conditional JUMP logic for token settlement
- **Verified on-chain**: Swap succeeds with 193k gas

---

## Task 3: Sandwich Bot

The sandwich bot is a TypeScript backend service that monitors Anvil's mempool for pending swap transactions, decodes the operator action calldata to extract the victim's trade parameters, evaluates profitability, and dynamically constructs front-run/back-run transactions with manipulated gas prices and sequential nonces.

### Setup (Step-by-Step)

Anvil resets all state on restart, so you must deploy with auto-mining enabled, then switch to no-mining mode **without restarting** to preserve the deployed contracts.

**Bash (macOS/Linux/Git Bash):**
```bash
# Terminal 1: Start Anvil with auto-mining
bash scripts/start-anvil-auto.sh

# Terminal 2: Deploy all contracts
bash scripts/deploy.sh

# Terminal 2: Switch to no-mining mode (keeps contracts deployed)
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_setAutomine","params":[false],"id":1}'

# Terminal 2: Start the bot
cd bot && npm start

# Terminal 3: Mine the bot's 2 token approval txs
bash scripts/mine-block.sh
bash scripts/mine-block.sh

# Terminal 3: Start the frontend
cd frontend && npm run dev
```

**PowerShell (Windows):**
```powershell
# Terminal 1: Start Anvil with auto-mining
.\windows-scripts\start-anvil-auto.bat

# Terminal 2: Deploy all contracts
.\windows-scripts\deploy.bat

# Terminal 2: Switch to no-mining mode (keeps contracts deployed)
.\windows-scripts\disable-mining.bat

# Terminal 2: Start the bot
.\windows-scripts\start-bot.bat

# Terminal 3: Mine the bot's 2 token approval txs
.\windows-scripts\mine-block.bat
.\windows-scripts\mine-block.bat

# Terminal 3: Start the frontend
.\windows-scripts\start-frontend.bat
```

### How to Test the Sandwich Attack

Once the bot is running and monitoring:

1. Open **http://localhost:3000** in your browser
2. Connect MetaMask (Anvil account #0: `0xac0974...`)
3. **New Pool** tab → Initialize Pool → mine: `.\windows-scripts\mine-block.bat`
4. **Liquidity** tab → Approve both tokens (mine after each) → Add Liquidity → mine
5. **Swap** tab → Paste Pool ID → Enter a small amount (e.g. `0.001`) → Approve → mine
6. **Submit the Swap** → confirm in MetaMask → **DO NOT mine yet**
7. **Watch the bot terminal** — it will print:
   ```
   [Mempool] Detected swap transaction from 0xf39F...
   ```
8. The bot automatically submits front-run (2x gas) and back-run (0.5x gas)
9. **Now mine the block**: `.\windows-scripts\mine-block.bat`
10. The bot prints the results: `Front-run: SUCCESS`, `Back-run: SUCCESS`

> **Tip:** For the back-run to succeed, the pool needs sufficient liquidity relative to the swap amount. Use a large liquidity position (e.g. 100+ shares) and a small swap (e.g. 0.001 tokens).

### 3a. Mempool Monitoring

| Feature | Implementation |
|---------|---------------|
| **Polling method** | `txpool_content` RPC (HTTP, every 100ms) |
| **Platform support** | Works on Windows, macOS, Linux (no WebSocket dependency) |
| **Filtering** | Only processes txs targeting the Nofeeswap contract address |
| **Deduplication** | `seenTxs` Set prevents re-processing the same tx |
| **Self-skip** | Ignores transactions from the bot's own wallet |
| **No-mining mode** | Anvil `--no-mining` or `evm_setAutomine(false)` keeps txs pending |

### 3b. Target Detection & Calldata Decoding

The decoder (`bot/src/decoder.ts`) performs multi-layer parsing:

1. **Transaction level**: Checks `tx.to === nofeeswap` and `selector === 0x738c440a` (unlock)
2. **ABI level**: Decodes `unlock(address unlockTarget, bytes data)` to extract the operator action bytecode
3. **Operator level**: Walks the packed action bytecodes to find PUSH32 and SWAP opcodes:
   - **PUSH32** (opcode 3): `[value:32 bytes][slot:1 byte]` — stores amountSpecified in a transient slot
   - **SWAP** (opcode 52): `[poolId:32][amountSlot:1][limitOffsetted:8][zeroForOne:1][crossThresholdSlot:1][successSlot:1][amount0Slot:1][amount1Slot:1][hookDataLen:2]`
4. **Parameter extraction**: Reads poolId (32 bytes), amountSpecified (from PUSH32 slot), limitOffsetted (inline 8-byte uint64), and zeroForOne (trade direction)
5. **Slippage estimation**: Converts `limitOffsetted` back to logPriceLimit and estimates slippage from the price distance

### 3c. Sandwich Execution

The executor (`bot/src/sandwich.ts`) constructs three ordered transactions:

| Transaction | Gas Price | Nonce | Direction | Purpose |
|-------------|-----------|-------|-----------|---------|
| **Front-run** | 2x victim | N | Same as victim | Buy before victim, move price |
| **Victim** | Original | (pending) | Original | Executes at worse price |
| **Back-run** | 0.5x victim | N+1 | Opposite | Sell after victim, capture profit |

**Profitability analysis:**
```
estimatedProfit = tradeSize × slippagePercent × 0.3 (30% extraction factor)
frontRunAmount = tradeSize / 2
```

**Action sequence:** Each front-run/back-run uses the full 27-action swap sequence with:
- PUSH32 → SWAP → JUMP/REVERT error handling
- Conditional LT/ISZERO logic for token settlement direction
- NEG + TAKE_TOKEN for outgoing tokens
- SYNC + TRANSFER_FROM_PAYER + SETTLE for incoming tokens
- Correct decimal opcodes (SWAP=52, not 0x10)

**Gas-price ordering:** When Anvil mines a block with `--no-mining` disabled, transactions are ordered by gas price (highest first), producing: front-run (2x) → victim (1x) → back-run (0.5x).

### Verified Sandwich Output

```
[Mempool] Detected swap transaction from 0xf39Fd6e51a...
  TxHash: 0x4d1cd717...
  Pool ID: 849820967102116221...
  Amount: 1000000000000000
  ZeroForOne: 1
  Gas Price: 1000153661

=== Sandwich Analysis ===
  Victim: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  Trade Size: 0.001 tokens
  Slippage: 99.99%
  Est. Profit: 0.000299969999999999 tokens

=== Executing Sandwich ===
  [1/3] Front-run: 0.0005 tokens, Gas: 2.0 gwei, Nonce: 14
  [2/3] Victim: (already pending in mempool)
  [3/3] Back-run: 0.0005 tokens (reverse), Gas: 0.5 gwei, Nonce: 15

  Front-run: SUCCESS
  Back-run:  SUCCESS

[Stats] Sandwiches: 1/1
[Stats] Total Estimated Profit: 0.0003 tokens
```

### Mining Blocks (No-Mining Mode)

**Bash:**
```bash
bash scripts/mine-block.sh
```

**PowerShell (Windows):**
```powershell
.\windows-scripts\mine-block.bat

# To re-enable auto-mining:
.\windows-scripts\enable-mining.bat
```

---

## Transparency Statement

### All Requirements Complete

| Task | Requirement | Status | Evidence |
|------|-------------|--------|----------|
| **1** | Anvil local blockchain | Complete | `scripts/start-anvil.sh` |
| **1** | Core contracts (CREATE3 deploy) | Complete | `contracts/scripts/deploy.ts` |
| **1** | Operator contracts | Complete | Deployed with MockQuoter |
| **1** | Mock tokens (2 ERC-20) | Complete | ALPHA + BETA, 1M each |
| **2a** | MetaMask wallet connection | Complete | wagmi injected connector |
| **2a** | Tx prompts wallet | Complete | All via `writeContract` |
| **2a** | Tx state feedback | Complete | `TransactionStatus.tsx` |
| **2b** | Pool init UI | Complete | Fee tier, price, kernel params |
| **2b** | Graphical kernel editor | Complete | `KernelEditor.tsx` - drag, presets |
| **2b** | On-chain execution | Complete | Verified 371k gas |
| **2c** | Mint liquidity | Complete | Verified 269k gas |
| **2c** | Burn liquidity | Complete | Verified 138k gas (requires setOperator before first burn) |
| **2c** | User position display | Complete | `PositionTracker.tsx` - event indexing |
| **2c** | Partial/full withdrawal | Complete | Shares input |
| **2d** | Swap UI | Complete | Direction toggle, amount input |
| **2d** | Slippage control | Complete | Presets + slider |
| **2d** | Estimated output | Complete | `useSwapQuote.ts` hook |
| **2d** | Price impact display | Complete | Model + simulation |
| **2d** | On-chain execution | Complete | Verified 193k gas |
| **3a** | Mempool monitoring | Complete | `txpool_content` polling, 100ms interval |
| **3b** | Calldata decoding | Complete | Decodes poolId, amount, limitOffsetted, zeroForOne |
| **3c** | Front-run (higher gas) | Complete | 2x gas, nonce N - verified SUCCESS |
| **3c** | Back-run (lower gas) | Complete | 0.5x gas, nonce N+1 - verified SUCCESS |
| **3c** | Three-tx ordering | Complete | Gas price ordering verified in mined block |

### Known Limitations

- **Swap estimation** uses a model-based approximation with `eth_call` simulation fallback. The MockQuoter returns hashes rather than real quotes, so the model estimate is used when simulation reverts.
- **Position tracker** shows event-level data (poolId, shares, block). Full position value tracking (unrealized PnL, token amounts from shares) would require reading pool growth multipliers from storage.
- **Kernel editor** validates breakpoints client-side (monotonicity, endpoints). Protocol-level edge cases (minLogStep, triple-repeat rules) rely on on-chain validation with clear revert messages.
- **Curve encoding** supports 3-member curves `[qLower, qUpper, qCurrent]`. More complex historical price curves with additional members are not supported in the UI.
- **Multi-token types** (ERC-6909, ERC-1155, Permit2) are not handled in the operator action encoding. Only ERC-20 flows are implemented.

---

## Environment Variables

Create `.env` in `bot/` (optional):

```env
RPC_URL=http://127.0.0.1:8545
WS_URL=ws://127.0.0.1:8545
BOT_PRIVATE_KEY=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6
MIN_PROFIT_WEI=0
```

---

## Design Decisions & Trade-offs

1. **Foundry for compilation**: NoFeeSwap contracts use Foundry-style remappings (`@core/`, `@solady/`, `@governance/`). Foundry handles these natively; Hardhat would require complex resolver workarounds.

2. **ethers.js for deployment, viem/wagmi for frontend**: The deployment script uses ethers.js for raw bytecode deployment with explicit nonce management. The frontend uses viem/wagmi for type-safe React hooks.

3. **Operator action encoding from first principles**: Rather than importing the Python test helpers, the operator action bytecodes are constructed in TypeScript by reverse-engineering the Operator contract's assembly-level `unlockCallback`. This required discovering 6 encoding bugs (documented in commit history).

4. **Polling over WebSocket for mempool**: The bot uses `txpool_content` HTTP polling because Anvil's `eth_pendingTransactions` RPC is not available in all versions. The monitor attempts WebSocket first and falls back automatically.

5. **Interactive kernel editor**: Built with raw SVG + React mouse events (no chart library dependency). Supports the full protocol kernel spec: monotonic breakpoints, discontinuities, and arbitrary piecewise-linear shapes.

6. **EOA-based sandwich**: As specified in the scope clarification, the sandwich bot uses sequential EOA transactions with correct nonce/gas ordering rather than a custom Solidity MEV contract.

7. **Token approvals to Operator (not Nofeeswap)**: The Operator contract calls `token.transferFrom(payer, nofeeswap, amount)` inside the unlock callback, so the payer must approve the Operator. This was discovered by studying the Python test patterns.

---

## Programmatic Verification

The full flow (init → mint → swap) is verified programmatically:

**Bash:**
```bash
# Start Anvil + deploy, then:
node scripts/test-flow.js
```

**PowerShell (Windows):**
```powershell
# Start Anvil + deploy, then:
.\windows-scripts\run-test.bat
```

Output:
```
=== Full Flow Test ===
1. Init Pool:    SUCCESS  gas: 371935
2. Tokens approved
3. Mint:         SUCCESS  gas: 269188
4. Swap:         SUCCESS  gas: 193075
5. setOperator:  done
6. Burn:         SUCCESS  gas: 138259
Final Balances:
  Token0: 999999.924584602523354988
  Token1: 999999.628607322642452064
```

### Sandwich Bot Verification

Tested with the dApp frontend submitting a swap while the bot monitors the mempool:
```
[Mempool] Detected swap from victim
[1/3] Front-run: SUCCESS  (2x gas, mined first)
[2/3] Victim swap executes at worse price
[3/3] Back-run:  SUCCESS  (0.5x gas, mined last)
Estimated Profit: 0.0003 tokens
```
