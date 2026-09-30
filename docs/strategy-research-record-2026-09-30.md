# 전략·데이터 품질 조사 기록

작성일: 2026-09-30
목적: 과거 성과가 반복적으로 연구된 전략을 현재 시스템에 적용할 수 있는지 평가하고, 개인과 기관의 성과 차이를 설명하는 블로그 원고에 반영할 근거를 남긴다.

## 1. 조사 결론

현재는 전략을 많이 추가하는 것보다 전략 평가의 신뢰도를 먼저 높이는 편이 우선이다.

- 적용 우선순위: 상대 모멘텀 → ATR 변동성 돌파 → 기관·외국인 수급 지속성 → Quality·Value
- 현재 신뢰도: 중간 이하
- 주요 이유: 선도수익률이 실제 체결가격, 비용, 생존편향, 유니버스 이력, 데이터 결측 상태를 충분히 반영하지 않음
- 기존 시스템의 강점: 일봉, 기술지표, 기관·외국인 수급, 신용·공매도, 재무 점수, 데이·오버나이트·주간 전략, 전향 검증 구조

## 2. 현재 코드에서 확인한 근거

- [전략 전향 검증](../scripts/strategy_forward_test.ts)은 `momentum-top5`, `score-top5+flow`, 시장 추세 기준선을 이미 비교한다.
- [전향 검증 서비스](../src/services/strategyForwardTest.ts)는 주식 왕복비용과 ETF 비용을 별도로 적용한다.
- [선도수익률 백테스트](../handlers/ui/backtest-risers.ts)는 기준일 종가와 미래 종가를 비교하므로 실제 체결 규칙과 비용이 별도 보정돼야 한다.
- [OHLCV 수집](../scripts/batch_modules/ohlcv.py)은 최근 재수집과 180일 범위 제한을 사용하지만 종목별 누락률을 결과 메타데이터로 남기지는 않는다.
- [투자자 수급 수집](../scripts/batch_modules/investor.py)은 KIS 실패·fallback·stale 상태를 일부 기록한다.
- [신용·공매도 수집](../scripts/batch_modules/credit_short.py)은 API 정상 응답에서 해당 날짜 행이 없으면 0을 저장하므로, 실제 0과 결측을 구분할 상태 필드가 필요하다.

## 3. 실행 가능한 작업

### 완료: 선도수익률 백테스트 체결 시점·비용 보정

- 대상: [handlers/ui/backtest-risers.ts](../handlers/ui/backtest-risers.ts)
- 기존 동작: 신호 당일 종가를 진입가로 사용
- 변경 동작: 신호 다음 거래일 시가를 진입가로 사용
- 기본 비용: 편도 0.225%, 왕복 0.45%
- API 응답: 비용 차감 전 `grossForwardReturnPct`와 비용 차감 후 `forwardReturnPct`를 함께 제공
- 조정 방법: `sideCostPct` 쿼리 파라미터로 편도 비용률을 조정
- 검증: `pnpm build` 통과

### 완료: 수급·공매도 수집 상태 보존

- 대상: [db/migrations/012_add_market_data_collection_status.sql](../db/migrations/012_add_market_data_collection_status.sql), [scripts/batch_modules/investor.py](../scripts/batch_modules/investor.py), [scripts/batch_modules/credit_short.py](../scripts/batch_modules/credit_short.py)
- 투자자 수급: 정상 KIS 적재 행에 `collection_status=ok` 저장
- 공매도 거래량·잔고: 각각 `ok`, `no_row`, `api_error` 상태 저장
- 종합 상태: `ok`, `partial`, `no_data`로 구분
- 의미: 정상 응답에서 해당 날짜 행이 없어 0으로 채운 경우와 API 실패를 구분할 수 있음
- 보강: [scripts/backfill_investor_daily.py](../scripts/backfill_investor_daily.py)와 [scripts/_fetch_sectors.py](../scripts/_fetch_sectors.py)의 네이버 보조 적재는 `fallback`과 사유를 기록
- 검증: `python -m py_compile scripts/batch_modules/credit_short.py scripts/batch_modules/investor.py` 통과

### 완료: 중기 상대 모멘텀 기준 보강

- 대상: [src/services/strategyForwardTest.ts](../src/services/strategyForwardTest.ts), [scripts/strategy_forward_test.ts](../scripts/strategy_forward_test.ts)
- 기존: 최근 21일을 사실상 제외한 60일 단일 수익률
- 변경: 최근 21일을 제외한 63일 수익률 60%와 126일 수익률 40% 결합
- 유동성: 기존 일평균 거래대금 30억 원 기준 유지
- 검증: `pnpm build` 및 `pnpm test -- --filter strategyForwardTest` 통과

