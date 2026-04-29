소비자(명령) 리팩터 계획
=========================

목적
- `score`, `buy`, `finance`, `scan` 등 서비스 소비자들이 재무 데이터 조회 시 직접 스크레이프하지 않고 DB에 저장된 스냅샷(`fundamentals`)을 우선 사용하도록 표준화합니다.

작업 범위
- 우선순위: `score.ts` -> `buy.ts` -> `finance.ts` -> 나머지 소비자(`buy`, `finance` 등 이미 수행된 항목은 체크)
- 각 파일에서 다음 변경을 적용:
  1. `fundamentalStore.getLatestFundamentalSnapshot(code)` 호출로 우선 조회
  2. DB 레코드를 기존 서비스/메시지가 기대하는 `fundamental` 형태로 안전하게 매핑(숫자 강제, null 처리)
  3. DB 결과가 없거나 충분하지 않으면 기존의 `getFundamentalSnapshot(code)`로 폴백
  4. 변경 후 `pnpm build`로 타입체크, 간단 명령 시뮬레이션으로 동작 확인

검증
- TypeScript 빌드 통과
- 주요 명령(예: `/종목분석`, `/재무`)을 로컬에서 수동 실행해 메시지 내용 표시 확인
- ETL로 `fundamentals`에 최근 스냅샷이 있는지 확인

롤백 계획
- 문제가 발생하면 해당 커밋을 되돌리고 기존 `getFundamentalSnapshot` 경로로 임시 복구

참고: 구현 시 주의사항
- DB 필드명(`debt_ratio`, `operating_income` 등)과 메시지 필드명을 정확히 매핑
- `computed` 필드는 구조가 불확실하므로 안전한 타입 변환(숫자 캐스팅, 문자열 확인) 사용
