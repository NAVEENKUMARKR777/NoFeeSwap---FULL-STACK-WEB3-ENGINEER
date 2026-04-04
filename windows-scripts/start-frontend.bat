@echo off
REM Start the Next.js frontend dev server

echo === Starting NoFeeSwap Frontend ===
echo.

pushd %~dp0..\frontend
call npm run dev
popd
