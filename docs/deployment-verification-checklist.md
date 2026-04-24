# 무료플랜 배포 후 운영 검증 체크리스트

배포 완료 후 실제 운영 상태를 확인하기 위한 체계적 검증 가이드입니다.

## 1단계: Telegram 봇 버튼 동작 확인 (즉시)

### 1-1. 자동사이클 수동 실행 테스트

텔레그램에서 `/자동사이클 실행` 명령 실행

**확인 사항:**
- [ ] 명령에 응답하는가
- [ ] 응답 메시지에 매수/매도 내역이 표시되는가
- [ ] 응답 메시지에 `보유`, `보유대응`, `최근 기록`, `자동 점검` 버튼이 붙어있는가

**버튼 동작 확인:**
- [ ] `보유` 버튼 클릭 → 현재 보유 종목 조회 응답
- [ ] `보유대응` 버튼 클릭 → 보유 대응 수익/손실 정보 응답
- [ ] `최근 기록` 버튼 클릭 → 최근 매매 기록 응답
- [ ] `자동 점검` 버튼 클릭 → dry-run 조회 응답

### 1-2. 자동사이클 점검 테스트

텔레그램에서 `/자동사이클 점검` 명령 실행

**확인 사항:**
- [ ] dry-run 결과가 표시되는가
- [ ] 실제 매수/매도가 발생하지 않는가

## 2단계: 야간 자동사이클 cron 동작 확인 (다음 날)

배포된 cron: `45 23 * * 0-4` (평일 밤 11:45 KST)

### 2-1. 실행 로그 확인

Vercel 대시보드 또는 로그 수집 시스템에서 확인:

```
scope=autocycle_cron
event=cycle_done
ts=2026-04-24T23:45:00Z
run_key=<generated>
processed_users=N
buy_count=M
sell_count=K
```

**확인 사항:**
- [ ] 지정된 시각에 실행되었는가
- [ ] 오류가 발생하지 않았는가 (`event=cycle_failed` 없음)
- [ ] skip_reason_stats 에 비정상 집계가 없는가

### 2-2. Ops 다이제스트 확인

다음 날 아침 6:10 KST briefing 메시지에서:

**확인 사항:**
- [ ] "- 자동매매 스킵 상위: ..." 라인이 포함되어 있는가
- [ ] 전일 자동사이클 실행 결과가 요약되어 있는가

## 3단계: 운영자 알림 설정 및 검증 (필요시)

비정상 징후 감지 시 운영자 Telegram 채팅으로 알림을 받으려면 환경변수 설정:

```bash
AUTO_TRADE_ALERT_CHAT_ID=<your-admin-chat-id>
```

### 3-1. 알림 테스트

Vercel 환경변수 설정 후 cron을 수동으로 트리거해 알림이 오는지 확인:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://signal-scanner-bot.vercel.app/api/cron/virtualAutoTrade?mode=auto&dryRun=false&maxUsers=5"
```

**알림이 발생하는 경우:**
- [ ] `error_count > 0` → 오류 발생 시 즉시 알림
- [ ] `out_of_session > 0` → 장시간 외 실행 시 알림
- [ ] `duplicate_window >= 3` → 중복 실행이 과도할 때 알림

**확인 사항:**
- [ ] 예상된 조건에서만 알림이 오는가
- [ ] 정상 실행 시에는 알림이 오지 않는가

## 4단계: 문서 정합성 확인

현재 배포 상태와 문서가 일치하는지 확인:

**확인 사항:**
- [ ] [docs/user-operating-guide.md](../docs/user-operating-guide.md) 에서 "사용자가 버튼으로 트리거" 설명이 있는가
- [ ] [docs/virtual-autotrade-ops.md](../docs/virtual-autotrade-ops.md) 에서 무료플랜 제약 설명이 있는가
- [ ] 모든 문서에서 "자동 cron" 표현이 제거되었는가
- [ ] PDF 버전도 최신인가 (docs/generated/user-operating-guide.pdf)

## 5단계: 데이터베이스 상태 확인

### 5-1. 자동사이클 실행 기록

```sql
SELECT 
  id, user_id, started_at, summary,
  (summary->>'processed_users')::int as processed_users,
  (summary->>'buy_count')::int as buy_count,
  (summary->>'sell_count')::int as sell_count,
  (summary->>'skipped_count')::int as skipped_count,
  (summary->>'error_count')::int as error_count
FROM public.virtual_autotrade_runs
WHERE started_at > CURRENT_TIMESTAMP - INTERVAL '1 day'
ORDER BY started_at DESC
LIMIT 20;
```

**확인 사항:**
- [ ] 예상된 시각에 실행 기록이 있는가
- [ ] error_count = 0 인가
- [ ] skipped_count 내용이 정상인가

### 5-2. 자동매매 액션 기록

```sql
SELECT 
  id, user_id, created_at, action_type, symbol, quantity, price, notes
FROM public.virtual_autotrade_actions
WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '1 day'
ORDER BY created_at DESC
LIMIT 50;
```

**확인 사항:**
- [ ] 자동사이클 실행 후 액션 기록이 있는가
- [ ] 액션 메모에 스킵 사유가 기록되어 있는가 (있을 경우)

## 6단계: 실제 사용자 피드백 수집

첫 주일간 모니터링:

**확인 사항:**
- [ ] 사용자로부터 예상치 못한 오류 보고가 없는가
- [ ] 버튼 응답이 정상적으로 작동하는가
- [ ] 자동사이클 실행 후 보유 현황 업데이트가 정상인가

## 다음 단계

1. **모든 단계 통과** → 현재 상태 안정적이므로 추가 기능 개발 계획
2. **1-2단계 실패** → 버튼 로직 또는 서비스 오류 디버깅
3. **2단계 실패** → Cron 스케줄 또는 권한 문제 확인
4. **3단계 실패** → 환경변수 또는 Telegram API 권한 문제 확인

---

**생성일**: 2026-04-24  
**상태**: 무료플랜 배포 완료, 검증 대기
