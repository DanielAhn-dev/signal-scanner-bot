# Data Enhancement Roadmap

## 이번에 바로 반영한 것
- 실시간 시세 응답에 source, fetchedAt 메타데이터 추가
- 실시간 배치 조회에서 중복 종목 코드 제거
- 시장 데이터 응답에 meta.fetchedAt, meta.isPartial, meta.missing 추가

## Resume Point
- 현재 상태: 빠른 데이터 고도화 1차 반영 완료, pnpm build 통과
- 바로 시작할 다음 작업: P1. 점수 계산 단일화
- 시작 파일:
  - [src/score/engine.ts](src/score/engine.ts)
  - [scripts/update_stock_scores.py](scripts/update_stock_scores.py)
  - [src/services/briefingService.ts](src/services/briefingService.ts)
  - [src/bot/commands/scan.ts](src/bot/commands/scan.ts)
- 빠른 확인 명령:
  - pnpm build
  - rg "from\(\"scores\"\)|table\(\"scores\"\)|calculateScore\(" src scripts

## 왜 이걸 먼저 했는가
- 현재 데이터 조회는 실패 시 조용히 빈 값으로 떨어지는 경우가 많아, 정상 0값과 조회 실패를 소비 코드가 구분하기 어려움
- 같은 종목 코드가 여러 경로에서 중복 수집될 수 있어 불필요한 네트워크 호출이 발생함
- 작은 범위 수정으로도 이후 UI/브리핑/리포트에서 freshness 표시와 결측 진단을 붙일 수 있음

## 현재 확인된 핵심 병목
1. 점수 엔진과 배치 저장 파이프라인 불일치
- [src/score/engine.ts](src/score/engine.ts) 는 SMA/RSI/ROC/AVWAP/MACD/ATR/시장 보정까지 계산
- [scripts/update_stock_scores.py](scripts/update_stock_scores.py) 는 아직 universe_level 기반 고정 점수에 가까움
- 결과적으로 일부 화면은 실시간 계산, 일부는 DB score 사용이라 결과 일관성이 깨질 수 있음

2. 지표 적재 범위 부족
- [scripts/update_indicators.py](scripts/update_indicators.py) 는 SMA20, SMA50, RSI14 정도만 stocks에 적재
- 실제 엔진이 쓰는 SMA200, ROC, AVWAP, MACD, ATR, 거래량 비율은 저장 파이프라인이 없음

3. 시장 데이터 결측/부분 성공 가시성 부족
- 이번에 meta.isPartial, meta.missing 을 추가했지만 아직 소비 코드가 표시하지 않음
- 브리핑/리포트/시장 명령에서 이 메타를 읽어 사용자에게 일부 데이터 누락을 안내할 필요가 있음

4. 섹터 수급 정규화 미흡
- [scripts/update_sector_scores.py](scripts/update_sector_scores.py) 는 상위 종목 샘플링 합산 방식
- 시총 대비 정규화, breadth, 5일/20일 흐름 비율화가 아직 없음

## 다음 우선순위

### P1. 점수 계산 단일화
- 목표: scores 테이블을 [src/score/engine.ts](src/score/engine.ts) 결과 기준으로 채움
- 작업:
  - Python 배치를 대체하거나 축소
  - score, signal, entry/stops/targets, factors 저장 구조 정리
  - scores를 읽는 화면과 즉석 계산 화면의 기준 통일
- 기대 효과: 추천/스캔/브리핑 결과 일관성 확보
- 예상 소요: 반나절 ~ 1일

### P2. 지표 팩터 적재 확장
- 목표: DB에 최신 기술 팩터를 일관되게 저장
- 작업:
  - indicators 전용 테이블 또는 scores.factors 중심 저장 결정
  - SMA200, ROC14/21, vol_ratio, AVWAP support, MACD cross/divergence, ATR 적재
- 기대 효과: 브리핑/리포트/봇 명령에서 재계산 없이 같은 팩터 재사용 가능
- 예상 소요: 반나절

### P3. freshness/partial 데이터 노출
- 목표: 사용자 메시지에 데이터 품질 상태 노출
- 작업:
  - [src/bot/commands/market.ts](src/bot/commands/market.ts) 에 partial/missing 안내 추가
  - [src/services/briefingService.ts](src/services/briefingService.ts) 에 stale or partial 주석 추가
  - weekly report caption 또는 summary에 기준 시각 노출
- 기대 효과: 조용한 실패를 운영자가 더 빨리 인지 가능
- 예상 소요: 1~2시간

### P4. 섹터 점수식 고도화
- 목표: change_rate 단순 의존을 줄이고 breadth와 정규화 수급 반영
- 작업:
  - 상승 종목 비율, 시총 가중 수급, 리더 종목 상대강도 반영
  - 섹터 점수 구성요소를 metrics에 분리 저장
- 기대 효과: 순환매/주도 섹터 탐지가 덜 노이즈해짐
- 예상 소요: 반나절

## 다른 작업 공간에서 이어갈 때 권장 순서
1. P1 점수 계산 단일화부터 진행
2. P2로 저장 팩터 범위를 확장
3. P3으로 사용자 가시성 추가
4. P4로 섹터 점수식 개선

## 이번 변경 파일
- [src/utils/fetchRealtimePrice.ts](src/utils/fetchRealtimePrice.ts)
- [src/utils/fetchMarketData.ts](src/utils/fetchMarketData.ts)

## 오늘 여기까지 끝난 것
- 실시간 가격 응답 구조에 freshness 메타데이터 추가
- 시장 데이터 응답 구조에 partial/missing 메타데이터 추가
- 배치 조회 중복 호출 제거
- 남은 데이터 작업을 단계별 로드맵으로 문서화

## 다음 작업 시작 기준
- P1을 시작할 때는 Python 배치 전체를 바로 갈아엎기보다, 먼저 scores 테이블의 저장 스키마와 소비 지점을 맞추는 쪽으로 진행
- 점수 계산 기준은 [src/score/engine.ts](src/score/engine.ts) 를 단일 소스로 삼는 방향 권장
- DB 저장 필드는 최소 score, signal, factors, asof 정합성을 먼저 맞추고 entry/stops/targets 는 2차 확장으로 미뤄도 됨