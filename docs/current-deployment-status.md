# 현재 배포 상태 정보

**배포일**: 2026-04-24  
**배포 커밋**: f3209b8 (무료플랜 cron 제약 대응)  
**Vercel URL**: https://signal-scanner-bot.vercel.app  

## 현재 운영 구조

### Cron 구성 (무료플랜 - 일 1회만 가능)

| 시각 KST | 경로 | 주기 | 용도 |
|---------|------|------|------|
| 06:40 | /api/cron/scoreSync | 평일 | 점수 동기화 |
| 23:00 | /api/cron/scoreSync | 일일 | 점수 동기화 |
| 06:10 | /api/cron/briefing | 평일 | 아침 브리핑 |
| 23:30 | /api/cron/briefing | 평일 | 저녁 브리핑 |
| 23:35 | /api/cron/report | 금요 | 주간 보고 |
| 23:45 | /api/cron/virtualAutoTrade | 평일 | 장후 자동사이클 |

**장중 자동사이클**: 자동 cron 없음. 사용자가 텔레그램 버튼으로 수동 트리거

### 자동사이클 실행 경로

#### 1. 사용자 수동 트리거 (텔레그램)

```
/자동사이클 실행 → api/worker.ts → api/cron/virtualAutoTrade.ts 
→ runVirtualAutoTradingCycle() → 자동 매수/매도 + Telegram 알림
```

**버튼 응답:**
- `보유`: 현재 보유 종목 조회
- `보유대응`: 보유 대응 수익률 정보
- `최근 기록`: 매매 기록 필터 조회
- `자동 점검`: dry-run 재실행

#### 2. 야간 자동 cron (23:45 실행)

```
api/cron/virtualAutoTrade.ts (매일 1회)
→ runVirtualAutoTradingCycle({ mode: 'auto' })
→ 장후 정산/손절/신규매수 실행
→ ops 다이제스트에 포함
```

### 알림 구성

#### 자동사이클 체결 알림 (사용자)

매 실행 후 사용자 채팅으로 전송:
- 실행 결과 요약 (매수/매도/스킵 건수)
- 스킵 상위 사유 (있을 경우)
- 후속 버튼 4개

#### 비정상 징후 알림 (운영자)

`AUTO_TRADE_ALERT_CHAT_ID` 설정 시 아래 조건에서 전송:
- `error_count > 0` → 오류 발생
- `out_of_session > 0` → 장시간 외 실행 감지
- `duplicate_window >= 3` → 중복 실행 과다

**설정 방법:**
Vercel 대시보드 → 환경변수에 `AUTO_TRADE_ALERT_CHAT_ID=<chat_id>` 추가

### 시장 시간 가드

모든 자동사이클 실행은 내부적으로:
- KRX 영업일 확인 (월~금)
- 시장 시간대 확인:
  - 장전: 09:00 이전
  - 장중: 09:00~15:30
  - 장후: 15:30 이후
- 중복 실행 방지 (같은 사용자, 10분 윈도우)

### 운영자 점검 명령

**Cron 수동 테스트:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://signal-scanner-bot.vercel.app/api/cron/virtualAutoTrade?mode=auto&dryRun=false&maxUsers=5"
```

**Dry-run 모드:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://signal-scanner-bot.vercel.app/api/cron/virtualAutoTrade?mode=auto&dryRun=true&maxUsers=5"
```

### 데이터베이스 관련 테이블

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|---------|
| virtual_autotrade_runs | 자동사이클 실행 기록 | run_key, processed_users, summary (JSON) |
| virtual_autotrade_actions | 개별 매수/매도 액션 | action_type, symbol, quantity, skip_reason |
| settings | 사용자 자동사이클 활성화 여부 | autotrade_enabled |
| prefs | 사용자 투자 기준 | capital_krw, risk_profile, buy_slots, max_positions |

### 모니터링 지표

**일일 모니터링:**

```sql
SELECT 
  DATE(started_at) as date,
  COUNT(*) as total_runs,
  SUM((summary->>'processed_users')::int) as total_users,
  SUM((summary->>'buy_count')::int) as total_buys,
  SUM((summary->>'sell_count')::int) as total_sells,
  SUM((summary->>'skipped_count')::int) as total_skips,
  SUM((summary->>'error_count')::int) as total_errors
FROM virtual_autotrade_runs
WHERE started_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY DATE(started_at)
ORDER BY date DESC;
```

**상위 스킵 사유:**

```sql
SELECT 
  reason->>'code' as skip_reason_code,
  reason->>'label' as skip_reason_label,
  SUM((reason->>'count')::int) as total_count
FROM virtual_autotrade_runs,
LATERAL jsonb_array_elements(summary->'skipReasonStats') as reason
WHERE started_at > CURRENT_TIMESTAMP - INTERVAL '1 day'
GROUP BY skip_reason_code, skip_reason_label
ORDER BY total_count DESC;
```

### 알려진 제약사항

1. **무료 플랜 Cron 한도**: 일 1회만 자동 실행 가능
   - 해결: 사용자 수동 트리거로 장중 반복 실행
   - Pro 플랜 업그레이드 시 10분 간격 자동 실행 가능

2. **외부 API 의존성**: Naver 시세, PYKRX 지표
   - 장중 실시간가: Naver 의존 (지연 5~10초)
   - 영업일/시간: PYKRX 기준

3. **사용자 수동 트리거 의존성**: 장중 자동 반복이 없으므로
   - 사용자가 정기적으로 버튼 클릭 필요
   - 또는 Pro 플랜 업그레이드 후 자동 cron 활성화

---

**다음 단계**: [deployment-verification-checklist.md](./deployment-verification-checklist.md) 참고하여 배포 상태 검증
