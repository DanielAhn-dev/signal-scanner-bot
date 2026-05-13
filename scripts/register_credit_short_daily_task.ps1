param(
  [string]$TaskName = "SyncCreditShortDaily",
  [string]$TaskFolder = "\Signal-Scanner-Bot\",
  [string]$RunAt = "17:40",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (!(Test-Path $pythonExe)) {
  throw "Python 가상환경을 찾을 수 없습니다: $pythonExe"
}

$scriptPath = Join-Path $repoRoot "scripts\update_credit_short.py"
if (!(Test-Path $scriptPath)) {
  throw "스크립트를 찾을 수 없습니다: $scriptPath"
}

$logDir = Join-Path $repoRoot "logs"
if (!(Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$batchPath = Join-Path $repoRoot "scripts\sync_credit_short_daily.bat"
$batchBody = @"
@echo off
chcp 65001 >nul
setlocal
cd /d "$repoRoot"
set PYTHONIOENCODING=utf-8
"$pythonExe" "$scriptPath" >> "$logDir\credit_short_daily.log" 2>&1
endlocal
"@
Set-Content -Path $batchPath -Value $batchBody -Encoding Ascii

$fullTaskName = "${TaskFolder}${TaskName}"
$taskCommand = "cmd.exe /c `"$batchPath`""
$days = "MON,TUE,WED,THU,FRI"

if ($Force) {
  schtasks.exe /Delete /TN $fullTaskName /F | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[INFO] 기존 작업이 없거나 삭제할 작업이 없습니다: $fullTaskName"
  }
}

schtasks.exe /Create /TN $fullTaskName /TR $taskCommand /SC WEEKLY /D $days /ST $RunAt /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Task Scheduler 등록 실패 (exit code: $LASTEXITCODE)"
}

Write-Host "[OK] Task Scheduler 등록 완료"
Write-Host "작업명: $TaskName"
Write-Host "경로: $TaskFolder"
Write-Host "실행: 평일 $RunAt"
Write-Host "배치: $batchPath"
