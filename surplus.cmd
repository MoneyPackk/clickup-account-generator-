@echo off
@if "%~1"=="" set "COMMAND=start"
@if not "%~1"=="" set "COMMAND=%~1"
"C:\Program Files\nodejs\node.exe" "%~dp0surplus-cli.js" %*
