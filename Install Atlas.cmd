@echo off
rem Installs Atlas for this Windows user. No administrator rights needed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
