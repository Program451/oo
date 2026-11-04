@echo off
cd /d "%~dp0"
set "ASYL_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%ASYL_NODE%" set "ASYL_NODE=node"
"%ASYL_NODE%" scripts\stop-local.mjs
pause
