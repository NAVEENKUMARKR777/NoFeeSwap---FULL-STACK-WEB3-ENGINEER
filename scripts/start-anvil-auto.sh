#!/bin/bash
# Start Anvil with auto-mining (for normal development/testing)
echo "=== Starting Anvil (Auto-Mining) ==="
echo "Transactions are mined automatically."
echo ""

export PATH="$HOME/.foundry/bin:$PATH"

anvil \
  --host 0.0.0.0 \
  --port 8545 \
  --chain-id 31337 \
  --gas-limit 30000000 \
  --base-fee 1000000000
