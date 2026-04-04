@echo off
REM Start the sandwich attack bot

echo === Starting NoFeeSwap Sandwich Bot ===
echo.

pushd %~dp0..\bot
call npm start
popd
