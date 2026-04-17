# 앱 고도화 로드맵

- 작성일: 2026-04-17
- 목표: 기능 추가보다 먼저 명령 처리, 운영 안정성, 테스트 체계를 정리해 장기 유지보수 비용을 낮춘다.
- 기준: 현재 빌드는 통과하지만 명령 라우팅 중복, 대형 파일 집중, 테스트 부재, 데이터 파이프라인 분산이 주요 리스크다.

## Phase 1. 명령 처리 계층 정리

- 목표: 텍스트 명령, 버튼 콜백, force-reply 입력이 같은 명령 정의를 사용하도록 통합
- 우선 대상 파일:
  - src/bot/router.ts
  - api/worker.ts
  - src/bot/commandCatalog.ts
- 작업 항목:
  - 명령 메타데이터와 callback prefix 해석 규칙을 commandCatalog 중심으로 이동
  - worker 내 routeCallback/sendPromptForCommand 분기를 별도 모듈로 분리
  - 도움말과 실제 구현 불일치 제거
  - /alert 등 이미 구현된 명령을 placeholder 응답이 아닌 실제 핸들러로 연결
- 완료 기준:
  - callback_data 해석 규칙이 한 곳에만 존재
  - help 메시지와 실제 동작이 어긋나지 않음
  - worker 파일 크기와 조건 분기 수가 감소

## Phase 2. 대형 파일 분해

- 목표: 변경 영향도가 큰 서비스/명령 파일을 관심사별로 분리
- 우선순위:
  1. src/services/weeklyReportService.ts
  2. src/bot/commands/watchlist.ts
  3. src/services/briefingService.ts
- 작업 항목:
  - weeklyReportService: 데이터 조회, 주제 해석, PDF 렌더링, caption/summary 생성 분리
  - watchlist: CRUD, 가상매매, ETF 부가정보, 메시지 포맷터 분리
  - briefingService: 데이터 수집, 후보 선정, 재무 재정렬, 메시지 포맷팅 분리
- 완료 기준:
  - 각 파일이 1000줄 내외의 모듈 집합으로 분리
  - 순수 함수 영역은 DB/Telegram 의존 없이 테스트 가능

## Phase 3. 테스트와 회귀 방지

- 목표: 점수 계산, 브리핑, 재무 파싱, 리포트 생성을 자동 검증 가능하게 만들기
- 작업 항목:
  - pnpm test 스크립트 도입
  - fixture 기반 단위 테스트 추가
  - 주간 리포트/브리핑 snapshot 성격의 문자열 회귀 테스트 추가
  - GitHub Actions에 build + test 워크플로우 추가
- 완료 기준:
  - PR/배포 전 최소 build/test 자동 검증 실행
  - 파서와 메시지 포맷 회귀를 조기에 탐지

## Phase 4. 데이터 계층 표준화

- 목표: Python 배치와 TypeScript 앱 사이의 데이터 계약을 명확히 하고 freshness를 추적
- 작업 항목:
  - 배치 산출물 버전, 생성시각, 기준일(asof) 메타 공통화
  - adapters 계층이 fallback 순서를 명시적으로 관리하도록 정리
  - sector/stocks/market 소스별 실패 시 degrade 전략 문서화
- 완료 기준:
  - 앱이 stale 데이터 여부를 노출 가능
  - 외부 fetch 장애 시 fallback 동작이 예측 가능

## Phase 5. 운영 품질 강화

- 목표: 배포 이후 장애 탐지와 분석 시간을 줄이기
- 작업 항목:
  - tsconfig 미래 호환 경고 제거
  - healthcheck와 부수효과 초기화 분리
  - worker/job 처리 결과 로깅 표준화
  - briefing/report 생성 시간과 실패 사유를 구조적으로 기록
- 완료 기준:
  - 운영 로그만으로 병목 구간 파악 가능
  - 배포 후 초기화 부수효과가 예측 가능

## 이번 작업 범위

- Phase 1 착수
- 산출물:
  - 로드맵 문서 추가
  - commandCatalog 중심의 callback 해석 공통화
  - worker callback 라우팅 분리
  - router 내 /alert 실제 핸들러 연결

## 구현 진행 현황 (2026-04-17)

- 명령 체계 1차 통합 적용
  - 신규 대표 명령 추가: /매매 (영문 /trade)
  - 기존 /점수, /매수는 통합 분석으로 위임되는 호환 별칭으로 유지
- 버튼/프롬프트 용어 정리
  - 주요 분석 버튼을 점수·매수 이원화에서 매매 단일 진입으로 전환
  - 기존 콜백 prefix(score:, buy:)는 /trade로 라우팅되도록 유지
- 사용자 안내 문구 업데이트
  - 도움말/시작 안내/온보딩/브리핑 하단 단축 문구에서 /매매 중심 표기 반영