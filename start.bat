@echo off
cd /d "%~dp0"
title Airform - local studio
echo.
echo  Starting Airform...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 (
  echo.
  echo  The local server stopped. Press any key to close this window.
  pause >nul
)
