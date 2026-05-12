# ⚠️ Task Scheduler 자동 등록 (DEPRECATED)

**2026-05-12: KRX API 차단으로 인해 자동 수집이 불가능합니다.**

→ 대신 **[신용/공매도 수동 입력 가이드](credit-short-manual-entry.md)** 를 참고하세요.

---

## 과거 설정 방법 (참고용)

아래는 향후 KRX API 또는 다른 소스에서 자동 수집이 가능해질 때 사용할 수 있는 가이드입니다.

## 1단계: 관리자 모드 PowerShell 열기
- **Win + X** 누르고 "Windows PowerShell (관리자)" 선택
  또는
- 검색 창에서 "PowerShell" 검색 → "관리자 권한으로 실행"

## 2단계: 다음 명령어 실행

```powershell
cd d:\Work\batch
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\register_credit_short_task.ps1
```

## 3단계: 확인
Task Scheduler에서 다음과 같이 확인:
- **Win + R** 입력 → `taskschd.msc` 엔터
- 좌측 "작업 스케줄러 라이브러리" 확장
- "Signal-Scanner-Bot" 폴더에서 "SyncCreditShort" 확인

---

## 스크립트 설정 내용

- **작업명**: SyncCreditShort  
- **경로**: \Signal-Scanner-Bot\  
- **일정**: 매주 월요일 17:35  
- **실행**: D:\Work\batch\sync_credit_short.bat  
- **로그**: D:\Work\dev\github\signal-scanner-bot\logs\credit_short_*.log

---

## 수동 테스트 (선택)

관리자 권한이 없을 때 즉시 테스트:
```powershell
cd d:\Work\dev\github\signal-scanner-bot
$env:PYTHONIOENCODING="utf-8"
python scripts/update_credit_short.py --skip-short --skip-credit
```