### 완료: ATR 돌파 비교 전략 추가

- 대상: [src/services/strategyForwardTest.ts](../src/services/strategyForwardTest.ts), [scripts/strategy_forward_test.ts](../scripts/strategy_forward_test.ts)
- 조건: 직전 55거래일 고점 돌파, 최근 20일 평균 대비 거래량 1.5배 이상, ATR/가격 12% 이하
- 결과: 기존 점수·수급·모멘텀 전략과 같은 주간 동일비중·교체비용 기준으로 `breakout-top5`를 전향 검증 결과에 추가
- 목적: 신호를 운영 전략에 즉시 반영하지 않고 비교 후보로만 기록
- 검증: `pnpm build` 및 `pnpm test -- --filter strategyForwardTest` 통과

### 완료: 전향 수급 전략의 품질 상태 반영

- 대상: [scripts/strategy_forward_test.ts](../scripts/strategy_forward_test.ts)
- `investor_daily.collection_status`를 조회하고 `fallback`, `partial`, `no_data` 행은 수급 전략 계산에서 제외
- 기존 상태가 없는 과거 행은 하위 호환을 위해 허용
- 검증: `pnpm build`, 전략 테스트, 수급·공매도 관련 Python 문법 검증 통과

### 즉시 진행

1. 전략 성과에 다음 지표를 공통 적용한다.
   - 순수익률
   - 최대 낙폭
   - 승률
   - 손익비 또는 profit factor
   - 거래 수
   - 최근 30일과 전체 기간 성과
2. 데이터 품질 상태를 전략 화면과 리포트에 표시한다.
   - 표본 수
   - 종목별 가격 데이터 커버리지
   - 수급 최신일
   - 부분 수집 여부
3. 상대 모멘텀 실험을 독립 전략으로 기록한다.
   - 63일 수익률
   - 126일 수익률
   - 최근 21일 제외
   - 섹터 대비 초과수익률
4. ATR 돌파 실험을 독립 전략으로 기록한다.
   - 20일 또는 55일 고가 돌파
   - 거래량 / 20일 평균 거래량
   - ATR 기반 손절과 포지션 크기

### 다음 단계

- `collection_status`와 `missing_reason`을 수급·공매도 원장에 추가
- 상장폐지·거래정지·유니버스 membership 이력 보존
- point-in-time 재무정보의 `available_at` 보존
- 다음 날 시가·VWAP·종가 등 진입 규칙 선택 가능하게 변경
- 수수료·세금·슬리피지 모델을 모든 비교 전략에 공통 적용

### 보류

- 옵션 변동성 곡선·스큐 기반 전략
- 데이터가 없는 상태에서 Quality·Value 점수 확장
- 짧은 표본만으로 자동 전략 승격

## 4. 품질 기준

전략을 승격 후보로 올리기 전에 다음을 모두 만족해야 한다.

- 동일한 유니버스와 동일한 비용 가정
- 학습 기간과 검증 기간 분리
- 최소 표본 수 충족
- 최근 30일 성과가 장기 성과와 크게 괴리되지 않음
- 최대 낙폭이 기존 전략보다 악화되지 않음
- 데이터 완전성 기준 미달 시 성과를 `데이터 부족`으로 표시
- 자동 전환 없이 관리자 승인으로만 운영 전략 변경

## 5. 블로그 원고 반영

기존 HTML은 수정하지 않고, 원본과 중복되지 않는 후속편을 별도 파일로 작성했다.

- 최종 원고: `D:\blog_solo_vs_institution_followup.html`

원고의 핵심 메시지는 기관의 우위가 단순한 정보량이 아니라 실행 비용, 시간, 기록, 위험관리의 구조적 차이에서 온다는 것이다. 기존 글의 시드·복리·생존편향·지수 보유 수치와 중복하지 않고, 모멘텀·ATR 돌파·수급 지속성·데이터 품질 메타데이터를 시스템 적용 관점으로 연결했다.

## 6. 다음 작업 시작점

가장 작은 코드 작업은 `backtest-risers.ts`의 수익률 계산을 공통 비용 모델과 체결 규칙으로 분리하는 것이다. 그 다음 `stock_credit_short_daily`와 `investor_daily`에 수집 상태를 추가하고, 모멘텀 실험 결과를 기존 전향 검증 결과와 같은 포맷으로 저장한다.
