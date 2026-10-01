@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\setup-windows.ps1"
if errorlevel 1 pause
