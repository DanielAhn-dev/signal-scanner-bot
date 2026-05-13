@echo off
chcp 65001 >nul
setlocal
cd /d "D:\Work\dev\github\signal-scanner-bot"
set PYTHONIOENCODING=utf-8
"D:\Work\dev\github\signal-scanner-bot\.venv\Scripts\python.exe" "D:\Work\dev\github\signal-scanner-bot\scripts\update_credit_short.py" --skip-credit >> "D:\Work\dev\github\signal-scanner-bot\logs\credit_short_daily.log" 2>&1
endlocal
