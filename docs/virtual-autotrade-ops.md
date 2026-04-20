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
```

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
