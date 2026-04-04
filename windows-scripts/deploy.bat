@echo off
REM Deploy all NoFeeSwap contracts to the local Anvil node
setlocal

echo === Deploying NoFeeSwap Contracts ===

REM Check if the node is running
curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Local node not running. Start Anvil first:
    echo   windows-scripts\start-anvil-auto.bat
    exit /b 1
)

REM Navigate to contracts directory
pushd %~dp0..\contracts

REM Run deployment script
call npx ts-node scripts/deploy.ts

popd

echo.
echo === Deployment Complete ===
echo Addresses saved to deployed-addresses.json
echo.
echo Next steps:
echo   1. Start the frontend:  cd frontend ^&^& npm run dev
echo   2. Load deployed-addresses.json in the dApp UI
echo   3. For sandwich bot: restart Anvil with --no-mining, then run the bot
