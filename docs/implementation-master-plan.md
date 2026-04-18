# Signal Scanner Bot 구현 마스터 플랜

- 작성일: 2026-04-17
- 원칙: 수익 극대화보다 **손실 방어 → 신호 일관성 → 복리 습관** 순으로 구현한다.
- 기준 프로파일: 보수형 (완료 항목에는 ✅, 진행 중은 🔄, 미착수는 ⬜)

---

## 완료된 작업 (2026-04-17 기준)

### 데이터 품질 기반 공사
- ✅ 실시간 시세 응답에 `source`, `fetchedAt` 추가 (`fetchRealtimePrice.ts`)
- ✅ 시장 데이터 응답에 `meta.isPartial`, `meta.missing`, `fetchedAt` 추가 (`fetchMarketData.ts`)
- ✅ 배치 조회 중복 호출 제거
- ✅ 브리핑, 시장 진단, 주간 리포트 캡션/요약에 데이터 품질 상태 노출 (부분 수집 경고, 조회 시각 KST 표시)

### 손실 방어 게이트
- ✅ 일손실 한도(`daily_loss_limit_pct`) 필드를 사용자 설정에 추가 (`userService.ts`)
- ✅ `/매매` 진입 시 KST 기준 당일 실현손익 합산 → 한도 초과 시 신규 진입 차단 + 복구 가이드 (`buy.ts`)
- ✅ `/투자금` 명령에서 일손실 한도 조회·통합 설정·단독 설정(`/투자금 손실한도 4`) 지원 (`capital.ts`)
- ✅ 기본 일손실 한도 5%로 설정 (투자 원금 또는 가상 씨앗 자본 기준)

### 재진입 감시
- ✅ `/관심대응` 플랜에 재진입 감시 조건 추가: 보유 관찰 상태 + 매매 플랜 매수 가능 구간 + 손실권 + 수급/거래대금 트리거 회복 시 1회 분할 재진입 후보 안내 (`watchlist.ts`)

### 명령 체계 정리
- ✅ `/점수`, `/매수` 별칭 제거, `/매매` 단일 진입점으로 통합 (`commandCatalog.ts`, `router.ts`)
- ✅ 콜백 prefix `score`, `buy` 제거 (`commandCatalog.ts`, `worker.ts`, `sector.ts`)
- ✅ 도움말·프롬프트 문구를 신규 투자금 포맷(일손실 한도 포함)에 맞게 갱신

### 신호 일관성 1차
- ✅ 1-1 완료: 점수 소비 지점 기준 통일 (브리핑·스캔·매매·마켓픽의 점수 소스를 DB `scores` 최신 스냅샷 기준으로 정렬, 즉석 재계산 경로 제거/축소)

---

## 구현 항목 상태 (2026-04-18 점검)

---

### BLOCK 1 — 신호 일관성 (점수 단일화) `[필수 선행]`

> 브리핑, 스캔, 리포트가 동일한 점수를 보여줘야 사용자 판단이 신뢰 가능하다.
> 이 블록이 끝나야 이후 모든 신호 기반 기능의 정확도가 의미를 가진다.

#### ✅ 1-1. scores 소비 지점 파악 및 기준 통일 (완료)
- **목표**: `scores` 테이블을 참조하는 모든 화면이 동일한 기준으로 점수를 읽도록 정리
- **현황**: 완료. `briefingService.ts`, `scan.ts`, `buy.ts`, `marketPicks.ts` 점수 경로를 DB `scores` 최신 스냅샷 기준으로 정렬
- **작업(완료)**:
  - `rg "from(\"scores\")|table(\"scores\")|calculateScore("  src/` 로 소비 지점 전수 추출
  - DB 최신 스냅샷 기준(`fetchLatestScoresByCodes`)으로 소비 경로 통일
  - `/매매`, `/마켓픽`의 즉석 재계산 경로 제거/축소로 화면 간 점수 편차 리스크 완화
- **검증**: 동일 종목·동일 시점에서 브리핑·스캔·매매 분석 점수가 ±2점 이내인지 확인
- **예상 소요**: 반나절
- **파일**: `src/services/briefingService.ts`, `src/bot/commands/scan.ts`, `src/bot/commands/marketPicks.ts`, `src/score/engine.ts`

