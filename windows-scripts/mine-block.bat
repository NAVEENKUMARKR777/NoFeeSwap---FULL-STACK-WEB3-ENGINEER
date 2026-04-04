@echo off
REM Mine a single block on Anvil (use when running in --no-mining mode)
curl -s -X POST http://127.0.0.1:8545 -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"evm_mine\",\"params\":[],\"id\":1}"
echo.
echo Block mined.
