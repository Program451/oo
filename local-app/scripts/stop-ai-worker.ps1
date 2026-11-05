$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot 'local-data\remote-worker.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'AI worker is not running.'; exit 0 }
$workerProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
$workerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $workerProcessId"
$expectedScript = Join-Path $projectRoot 'local-ai\remote_worker.py'
$expectedPython = Join-Path $projectRoot 'local-ai\.venv\Scripts\python.exe'
$matchesPython = $workerProcess -and $workerProcess.ExecutablePath -eq $expectedPython
if ($workerProcess -and -not $matchesPython) {
    # On Windows a venv launcher can run the worker in a child base-Python process.
    # Accept it only while its parent is this project's exact venv launcher.
    $launcher = Get-CimInstance Win32_Process -Filter "ProcessId = $($workerProcess.ParentProcessId)"
    $matchesPython = $launcher -and $launcher.ExecutablePath -eq $expectedPython -and $launcher.CommandLine.IndexOf($expectedScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
}
if ($workerProcess -and $matchesPython -and $workerProcess.CommandLine.IndexOf($expectedScript, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    Stop-Process -Id $workerProcessId
    Write-Output 'AI worker stopped. The website remains available.'
} else { Write-Output 'The saved process is no longer the AI worker. No process was stopped.' }
