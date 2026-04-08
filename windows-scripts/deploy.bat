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
echo   1. Start the frontend:  windows-scripts\start-frontend.bat
echo   2. Connect MetaMask (Localhost 8545, Chain ID 31337)
echo   3. Import account: ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
echo   4. Open http://localhost:3000
echo   5. Create a pool (New Pool tab), add liquidity, then swap
