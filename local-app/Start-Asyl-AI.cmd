@echo off
cd /d "%~dp0"
set "PYTHONUTF8=1"
if not exist "local-ai\.venv\Scripts\python.exe" goto missing
"%~dp0local-ai\.venv\Scripts\python.exe" -u "%~dp0local-ai\remote_worker.py"
if errorlevel 1 pause
exit /b
:missing
echo The model environment is not installed. See README.md.
pause
exit /b 1
