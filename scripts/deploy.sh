#!/bin/bash
# Deploy all NoFeeSwap contracts to the local Anvil node
set -e

echo "=== Deploying NoFeeSwap Contracts ==="

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
echo "Addresses saved to deployed-addresses.json"
echo ""
echo "Next steps:"
echo "  1. Start the frontend:  cd frontend && npm run dev"
echo "  2. Load deployed-addresses.json in the dApp UI"
echo "  3. For sandwich bot: restart Anvil with --no-mining, then run the bot"
