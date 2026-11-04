@echo off
cd /d "%~dp0"
set "ASYL_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%ASYL_NODE%" set "ASYL_NODE=node"
"%ASYL_NODE%" scripts\start-local.mjs
if errorlevel 1 goto failed
start "" "http://127.0.0.1:5174/"
exit /b 0
:failed
echo See the message above and local-data logs.
pause
exit /b 1
