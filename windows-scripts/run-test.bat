@echo off
REM Run the end-to-end test (init pool -> mint -> swap)

echo === Running E2E Test ===
echo.

pushd %~dp0..
call node scripts/test-flow.js
popd
