#!/bin/bash
# Deploy all NoFeeSwap contracts + initialize pool + add liquidity
set -e

echo "=== Deploying NoFeeSwap Contracts ==="
echo ""
echo "This will:"
echo "  1. Deploy core contracts (Nofeeswap, Delegatee, Operator)"
echo "  2. Deploy mock tokens (ALPHA, BETA)"
echo "  3. Initialize a default pool with 10000 shares liquidity"
echo "  4. Set operator approvals (ready for swap and burn)"
echo ""

cd "$(dirname "$0")/../contracts"

# Check if the node is running
if ! curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then
  echo "Error: Local node not running. Start Anvil first:"
  echo "  bash scripts/start-anvil-auto.sh"
  exit 1
fi

# Run deployment script
npx ts-node scripts/deploy.ts

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "The pool is ready to use immediately:"
echo "  - Pool has 10000 shares of liquidity"
echo "  - Token approvals set for Operator"
echo "  - ERC-6909 operator approved (burn ready)"
echo "  - Pool ID saved in deployed-addresses.json"
echo ""
echo "Next steps:"
echo "  1. Start the frontend:  cd frontend && npm run dev"
echo "  2. Connect MetaMask (Localhost 8545, Chain ID 31337)"
echo "  3. Open http://localhost:3000 - addresses auto-load"
echo "  4. Use the Pool ID from deployed-addresses.json for Swap/Liquidity"
