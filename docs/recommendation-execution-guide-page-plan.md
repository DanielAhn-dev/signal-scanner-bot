# 추천 실행 가이드 페이지 기획

목표
- 가상매매가 아니라, 추천된 종목을 실제 매매 가이드로 연결한다.
- 사용자 조건(자금, 분할횟수, 보유성향, 손절허용)을 입력하면 종목별 진입가/손절가/목표가/분할매도 계획을 즉시 제시한다.

왜 별도 페이지가 필요한가
- 기존 Analyze는 단일 종목 조회 중심이며 추천 컨텍스트(어떤 추천에서 왔는지, 당시 점수/상태, 사용자 파라미터)가 약하다.
- 추천 리스트에서 실제 행동으로 이어지는 UX는 "추천 선택 -> 조건 입력 -> 실행 가이드 확인"의 전용 플로우가 더 자연스럽다.
- 기존 어드바이저는 신호/상태 요약에 강점이 있고, 실행 페이지는 주문 단위 의사결정(얼마에 얼마를)에 집중해야 한다.

페이지 제안
- 경로: /execution-guide
- 진입: 추천 화면(스캔/디스커버리/리포트 후보)에서 "실행가이드" 버튼
- URL 파라미터
  - codes: 쉼표 구분 종목코드
  - source: recommendation source (scan, conviction, multibagger, pullback)
  - profile: optional (swing, core)

핵심 UI
1. 상단 컨트롤
- 투자 가능 금액
- 종목당 최대 비중
- 분할 매수 횟수
- 손절 허용폭(보수/중립/공격)
- 목표 설정 모드
  - 자동(종목별 동적)
  - 수동(최소/최대 목표 % 입력)

2. 추천 종목 테이블
- 종목/점수/신호/유동성/수급상태
- 진입 구간(저/중/고)
- 손절가
- 목표가 T1/T2/T3
- 예상 보유 기간
- 권장 수량/1차 주문금액
- 리스크 라벨(높음/중간/낮음)

3. 실행 요약
- 총 필요자금
- 최대 동시 손실 추정
- 목표 시나리오(보수/기준/낙관)
- 우선순위(1~N)

API 설계
- 신규: GET /api/ui/execution-guide?codes=...&source=...&chat_id=...
- 요청 바디(POST 지원 시)
  - capital
  - splitCount
  - riskMode
  - maxWeightPerName
  - targetMode(auto/manual)
- 응답
  - picks[]: code, name, score, advisor, entryLow, entryHigh, stopPrice, target1, target2, target3, horizonDays, qtyPlan
  - summary: requiredCapital, maxRiskLoss, scenario

기존 로직 재사용
- src/lib/investPlan.ts: entry/stop/target 계산
- handlers/ui/stock-latest.ts: 종목별 advisor 데이터
- src/services/virtualAutoTradePositionStrategy.ts: 동적 목표/보유기간 보정 규칙

단계별 구현 체크
- [ ] Phase A: 라우트/페이지 스캐폴딩 (/execution-guide)
- [ ] Phase B: 추천 화면에서 코드 전달 버튼 연결
- [ ] Phase C: API 집계 엔드포인트 추가
- [ ] Phase D: 파라미터 폼 + 테이블 렌더
- [ ] Phase E: 요약 시나리오 계산
- [ ] Phase F: 공유/내보내기(복사, PDF)

다음 대화 시작 프롬프트
- docs/recommendation-execution-guide-page-plan.md 기준으로 Phase A부터 구현해줘. 기존 Analyze 재사용 가능한 컴포넌트는 재사용하고, 추천 화면 진입 버튼까지 연결해줘.