#### ✅ 1-2. 점수 배치 저장 파이프라인 역할 재정의 (완료)
- **목표**: `scripts/update_stock_scores.py`를 점수 생성기가 아닌 저장/동기화 역할로 축소
- **현황**: 완료. TS 엔진 점수 동기화 경로(`api/cron/scoreSync.ts`, `src/services/scoreSyncService.ts`, `pnpm run sync:scores`)를 추가해 DB 저장 기준을 통일
- **작업**:
  - Python 배치가 DB에 저장하는 `score` 값 범위 확인
  - TS `calculateScore()` 결과를 DB에 저장하는 별도 스크립트 또는 cron 경로 추가
  - Python 배치는 외부 데이터 수집(OHLCV/기업정보) 역할만 담당하도록 범위 축소
  - 저장 필드 최소 정합: `total_score`, `signal`, `factors(JSON)`, `asof`
- **예상 소요**: 반나절 ~ 1일
- **파일**: `scripts/update_stock_scores.py`, `src/score/engine.ts`, `api/cron/`

#### ✅ 1-3. 지표 팩터 적재 확장 (완료)
- **목표**: DB에 최신 기술 팩터를 일관되게 저장해 재계산 없이 재사용
- **현황**: 완료. `scores.factors`에 SMA200, ROC14/21, AVWAP, MACD, ATR, 거래량 비율 등이 적재되도록 확장
- **작업**:
  - `scores.factors` JSONB 필드에 위 인자를 저장하도록 Python 배치 또는 cron 추가
  - 저장 후 브리핑·스캔에서 재계산 대신 DB 값 활용 경로 확인
- **예상 소요**: 반나절
- **파일**: `scripts/update_indicators.py`, `src/score/engine.ts`

---

### BLOCK 2 — 손실 방어 심화

> BLOCK 1 없이도 단독 구현 가능. 사용자 행동을 규율하는 규칙을 봇에 내장한다.

#### ✅ 2-1. 일손실 한도 게이트를 브리핑/알림에도 적용 (완료)
- **목표**: `/매매` 외에도 브리핑 추천 섹션, `/관심자동` 자동 매수 경로에 일손실 게이트 반영
- **현황**: 완료. 브리핑 및 관심 자동 경로에서 일손실 한도 상태를 반영
- **작업**:
  - `briefingService.ts` — 추천 종목 섹션 하단에 "오늘 일손실 한도 도달 — 추천 확인만 권고" 경고 삽입
  - `/관심자동` 자동 매도/진입 실행 전 동일 게이트 통과 확인
- **예상 소요**: 1~2시간
- **파일**: `src/services/briefingService.ts`, `src/bot/commands/watchlist.ts`

#### ✅ 2-2. VIX/공포탐욕 연동 포지션 축소 정책 (완료)
- **목표**: 고변동 장에서 `/매매` 투자 계획의 수량 상한을 자동으로 축소해 노출을 줄임
- **현황**: 완료. `buildInvestmentPlan()`에 VIX/공포탐욕 기반 `sizeFactor` 축소/확대 로직 반영
- **작업**:
  - `buildInvestmentPlan()` 입력에 `marketEnv.vix` 가 있을 때 `sizeFactor` 계산 추가:
    - VIX ≥ 30 → 포지션 상한 50% 축소
    - VIX 25~30 → 30% 축소
    - 공포탐욕 ≤ 20 (역발상 구간) → 10% 확대 허용
  - `/매매` 결과 메시지에 "고변동 장 포지션 축소 적용 중" 안내 추가
- **예상 소요**: 1~2시간
- **파일**: `src/lib/investPlan.ts`, `src/bot/commands/buy.ts`

#### ✅ 2-3. 손절 미이행 경고 (`/관심대응` 확장) (완료)
- **목표**: 손절선을 이미 하회했는데도 보유가 계속되는 종목을 감지해 경고
- **현황**: 완료. 손절 억제 시 별도 경고 및 장기 미이행(3거래일+) 강조 문구 반영
- **작업**:
  - `resolveWatchDecision()`이 `STOP_LOSS` 반환 + `executionGuardPassed=false` 인 경우 → "손절 미이행 주의" 별도 섹션으로 강조 출력
  - 손절선 하회 경과일수 계산 후 3거래일 이상이면 "장기 미이행 — 즉시 점검 권고" 추가
- **예상 소요**: 2~3시간
- **파일**: `src/bot/commands/watchlist.ts`, `src/lib/watchlistSignals.ts`

