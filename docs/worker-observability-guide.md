# Worker 관측/운영 가이드

`api/worker.ts`는 명령 처리 시작/완료/실패 알림 시점에 구조화 로그를 남깁니다.
최근 리팩터링으로 타임아웃은 환경변수로 조정 가능하며, 로그에는 집계용 `metric_key`가 포함됩니다.

## 1) 타임아웃 운영 파라미터

기본값은 `api/workerPolicy.ts`의 `DEFAULT_WORKER_TIMEOUTS`를 따릅니다.

### Telegram API timeout

- `WORKER_TG_TIMEOUT_MS` (기본: `5000`)
- `WORKER_TG_DOCUMENT_TIMEOUT_MS` (기본: `30000`)

### Job timeout (카테고리별)

- `WORKER_JOB_TIMEOUT_DEFAULT_MS` (기본: `20000`)
- `WORKER_JOB_TIMEOUT_TRADE_MS` (기본: `45000`)
- `WORKER_JOB_TIMEOUT_AUTOCYCLE_MS` (기본: `30000`)
- `WORKER_JOB_TIMEOUT_BRIEFING_MS` (기본: `50000`)
- `WORKER_JOB_TIMEOUT_REPORT_MS` (기본: `52000`)

값이 비정상(`0`, 음수, 숫자 아님)이면 기본값으로 자동 폴백됩니다.

## 2) metric_key 스키마

로그 집계를 위해 아래 포맷을 사용합니다.

```text
worker.{event}.{context}.{category}[.timeout]
```

- `event`: `command_start` | `command_done` | `command_failed_notify`
- `context`: `message` | `callback`
- `category`: `default` | `trade` | `autocycle` | `briefing` | `report`
- `.timeout`: 실패가 타임아웃일 때만 suffix 추가

예시:

- `worker.command_start.callback.report`
- `worker.command_done.message.trade`
- `worker.command_failed_notify.message.autocycle.timeout`

## 3) 운영 대시보드 집계 템플릿

아래는 로그 수집 시스템(ELK, Datadog, Loki, BigQuery 등)에서 그대로 응용 가능한 집계 기준입니다.

### A. 카테고리별 시작/완료/실패 건수

```sql
SELECT
  JSON_VALUE(payload, '$.metric_key') AS metric_key,
  COUNT(*) AS cnt
FROM worker_logs
WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY metric_key
ORDER BY cnt DESC;
```

### B. 타임아웃 실패 비율(카테고리별)

```sql
SELECT
  JSON_VALUE(payload, '$.category') AS category,
  SUM(CASE WHEN JSON_VALUE(payload, '$.event') = 'command_failed_notify' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN JSON_VALUE(payload, '$.event') = 'command_failed_notify'
            AND JSON_VALUE(payload, '$.is_timeout') = 'true' THEN 1 ELSE 0 END) AS timeout_failed
FROM worker_logs
WHERE ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY category
ORDER BY timeout_failed DESC;
```

### C. 평균 처리시간(명령 완료 로그 기준)

```sql
SELECT
  JSON_VALUE(payload, '$.category') AS category,
  AVG(CAST(JSON_VALUE(payload, '$.duration_ms') AS INT64)) AS avg_duration_ms,
  APPROX_QUANTILES(CAST(JSON_VALUE(payload, '$.duration_ms') AS INT64), 100)[OFFSET(95)] AS p95_duration_ms
FROM worker_logs
WHERE JSON_VALUE(payload, '$.event') = 'command_done'
  AND ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY category
ORDER BY p95_duration_ms DESC;
```

## 4) 운영 체크리스트

1. `report` 카테고리의 `worker.command_failed_notify.*.report.timeout` 급증 여부 확인
2. `autocycle` 카테고리 timeout 비중이 20% 이상이면 `WORKER_JOB_TIMEOUT_AUTOCYCLE_MS` 점검
3. `trade` p95 처리시간이 장시간 상승하면 외부 데이터 소스 지연 여부 점검
4. 타임아웃 증가는 우선 `점검(dry-run)` 경로 안내 문구와 함께 사용자 공지
