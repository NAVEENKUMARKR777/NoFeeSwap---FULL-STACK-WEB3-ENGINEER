@echo off
REM Re-enable auto-mining on a running Anvil instance

echo Enabling auto-mining...
curl -s -X POST http://127.0.0.1:8545 -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"evm_setAutomine\",\"params\":[true],\"id\":1}"
echo.
echo Auto-mining enabled. Transactions will be mined automatically.