#### ✅ 2-4. 섹터 과집중 자동 경고 (`/매매` 진입 시) (완료)
- **목표**: `/매매` 분석 결과 하단에 이미 해당 섹터 비중이 높은 경우 경고 삽입
- **현황**: 완료. `/매매` 분석 응답 하단에 섹터 비중 30%+ 경고 삽입
- **작업**:
  - `handleBuyCommand()` — 종목 분석 결과 생성 전 현재 watchlist 섹터 집중도 조회
  - 해당 종목 섹터가 30% 초과 시 "⚠️ 현재 [섹터명] 비중 XX% — 진입 시 추가 집중" 경고 삽입
- **예상 소요**: 1~2시간
- **파일**: `src/bot/commands/buy.ts`, `src/services/portfolioService.ts`

---

### BLOCK 3 — 성과 측정 & 복기

> 복리의 실체는 성과 데이터를 보고 전략을 조정하는 습관에서 온다.

#### ✅ 3-1. 월간 성과 집계 KPI 추가 (완료)
- **목표**: 주간 리포트와 별개로 `/리포트 월간` 텍스트 요약 제공
- **현황**: 완료. `/리포트 월간` 텍스트 리포트 및 KPI 집계 제공
- **작업**:
  - `weeklyReportData.ts`의 `summarizeWindow()` 를 월 단위 범위로 재사용
  - 집계 항목: 월별 거래 수, 승률, FIFO 실현손익, 손익비(평균 수익/평균 손실), 최대 단일 손실, 규칙 준수율(손절 미이행 0건이면 100%)
  - `/리포트 월간` 텍스트 메시지 핸들러 추가 (PDF 없이 텍스트 먼저)
- **예상 소요**: 반나절
- **파일**: `src/services/weeklyReportData.ts`, `src/bot/commands/report.ts`, `src/bot/router.ts`

#### ✅ 3-2. 보유기간 추적 + 만기 알림 (완료)
- **목표**: `/관심대응`에 `buildInvestmentPlan()`의 `holdDays` 상한을 초과한 종목에 만기 경고 추가
- **현황**: 완료. 보유기간 상한 초과 시 `/관심대응`에서 만기 경고 표시
- **작업**:
  - `handleWatchlistResponseCommand()` — 진입일 기준 경과 거래일 계산(주말 제외 근사)
  - `holdDays[1]` 초과 시 "보유기간 상한(N일) 초과 — 익절·손절 여부 재판단 권고" 경고
- **예상 소요**: 1~2시간
- **파일**: `src/bot/commands/watchlist.ts`, `src/lib/investPlan.ts`

#### ✅ 3-3. 손익비 통계 개선 (완료)
- **목표**: 주간 리포트에 평균 수익 거래 수익률 vs 평균 손실 거래 손실률 비율 표시
- **현황**: 완료. `avgWinPct`, `avgLossPct`, `payoffRatio` 집계 및 리포트 반영
- **작업**:
  - `summarizeWindow()` 반환값에 `avgWinPct`, `avgLossPct`, `payoffRatio` 추가
  - 주간 리포트 PDF의 거래 통계 섹션에 손익비 줄 추가
- **예상 소요**: 1~2시간
- **파일**: `src/services/weeklyReportData.ts`, `src/services/weeklyReportSections.ts`

---

### BLOCK 4 — 데이터 노출 고도화

#### ✅ 4-1. 섹터 점수식 고도화 (완료)
- **목표**: 단순 등락률 의존에서 벗어나 breadth와 수급 정규화 반영
- **현황**: 완료. breadth·시총가중 수급·리더강도 및 점수 구성요소를 `metrics`에 분리 저장
- **작업**:
  - 상승 종목 비율(breadth), 시총 가중 수급, 리더 종목 상대강도 지표 계산 추가
  - 섹터 점수 구성요소를 `metrics` JSONB에 분리 저장
  - 섹터 점수 변화가 급격할 때 이상징후 감지 연계
- **예상 소요**: 반나절
- **파일**: `scripts/update_sector_scores.py`, `src/lib/sectors.ts`

#### ✅ 4-2. 이상징후 감지 고도화 (`/알림` 확장) (완료)
- **목표**: 현재 경량 점검에서 실질적인 위험 패턴 감지로 강화
- **현황**: 완료. 거래대금 3배·변동률 5% 교차 감지, 3일 순위 급변 경고, "오늘 주의 종목" 섹션 반영
- **작업**:
  - 거래대금 3배 이상 급증 종목 + 일중 변동률 5% 이상 종목을 관심 목록과 교차 감지
  - 섹터 강도 순위가 3일 내 3단계 이상 이동 시 순환매 경고
  - 감지 결과를 `/알림` 응답에 "오늘 주의 종목 N건" 섹션으로 추가
