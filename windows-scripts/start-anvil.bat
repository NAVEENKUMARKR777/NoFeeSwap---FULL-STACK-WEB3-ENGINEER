@echo off
REM Start Anvil local blockchain with no auto-mining (for mempool monitoring)
REM Transactions stay in the pending pool for the sandwich bot to detect

echo === Starting Anvil (No Auto-Mining) ===
echo This mode disables auto-mining so the sandwich bot can detect pending txs.
echo Transactions will only be mined when you manually trigger mining.
echo.
echo To mine a block manually, run in another terminal:
echo   windows-scripts\mine-block.bat
echo.

set PATH=%USERPROFILE%\.foundry\bin;%PATH%

anvil --no-mining --host 0.0.0.0 --port 8545 --chain-id 31337 --gas-limit 30000000 --base-fee 1000000000
