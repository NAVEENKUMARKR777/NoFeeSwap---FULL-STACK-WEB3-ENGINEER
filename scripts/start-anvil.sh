#!/bin/bash
# Start Anvil local blockchain with no auto-mining (for mempool monitoring)
# Use --no-mining flag so transactions stay in the pending pool for the bot

echo "=== Starting Anvil (No Auto-Mining) ==="
echo "This mode disables auto-mining so the sandwich bot can detect pending txs."
echo "Transactions will only be mined when you manually trigger mining."
echo ""
echo "To mine a block manually, run in another terminal:"
echo '  curl -X POST http://127.0.0.1:8545 -H "Content-Type: application/json" -d '"'"'{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":1}'"'"''
echo ""

export PATH="$HOME/.foundry/bin:$PATH"

anvil \
  --no-mining \
  --host 0.0.0.0 \
  --port 8545 \
  --chain-id 31337 \
  --gas-limit 30000000 \
  --base-fee 1000000000 \
  --block-time 0