- **예상 소요**: 반나절 ~ 1일
- **파일**: `src/bot/commands/alert.ts`, `src/lib/sectors.ts`

---

### BLOCK 5 — 운영 안정성

> 기능이 많아질수록 배포 전 검증이 중요해진다.

#### ✅ 5-1. 로깅 표준화 (완료)
- **목표**: 브리핑/리포트 생성 소요시간과 실패 사유를 구조적으로 기록
- **현황**: 완료. 워커/브리핑/리포트 단계별 구조화 로그(`step`, `duration_ms`, `error_type`) 적용
- **작업**:
  - `api/worker.ts`에 명령별 처리 시작/종료 시각과 에러 유형 로그 추가
  - `briefingService.ts`, `weeklyReportService.ts`에 단계별 소요시간 로그 추가 (dev 환경)
  - 실패 시 `step`, `duration_ms`, `error_type`을 포함한 구조화 JSON 로그
- **예상 소요**: 반나절
- **파일**: `api/worker.ts`, `src/services/briefingService.ts`, `src/services/weeklyReportErrors.ts`

#### ✅ 5-2. 회귀 테스트 기반 다지기 (완료)
- **목표**: 점수 계산·브리핑·재무 파서 변경 시 자동으로 회귀를 잡아내는 테스트 추가
- **현황**: 완료. `investPlan`, `scoreEngine`, `watchlistSignals` 테스트 추가 및 `pnpm test` 연동
- **작업**:
  - `buildInvestmentPlan()` 입력/출력 픽스처 기반 단위 테스트 3~5케이스
  - `calculateScore()` 경계값 테스트 (VIX 30, RSI 30/70 구간)
  - `resolveWatchDecision()` STOP_LOSS / TAKE_PROFIT / HOLD 결정 경로 테스트
  - `pnpm test` 스크립트가 위 테스트를 실행하도록 `package.json` 설정
- **예상 소요**: 1일
- **파일**: `tests/`, `package.json`

---

## 실행 순서 요약

```
BLOCK 1 (신호 일관성)
  └─ 1-1 scores 소비 지점 통일
  └─ 1-2 배치 파이프라인 역할 재정의
  └─ 1-3 지표 팩터 적재 확장

BLOCK 2 (손실 방어 심화)
  └─ 2-1 브리핑/자동매매에도 일손실 게이트 적용
  └─ 2-2 VIX 연동 포지션 축소
  └─ 2-3 손절 미이행 경고
  └─ 2-4 섹터 과집중 진입 경고

BLOCK 3 (성과 측정)
  └─ 3-1 월간 KPI 집계
  └─ 3-2 보유기간 만기 알림
  └─ 3-3 손익비 통계 개선

BLOCK 4 (데이터 고도화)
  └─ 4-1 섹터 점수식 고도화
  └─ 4-2 이상징후 감지 강화

BLOCK 5 (운영 안정성)
  └─ 5-1 로깅 표준화
  └─ 5-2 회귀 테스트 기반
```

---

## 제외 범위 (이 플랜에서 다루지 않음)

- 완전 자동매매 집행 (봇은 판단 보조 역할 유지)
- 신규 외부 데이터 소스 전면 도입 (알파 데이터, 옵션 등)
- UI/UX 전면 개편
- 공격형 전략 (피라미딩, 고레버리지 등)

---

## 검증 기준 (각 블록 완료 시)

| 블록 | 검증 항목 |
|------|----------|
| BLOCK 1 | 동일 종목·시점 브리핑·스캔·매매 점수 ±2점 이내 |
| BLOCK 2 | 일손실 한도 초과 계정에서 모든 진입 경로 차단 확인, VIX 30 샘플에서 수량 50% 축소 확인 |
| BLOCK 3 | `/리포트 월간` 응답 정상 출력, 손익비 통계 일치 검증 |
| BLOCK 4 | 섹터 점수 변화폭 감소 확인, 이상징후 감지 실제 케이스 1건 이상 |
| BLOCK 5 | 빌드·테스트 통과, 실패 로그에 `step`/`duration_ms` 포함 확인 |

공통 명령: `pnpm build` → `pnpm test` → `pnpm verify:vercel`
