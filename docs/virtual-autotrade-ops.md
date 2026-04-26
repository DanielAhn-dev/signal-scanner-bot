# 가상 자동매매 운영 가이드

> 월~금 시간대별 실전 운용 체크리스트는 `docs/virtual-autotrade-weekly-playbook.md`를 함께 참고하세요.

## 1) Dry-run 점검

실주문 없이 판단 로직만 실행합니다.

```bash
pnpm autotrade:dry-run -- --mode=auto --maxUsers=50
```

- `--mode=auto`: 실행 시점 기준 통합 판단 (보유/익절/손절/신규매수)
- `--mode=daily`: 일일 사이클 강제
- `--mode=monday`: 월요일 매수 사이클 강제

## 1-1) 폰(텔레그램)에서 바로 실행

- `/자동사이클 점검`
- `/자동사이클 실행`
- `/자동사이클 실행 진입`

설명:
- 점검: `dry-run`으로 판단만 수행
- 실행: 실제 가상 매수/매도 반영
- 진입: 신규 진입 판단을 강제로 실행

## 2) 사용자 활성화

### 전체 활성 사용자 대상 활성화

```bash
pnpm autotrade:enable -- --all-active --enable=true
```

### 특정 사용자만 활성화

```bash
pnpm autotrade:enable -- --tgIds=123456789,987654321 --enable=true
```

### 파라미터 오버라이드 예시

```bash
pnpm autotrade:enable -- --all-active --enable=true --buySlots=2 --maxPositions=10 --minScore=72 --takeProfitPct=8 --stopLossPct=4
```

## 3) 비활성화

```bash
pnpm autotrade:enable -- --tgIds=123456789 --enable=false
```

## 4) 크론 수동 호출 (운영 점검)

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://signal-scanner-bot.vercel.app/api/cron/virtualAutoTrade?mode=auto&dryRun=true&maxUsers=20"

curl -H "Authorization: Bearer $CRON_SECRET" "https://signal-scanner-bot.vercel.app/api/cron/virtualAutoTrade?mode=auto&dryRun=false&intradayOnly=true&windowMinutes=10&maxUsers=50"
```

- 첫 번째 호출은 dry-run 점검용입니다.
- 두 번째 호출은 평일 장중 10분 자동운영 실반영 경로 점검용입니다.

## 4-1) 장중 자동운영 기본값

- 평일 장중(09:00~15:20 KST) 중 사용자가 버튼으로 수동 트리거하거나 `/자동사이클 실행` 명령으로 실행할 수 있습니다.
- 같은 사용자는 10분 창 기준으로 중복 실행되지 않습니다.
- 무료 플랜 제약으로 자동 cron은 제공되지 않으며, 사용자 주도 수동 실행만 지원합니다.
- `AUTO_TRADE_ALERT_CHAT_ID`를 지정하면 `duplicate_window` 급증, `out_of_session`, `error_count` 발생 시 운영자 채팅으로 요약 경보를 보냅니다.

## 4-2) 무료 플랜 하이브리드 트리거

자동 크론은 장전/야간 핵심 작업만 수행하고, 장중/튜닝은 필요할 때 수동 트리거로 실행합니다.

Hobby 플랜 제한으로 배포 크론은 일 1회(UTC 23:00)로 동작합니다.
- 이 1회 실행에서 `scoreSync -> briefing -> virtualAutoTrade -> strategyGateRefresh`를 순차 실행
- 금요일(UTC 기준)에는 `report`까지 추가 실행
- 장중 대응은 `/자동트리거 장중` 또는 장중 트리거 버튼으로 수동 실행

```bash
pnpm cron:trigger:intraday
pnpm cron:trigger:gate
pnpm cron:trigger -- --task scoreSync
pnpm cron:trigger -- --task briefing
```

텔레그램 운영 채팅에서 동일 트리거를 실행할 수 있습니다.

```text
/자동트리거 준비
/자동트리거 장중
/자동트리거 마감
/자동트리거 전체
/자동트리거 게이트
/자동트리거 점수
/자동트리거 브리핑
/자동트리거 리포트
/자동트리거 야간
```

- `준비`: 점수 동기화 + 장전 브리핑(사전 데이터 준비)
- `장중`: 점수 동기화 + 장중 자동사이클(조건 충족 시 매수/매도)
- `마감`: 야간 자동사이클 + 게이트 리프레시 + 점수 동기화 + 다음날 브리핑 준비
- `전체`: 준비~마감 전체 시퀀스를 순차 실행

접근 제어(권장):

- `TELEGRAM_ALLOWED_USER_IDS`: 허용할 Telegram 사용자 ID 목록(쉼표/공백 구분)
- `TELEGRAM_OWNER_USER_ID`: 소유자 1인 ID
- `TELEGRAM_OPS_CHAT_IDS`: 운영 채팅 ID 목록

위 값 중 하나라도 설정되면 허용된 사용자/채팅만 명령·버튼이 실행됩니다.

추가 운영 옵션:
- `CRON_HOBBY_DAILY_MODE` (기본 true): 일 1회 번들 실행 모드
- `CRON_GATE_NOTIFY` (기본 true): 전략 게이트 상태 변경 시 운영 채팅 알림

- `cron:trigger:intraday`: 장중 10분 자동사이클과 동일한 경로를 1회 실행
- `cron:trigger:gate`: 전략 게이트 리프레시 + 설정 자동 튜닝 1회 실행
- `cron:trigger -- --task ...`: 통합 디스패처에서 특정 작업만 실행

## 5) 결과 확인 SQL

```sql
SELECT *
FROM public.virtual_autotrade_runs
ORDER BY started_at DESC
LIMIT 20;

SELECT *
FROM public.virtual_autotrade_actions
ORDER BY created_at DESC
LIMIT 50;
```
