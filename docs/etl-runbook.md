ETL Runbook — fundamentals
===========================

목적
- `scripts/etl_fundamentals.ts`를 정기적으로 실행해 `fundamentals` 테이블에 재무 스냅샷을 적재합니다.

작동 방식 (요약)
- 스크립트는 종목 목록을 조회해 `getFundamentalSnapshot(code)`로 스크래핑/정규화 후 `fundamentals` 테이블로 업서트합니다.
- 업서트는 청크 단위로 수행되며 실패 시 로깅합니다.

실행 위치
- GitHub Actions 워크플로우: `.github/workflows/etl_fundamentals.yml`
- 수동 실행: 로컬에서 `pnpm exec tsx scripts/etl_fundamentals.ts --all <N>`

필요 환경변수
- `SUPABASE_URL` — Supabase 프로젝트 URL
- `SUPABASE_SERVICE_ROLE_KEY` — 서비스 롤 키(쓰기 권한)
- `SUPABASE_ANON_KEY` — 읽기용(옵션)
- 위 변수들은 CI의 Secrets에 저장되어야 합니다.

모니터링 & 실패 대응
- GitHub Actions에서 워크플로우 실행 로그를 확인합니다.
- ETL 실패시 원인에 따라:
  - 네트워크/타임아웃: 재시도
  - Supabase 스키마 오류(PGRST205 등): DB migration 적용 여부 확인
  - 특정 종목 파싱 실패: 스크립트에서 관련 코드/HTML 패턴 차이 파악 후 파서 보완

운영 권장 사항
- 스케줄: 데이터 신선도와 비용/트래픽을 고려해 하루 1회 이상 권장
- 모니터링: 실패 알림(예: GitHub Actions 실패 알림)를 Slack/메일로 연동
- 스냅샷 보존: `fundamentals` 테이블에 인서트 시 `as_of`를 분명히 기록해 시계열로 보관

증분 개선 아이디어
- ETL 상태(성공/실패 카운트, 처리 시간)를 별도 테이블(`etl_runs`)에 기록
- 실패한 종목 목록을 자동 재시도 큐에 넣기
- ETL 성능: 청크 사이즈/병렬성 조정으로 Supabase 및 소스 사이트 부하 조절

참고 명령
```bash
# 로컬에서 빠른 실행 (예: 상위 120종목)
pnpm exec tsx scripts/etl_fundamentals.ts --all 120

# GitHub Actions 수동 실행: Actions 탭에서 `ETL - Fundamentals` > Run workflow
```
