@echo off
rem -----------------------------------------------------------
rem HP3 local run - one click: admin(5180) + webplaner(5190)
rem "npm run dev" launches both (scripts/dev-all.mjs).
rem -----------------------------------------------------------
setlocal
set "ADMIN_DIR=%~dp0"

netstat -ano | findstr ":5180 .*LISTENING" >nul
if errorlevel 1 (
  echo [start] admin + webplaner dev servers...
  start "HP3 Dev :5180+:5190" cmd /k "cd /d %ADMIN_DIR% && npm run dev"
) else (
  echo [skip] admin already running on :5180
)

echo [wait] booting...
ping -n 7 127.0.0.1 >nul
start "" http://localhost:5180/

echo.
echo Admin     : http://localhost:5180
echo Webplaner : http://localhost:5190
echo Stop: press Ctrl+C in the server window
endlocal