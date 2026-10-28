@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   Rebuild My MonkeyPatch (Personal Profile)
echo ============================================================
echo.

if not exist "node_modules\" (
    echo [INFO] Installing npm dependencies...
    call npm install
    if errorlevel 1 goto :build_error
)

call npm run build:personal
if errorlevel 1 goto :build_error

echo.
echo ============================================================
echo   [SUCCESS] MonkeyPatch rebuilt at: dist\personal
echo   Reload the extension at: chrome://extensions
echo ============================================================
timeout /t 4
exit /b 0

:build_error
echo.
echo ============================================================
echo   [ERROR] Extension build failed! Review the output above.
echo ============================================================
pause
exit /b 1
