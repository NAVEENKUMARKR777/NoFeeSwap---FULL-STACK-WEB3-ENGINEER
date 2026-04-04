@echo off
REM Full setup: install deps, compile contracts, start Anvil, deploy, start frontend
setlocal

echo ============================================
echo   NoFeeSwap Full Setup (Windows)
echo ============================================
echo.

REM Check prerequisites
where node >nul 2>&1 || (echo ERROR: Node.js not found. Install from https://nodejs.org && exit /b 1)
where git >nul 2>&1 || (echo ERROR: Git not found. Install from https://git-scm.com && exit /b 1)

set PATH=%USERPROFILE%\.foundry\bin;%PATH%
where forge >nul 2>&1 || (
    echo Foundry not found. Installing...
    curl -L https://foundry.paradigm.xyz -o %TEMP%\foundryup.sh
    bash %TEMP%\foundryup.sh
    foundryup
)

pushd %~dp0..

echo.
echo [1/5] Installing dependencies...
cd contracts && call npm install && cd ..
cd frontend && call npm install && cd ..
cd bot && call npm install && cd ..

echo.
echo [2/5] Initializing git submodules...
cd contracts\core && git submodule update --init --recursive && cd ..\..
cd contracts\operator && git submodule update --init --recursive && cd ..\..

echo.
echo [3/5] Compiling contracts...
cd contracts\core
call forge build --evm-version cancun --via-ir --optimize --optimizer-runs 200
cd ..\..

cd contracts\operator
call forge build --evm-version cancun --via-ir --optimize --optimizer-runs 200
cd ..\..

cd contracts
call forge build
node -e "const fs=require('fs');const c=[['core/out/Nofeeswap.sol/Nofeeswap.json','Nofeeswap'],['core/out/NofeeswapDelegatee.sol/NofeeswapDelegatee.json','NofeeswapDelegatee'],['core/out/DeployerHelper.sol/DeployerHelper.json','DeployerHelper'],['operator/out/Operator.sol/Operator.json','Operator'],['operator/out/MockQuoter.sol/MockQuoter.json','MockQuoter'],['out/MockERC20.sol/MockERC20.json','MockERC20'],['out/MockWETH9.sol/MockWETH9.json','MockWETH9']];for(const[p,n]of c){const d=JSON.parse(fs.readFileSync(p,'utf8'));fs.writeFileSync('abis/'+n+'.json',JSON.stringify({abi:d.abi,bytecode:d.bytecode?.object||d.bytecode},null,2));console.log(n+': exported');}"
cd ..

echo.
echo [4/5] Starting Anvil...
start "Anvil" cmd /c "%~dp0start-anvil-auto.bat"
timeout /t 4 /nobreak >nul

echo.
echo [5/5] Deploying contracts...
cd contracts
call npx ts-node scripts/deploy.ts
cd ..

echo.
echo ============================================
echo   Setup Complete!
echo ============================================
echo.
echo Start the frontend:  windows-scripts\start-frontend.bat
echo Run E2E test:        windows-scripts\run-test.bat
echo Start sandwich bot:  windows-scripts\start-bot.bat
echo.
echo MetaMask: Import private key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
echo           Network: http://127.0.0.1:8545 (Chain ID: 31337)

popd
