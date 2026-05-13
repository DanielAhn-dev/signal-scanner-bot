# ⚠️ 공매도 데이터 자동 수집 가이드

**현황**: KRX API 차단으로 인해 자동 수집이 불가능합니다.

→ **[신용/공매도 수동 입력 가이드](credit-short-manual-entry.md)** 를 참고하세요.

---

## 문제점

## 현황
- **공매도**: KRX API는 로컬 머신에서 정상 작동 (GitHub Actions는 Azure IP 차단)
- **전략**: 로컬 Windows PC에서 **평일 자동 수집** → Supabase DB 저장

---

## 설정 방법

### Step 1: 로컬 환경 준비 (1회만)

```powershell
# PowerShell 관리자 모드에서 실행
cd d:\Work\dev\github\signal-scanner-bot
pip install -r requirements.txt
```

### Step 2: 자동 실행 작업 등록

```powershell
# PowerShell 관리자 모드에서 실행
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\register_credit_short_task.ps1
```

**실행 결과:**
```
[OK] Task Scheduler 등록 완료!
==========================================
작업명: SyncCreditShort
경로: \Signal-Scanner-Bot\
실행: 매주 월요일 17:35
배치: D:\Work\batch\sync_credit_short.bat
```

---

## 동작 방식

### 자동 실행 일정
- **기본 권장**: 평일 매일 17:40 공매도 지표 자동 적재
- **기존 방식**: 매주 월요일 17:35 (보조 운영)
- **필요조건**: Windows PC가 켜져있어야 함
- **로그**: `D:\Work\dev\github\signal-scanner-bot\logs\credit_short_*.log`

### 일일 자동화 등록 (권장)

```powershell
cd d:\Work\dev\github\signal-scanner-bot
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\scripts\register_credit_short_daily_task.ps1 -Force
```

현재 파이프라인은 공매도 전용으로 동작합니다.

### 수집 범위
- **상위 종목**: PyKRX가 공식 지원하는 공매도 상위 50개 종목
- **Core 종목**: Supabase stocks 테이블에서 is_active=true인 core 유니버스 종목
- **DB 저장**: stock_credit_short_daily + stocks 테이블 자동 업데이트

### 운영 안전장치 (신규)
- **연속 실패 알림 로그**: `CREDIT_SHORT_ALERT_CONSECUTIVE_FAILURES` (기본 2회)
- **최근 성공일 지연 경고**: `CREDIT_SHORT_STALE_WARN_DAYS` (기본 3일)
- **대체 소스 훅(CSV)**: `CREDIT_SHORT_FALLBACK_CSV` 경로 지정 시 KRX 실패 때 fallback 로드
- **상태 파일**: `logs/credit_short_status.json` (마지막 성공일/연속 실패 횟수 저장)

---

## 수동 실행

언제든 필요하면 수동으로 실행 가능:

```powershell
cd d:\Work\dev\github\signal-scanner-bot
$env:PYTHONIOENCODING="utf-8"
python scripts/update_credit_short.py
```

### 옵션
```powershell
# 특정 날짜로 실행
python scripts/update_credit_short.py --date 20260505

# 공매도 수집 스킵 (점검용)
python scripts/update_credit_short.py --skip-short
```

---

## Task Scheduler 확인 방법

### 웹 UI에서 확인
1. Win + R → `taskschd.msc` 엔터
2. 좌측 "작업 스케줄러 라이브러리" → "Signal-Scanner-Bot" 폴더
3. "SyncCreditShort" 작업 확인
4. 우클릭 → "실행" 으로 수동 테스트 가능

### 최근 로그 확인
```powershell
# 최신 로그 파일 확인
Get-ChildItem d:\Work\dev\github\signal-scanner-bot\logs\ | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# 로그 내용 보기
Get-Content (Get-ChildItem d:\Work\dev\github\signal-scanner-bot\logs\credit_short_*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName -Tail 20
```

---

## 문제 해결

### 1. Task가 실행되지 않음
```powershell
# 작업 상태 확인
Get-ScheduledTask -TaskName SyncCreditShort -TaskPath \Signal-Scanner-Bot\ | Format-List

# 작업 삭제 후 다시 등록
Unregister-ScheduledTask -TaskName SyncCreditShort -Confirm:$false
.\register_credit_short_task.ps1
```

### 2. 인코딩 에러
배치 파일과 Python 모두 UTF-8로 설정됨:
- 배치: `chcp 65001`
- Python: `$env:PYTHONIOENCODING="utf-8"`

### 3. KRX API 차단
- 로컬 Windows에서만 실행되므로 문제 없음
- 만약 VPN/프록시 사용 중이면 차단될 수 있음

---

## 향후 개선

### 증강 옵션
1. **공매도 지표 확장**: short_balance, short_volume 대시보드 반영 강화
2. **증권사 API**: 대체 공매도 데이터 소스 연동
3. **웹 UI 버튼**: `POST /api/refresh-credit-short` 엔드포인트 추가

---

## 요약

| 항목 | 현황 |
|------|------|
| **공매도** | ✅ 자동화 운영 가능 (평일) |
| **비용** | 0원 (로컬 자동화) |
| **정확도** | KRX 공식 API 기반 |
| **무중단** | PC 켜져있으면 안정적 |

