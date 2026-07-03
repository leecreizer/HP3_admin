@echo off
rem -----------------------------------------------------------
rem HP3 local run - open admin + webplaner without GitHub Pages
rem   Admin    : http://localhost:5180  (this repo)
rem   Webplaner: http://localhost:5190  (d:\unity\homeplanner3-web)
rem Ports already listening are skipped; missing ones start in a new window.
rem -----------------------------------------------------------
setlocal

set "ADMIN_DIR=%~dp0"
set "WEB_DIR=d:\unity\homeplanner3-web"

netstat -ano | findstr ":5190 .*LISTENING" >nul
if errorlevel 1 (
  echo [start] webplaner dev server... %WEB_DIR%
  start "HP3 Webplaner :5190" cmd /k "cd /d %WEB_DIR% && npm run dev"
) else (
  echo [skip] webplaner already running on :5190
)

netstat -ano | findstr ":5180 .*LISTENING" >nul
if errorlevel 1 (
  echo [start] admin dev server... %ADMIN_DIR%
  start "HP3 Admin :5180" cmd /k "cd /d %ADMIN_DIR% && npm run dev"
) else (
  echo [skip] admin already running on :5180
)

echo [wait] booting...
ping -n 7 127.0.0.1 >nul
start "" http://localhost:5180/

echo.
echo Admin     : http://localhost:5180
echo Webplaner : http://localhost:5190
echo Stop: press Ctrl+C in each server window
endlocal