@echo off
REM Disable auto-mining on a running Anvil instance (for sandwich bot testing)
REM Run this AFTER deploying contracts with auto-mining enabled

echo Disabling auto-mining...
curl -s -X POST http://127.0.0.1:8545 -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"evm_setAutomine\",\"params\":[false],\"id\":1}"
echo.
echo Auto-mining disabled. Transactions will stay in the mempool.
echo Use windows-scripts\mine-block.bat to mine manually.
echo Use windows-scripts\enable-mining.bat to re-enable.
