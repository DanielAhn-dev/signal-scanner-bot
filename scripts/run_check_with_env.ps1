$lines = Get-Content ".env"
foreach ($l in $lines) {
    if ($l -match '^\s*([^#=]+)=(.*)$') {
        $n = $matches[1].Trim()
        $v = $matches[2].Trim()
        [System.Environment]::SetEnvironmentVariable($n, $v, 'Process')
    }
}
Write-Host "Environment loaded from .env"
.\.venv\Scripts\python.exe scripts/check_trade_dates.py
