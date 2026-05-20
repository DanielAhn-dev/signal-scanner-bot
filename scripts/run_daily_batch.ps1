# Daily Batch Script for Signal Scanner Bot
# Usage: PowerShell -ExecutionPolicy Bypass -File run_daily_batch.ps1

param(
    [string]$Date = "",
    [switch]$SkipOHLCV,
    [switch]$ResetStockData,
    [switch]$TailLog,
    [string]$LogDir = "logs"
)

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptRoot
Set-Location $ProjectRoot

Write-Host "Project path: $ProjectRoot" -ForegroundColor Cyan
Write-Host "Script path: $ScriptRoot" -ForegroundColor Cyan

# Create log directory
if (!(Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

$LogFile = "$LogDir\daily_batch_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
Write-Host "Log file: $LogFile" -ForegroundColor Yellow

# Check Python environment
$PythonExe = ".\.venv\Scripts\python.exe"
if (!(Test-Path $PythonExe)) {
    Write-Host "ERROR: Python environment not found: $PythonExe" -ForegroundColor Red
    Write-Host "Create virtual environment with: python -m venv .venv" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Python found: $PythonExe" -ForegroundColor Green

# Build arguments
$Args = @("scripts\daily_batch.py")

if ($Date) {
    $Args += "--date", $Date
}
if ($SkipOHLCV) {
    $Args += "--skip-ohlcv"
}
if ($ResetStockData) {
    $Args += "--reset-stock-data"
}

# Run script
Write-Host "`nStarting batch execution..." -ForegroundColor Green
Write-Host "Command: $PythonExe $($Args -join ' ')" -ForegroundColor White
Write-Host ""

$StartTime = Get-Date

# Set Python encoding to UTF-8
$env:PYTHONIOENCODING = "utf-8"

# Execute and capture output
& $PythonExe @Args 2>&1 | Tee-Object -FilePath $LogFile

$ExitCode = $LASTEXITCODE
$EndTime = Get-Date
$Duration = ($EndTime - $StartTime).TotalSeconds

# Display results
Write-Host ""
Write-Host ("="*60) -ForegroundColor Cyan
if ($ExitCode -eq 0) {
    Write-Host "BATCH COMPLETED SUCCESSFULLY" -ForegroundColor Green
} else {
    Write-Host "BATCH COMPLETED WITH CODE: $ExitCode" -ForegroundColor Yellow
}
Write-Host "Duration: $([int]$Duration) seconds" -ForegroundColor White
Write-Host "Log file: $LogFile" -ForegroundColor White
Write-Host ("="*60) -ForegroundColor Cyan
Write-Host ""

# Show log tail if requested
if ($TailLog) {
    Write-Host "Last 30 lines of log:" -ForegroundColor Yellow
    Write-Host ("="*60) -ForegroundColor Cyan
    Get-Content $LogFile -Tail 30
    Write-Host ("="*60) -ForegroundColor Cyan
}

# Show helpful info
Write-Host "To view full log: notepad $LogFile" -ForegroundColor White
Write-Host "To tail log: Get-Content $LogFile -Tail 50" -ForegroundColor White
Write-Host ""

# Wait based on exit code
if ($ExitCode -eq 0) {
    Start-Sleep -Seconds 1
} else {
    Write-Host "Script requires review. Press Enter to exit." -ForegroundColor Red
    Read-Host "Press Enter"
}

exit $ExitCode
