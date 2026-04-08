@echo off
REM Deploy all NoFeeSwap contracts + initialize pool + add liquidity
setlocal

echo === Deploying NoFeeSwap Contracts ===
echo.
echo This will:
echo   1. Deploy core contracts (Nofeeswap, Delegatee, Operator)
echo   2. Deploy mock tokens (ALPHA, BETA)
echo   3. Initialize a default pool with 10000 shares liquidity
echo   4. Set operator approvals (ready for swap and burn)
echo.

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
echo.
echo The pool is ready to use immediately:
echo   - Pool has 10000 shares of liquidity
echo   - Token approvals set for Operator
echo   - ERC-6909 operator approved (burn ready)
echo   - Pool ID saved in deployed-addresses.json
echo.
echo Next steps:
echo   1. Start the frontend:  windows-scripts\start-frontend.bat
echo   2. Connect MetaMask (Localhost 8545, Chain ID 31337)
echo   3. Import account: ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
echo   4. Open http://localhost:3000 - addresses auto-load
echo   5. Use the Pool ID from deployed-addresses.json for Swap/Liquidity
