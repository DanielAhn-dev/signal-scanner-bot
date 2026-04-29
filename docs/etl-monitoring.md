ETL 모니터링 및 알림 설계
===========================

목표
- `scripts/etl_fundamentals.ts` 실행 상태(성공/실패, 처리 건수, 소요 시간)를 모니터링하고, 실패 시 운영자에게 알림을 전송합니다.

옵션 1 — GitHub Actions + Slack
- GitHub Actions 워크플로우에서 실패 시 Slack으로 알림 전송
- 구현: Actions에 `slackapi/slack-github-action` 연동, 실패 시 채널로 메시지 전송
- 필요: `SLACK_WEBHOOK` 또는 Slack OAuth 토큰을 GitHub Secrets에 저장

옵션 2 — 간단한 DB 기반 로깅
- ETL 스크립트가 완료 시 `etl_runs` 테이블에 결과(시작/종료 시간, status, processed_count, error_message)를 기록
- 별도 경고 룰(예: 최근 3회 연속 실패) 발생 시 Slack/Webhook 호출

권장 구현 단계
1. ETL 스크립트에 `etl_runs` INSERT/UPDATE 추가
2. GitHub Actions 워크플로우에서 실행 로그와 함께 run id를 기록
3. 실패 시 `curl`로 Slack Incoming Webhook 호출(또는 Slack Action 사용)
4. 장기: Datadog/Prometheus 연동해 지표(성공률, 지연시간) 시각화

예시: `etl_runs` 테이블 스키마
```sql
CREATE TABLE etl_runs (
  id serial PRIMARY KEY,
  job_name text,
  started_at timestamptz,
  finished_at timestamptz,
  status text,
  processed_count int,
  error_text text
);
```

참고 명령
```bash
# GitHub Actions 실패 시 Slack 알림 세팅 예
# GitHub Secrets: SLACK_WEBHOOK
# 워크플로우에 다음 스텝 추가
- name: Notify Slack on failure
  if: failure()
  uses: rtCamp/action-slack-notify@v2
  with:
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
    message: "ETL 실패: ${{ github.workflow }} ${{ github.run_id }}"
```
