@echo off
TITLE Eyefly Route Builder Launcher
echo Starting API Server...
cd /d "%~dp0artifacts\api-server"
start cmd /k "pnpm exec tsx src/index.ts"

timeout /t 3 >nul
echo Starting Public Tunnel...
cd /d "%~dp0"
npx localtunnel --port 5000
pause