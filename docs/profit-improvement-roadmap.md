# 수익성 개선 로드맵

> 작성일: 2026-05-29  
> 목적: 시스템 분석을 통해 발견한 수익성 개선 과제 정리. 즉시 수정 완료된 항목과 앞으로 구현할 항목을 구분.

---

## 완료된 수정 (2026-05-29)

### 1. Python 폴백 점수에 기관/외국인 수급 반영 (`batch_modules/scores.py`)

**문제**: `pnpm run sync:scores` (TS 엔진)가 실패할 때 Python 폴백이 실행되는데, 이 폴백은 `investor_daily` 테이블을 전혀 참조하지 않았음. 기관 수급 신호가 점수에 반영되지 않은 채 DB에 저장됨.

**수정 내용**:
- 최근 7일치 `investor_daily` 데이터를 로드해 종목별 5일 기관/외국인 순매수 합산
- 동반 매수(기관+외국인): `+12점`, 기관만: `+8점`, 외국인만: `+5점`
- 동반 매도: `-8점`
- `factors` JSON에 `institution_5d`, `foreign_5d` 저장

### 2. 레거시 스크립트 실수 실행 차단 (`generate_stock_scores.py`)

**문제**: 시가총액+섹터변화율만으로 점수를 계산하는 초기 스크립트가 남아있어, 실수로 실행하면 DB의 좋은 점수를 덮어씀.

**수정 내용**: 실행 즉시 경고 메시지 출력 후 `sys.exit(1)` 종료.

### 3. KIS API 키 누락 경고 강화 (`batch_modules/investor.py`)

**문제**: `.env`에 `KOREA_APP_KEY`가 없으면 조용히 스킵 — 수급 데이터가 며칠째 미갱신되어도 모를 수 있음.

**수정 내용**: 눈에 띄는 `[WARN]` 박스 출력으로 변경.

### 4. 풀백 신호 진입 등급에 RSI 반영 (`batch_modules/signals.py`)

**문제**: RSI가 `compute_pullback_signal`에서 계산되고 있었지만 `entry_grade`(A/B/C) 판단에 전혀 사용되지 않았음. 과매수 종목도 A등급을 받을 수 있는 상태.

**수정 내용**:
- RSI 40~60 골든존이면 B등급 → A로 승격
- RSI 35~68 허용구간 + 1점 조건이면 C → B 승격
- RSI > 72 과매수면 A → B 강등
- `warn_rsi_ob`에 RSI < 30 과매도 추가 (기존: 과매수만 감지)
- `entry_score`(0~4) 범위 및 DB 스키마 변경 없음

---

## 미완료 — 구현 필요

### A. 슬리피지 / 수수료 모델 추가 (난이도: 중)

**현재 문제**:  
가상 매매가 **종가로 체결된다고 가정**함. 실제 KRX는:
- 대형주(삼성전자급): 0.1~0.3% 스프레드
- 중소형주: 0.5~2.0% 스프레드
- 매수/매도 증권사 수수료: 0.015~0.25%

백테스트 수익률이 실제보다 연 기준 수 % 과대 추정됨.

**구현 방법**:  
`virtualAutoTradeService.ts`의 체결가 계산에 슬리피지 모델 적용.

```typescript
// src/services/virtualAutoTradeService.ts 에 추가할 함수
function applySlippage(price: number, side: "BUY" | "SELL", marketCap: number): number {
  const slippagePct =
    marketCap > 5_000_000_000_000 ? 0.001  // 5조 이상: 0.1%
    : marketCap > 500_000_000_000 ? 0.003  // 5천억~5조: 0.3%
    : 0.008;                                // 5천억 미만: 0.8%

  const commissionPct = 0.00015; // 증권사 수수료 0.015%
  const totalCostPct = slippagePct + commissionPct;

  return side === "BUY"
    ? price * (1 + totalCostPct)
    : price * (1 - totalCostPct);
}
```

`trades` 테이블에 `slippage_pct` 컬럼 추가해 추적 가능하게 할 것.

---

### B. Kelly Criterion 포지션 사이징 (난이도: 중~상)

**현재 문제**:  
`virtualAutoTradeSizing.ts`에서 ATR 기반 0.5~1.3배 조정은 있으나, 해당 종목/신호 패턴의 **기대값(win rate × RR)**에 비례한 배팅이 없음.

**구현 방법**:

1. 신호 패턴별 과거 win rate, profit factor를 `backtest_edge` 테이블에 저장
2. Kelly 공식으로 최적 배팅 비율 계산:

```typescript
// f* = (bp - q) / b
function kellyFraction(winRate: number, profitFactor: number): number {
  const q = 1 - winRate;
  const raw = (profitFactor * winRate - q) / profitFactor;
  // 과최적화 방지: Kelly의 25% (fractional Kelly)
  return Math.max(0, Math.min(raw * 0.25, 0.15)); // 최대 15%
}
```

3. `BacktestEdgeStat`의 `winRate`, `profitFactor`를 이미 계산 중 (`virtualAutoTradeService.ts:147-156`) — 연결만 하면 됨.

---

### C. 시장 국면(Market Regime) 감지 강화 (난이도: 상)

**현재 문제**:  
VIX + 공포탐욕지수 + 달러/원만 사용. 하락장 전환 초기를 감지 못해 개별 종목 신호만 보고 진입해 손실 발생 가능.

**구현 방법**:

#### C-1. 시장 브레드스(Market Breadth) 지표

```python
# scripts/batch_modules/market_breadth.py (신규 파일)
def calculate_market_breadth(supabase, trading_date):
    """전체 종목 중 상승/하락 비율, 52주 신고가/신저가 비율 계산"""
    # stock_daily에서 당일 등락 계산
    # advance_decline_ratio = 상승 종목 수 / 전체 종목 수
    # 0.35 미만: 하락장, 0.65 이상: 상승장
```

`market_env` 테이블 또는 `strategy_gates`에 `breadth_ratio` 컬럼 추가.

#### C-2. 변동성 클러스터링 감지

```typescript
// 20일 실현 변동성이 60일 평균의 1.5배 이상이면 고변동성 국면
function isHighVolatilityRegime(realizedVol20d: number, avgVol60d: number): boolean {
  return realizedVol20d > avgVol60d * 1.5;
}
```

#### C-3. 국면별 포지션 크기 조정표

| 국면 | 브레드스 | VIX | 포지션 크기 |
|------|---------|-----|-----------|
| 강세 | >0.60 | <18 | 100% |
| 중립 | 0.40~0.60 | 18~25 | 75% |
| 주의 | 0.30~0.40 | 25~35 | 50% |
| 방어 | <0.30 | >35 | 25% (신규 매수 중단) |

#### C-4. 시장 데이터 미수신 시 방어 모드 전환 (`scoreSyncService.ts:268`)

현재 외부 API 실패 시 빈 객체 반환 → VIX/공포탐욕이 `undefined`가 되어 중립(50)으로 처리됨.  
API 데이터가 4시간 이상 미갱신이면 강제로 "large-cap-defense" 모드로 전환해야 함.

```typescript
// src/services/scoreSyncService.ts 수정
const marketOverview = await fetchAllMarketData().catch(() => null);
if (!marketOverview || isDataStale(marketOverview, 4 * 60)) {
  console.warn("[score-sync] Market data stale — forcing defensive posture");
  // strategy_gates에 force_defensive=true 저장
}
```

---

### D. 멀티배거 발굴 필터 강화 (`src/services/longtermEngine.ts`)

**현재 문제**:  
PBR < 2.0, ROE > 8% 조건이 너무 느슨해 이익 없는 성장주, 일회성 이익 종목이 포함됨.

**추가할 필터**:

```typescript
const qualityFilters = {
  operatingProfitImproving2Q: opProfit[0] > opProfit[1] && opProfit[1] > opProfit[2],
  debtRatioDecreasing: debtRatio[0] < debtRatio[3],
  pegBelowOne: peg !== null && peg < 1.0,
  noCapitalImpairment: equity > 0,
};
```

---

### E. AVWAP 앵커 적응형 전환 (`src/indicators/avwap.ts`)

**현재 문제**:  
3개 고정 앵커(20%/50%/80% 기준)를 모든 종목에 동일하게 적용. 변동성이 높은 종목에서는 실제 지지선과 괴리 발생.

**구현 방법**:

```typescript
function adaptiveAvwapAnchors(atrPct: number): number[] {
  if (atrPct > 4) return [0.15, 0.50, 0.85]; // 고변동성
  if (atrPct > 2) return [0.20, 0.50, 0.80]; // 중변동성 (현재)
  return [0.25, 0.50, 0.75];                  // 저변동성
}
```

---

### F. 매도 신호 페이지네이션 실패 시 묵음 처리 (`src/lib/watchlistSignals.ts:227-251`)

**현재 문제**:  
`fetchWatchMicroSignalsByCodes()`의 DB 페이지네이션 루프에서 오류 발생 시 `if (error) break;`로 조용히 종료됨. 데이터가 불완전해도 알 수 없고, 매도 신호 미발생으로 이어질 수 있음.

```typescript
// 현재: 실패해도 조용히 break
if (error) break;

// 개선: 에러 추적 + 부분 데이터 신뢰도 하향
if (error) {
  console.warn(`[watchlist] flow fetch partial failure: ${error.message}`);
  dataConfidence = "partial";
  break;
}
```

**영향**: 수급 데이터 불완전 → `flowShift=false` → TAKE_PROFIT 트리거 미발동 → 고점 탈출 기회 소실.

---

### G. 매수가 0인 보유 종목에 추가매수 밴드 통과 (`src/services/virtualAutoTradeSelection.ts:936-938`)

**현재 문제**:  
추가매수 후보 선정 시 `buyPrice <= 0`이면 풀백 % 계산이 0으로 기본값 처리됨.

```typescript
const pullbackPct = holding.buyPrice > 0
  ? ((row.close - holding.buyPrice) / holding.buyPrice) * 100
  : 0; // 0은 항상 -6~+3% 밴드 통과 → 무조건 추가매수 대상이 됨
```

데이터 오류나 레거시 레코드로 `buyPrice=0`인 포지션이 있으면 **어떤 가격에서도 추가매수가 실행됨**.

**수정 방법**: `buyPrice <= 0`인 포지션은 추가매수 대상에서 명시적으로 제외.

```typescript
if (!holding.buyPrice || holding.buyPrice <= 0) {
  rejectedByReason.invalidBuyPrice = (rejectedByReason.invalidBuyPrice ?? 0) + 1;
  continue;
}
```

---

### H. 점수 엔진 200일 미만 종목 전면 제외 (`src/services/scoreSyncService.ts:297-301`)

**현재 문제**:  
OHLCV 이력이 200일 미만인 종목은 `skippedInsufficientSeries`로 분류되어 점수가 전혀 계산되지 않음. IPO 직후 150~180일 이력 종목이 스코어보드에서 완전히 누락됨.

**수정 방법**: 150~199일 이력 종목은 해당 기간 기준의 단축 계산 + 0.9× 신뢰도 보정 적용.

```typescript
const minLookback = series.length >= 200 ? 200
  : series.length >= 150 ? series.length  // 단축 계산
  : 0;

if (minLookback === 0) { skippedInsufficientSeries += 1; continue; }

const confidenceMultiplier = series.length >= 200 ? 1.0 : 0.9;
// score *= confidenceMultiplier 적용 후 저장
```

---

### I. TAKE_PROFIT 차단과 STOP_LOSS 차단 구분 불가 (`src/lib/watchlistSignals.ts:183-192`)

**현재 문제**:  
미시 신호 가드가 STOP_LOSS와 TAKE_PROFIT을 동일하게 차단하지만, 차단 유형 구분 없이 `action: "HOLD"`로만 반환됨. 로그에서 수익 실현 기회가 차단됐는지 손절이 차단됐는지 구분 불가.

```typescript
// WatchDecision 타입에 추가
blockedTakeProfit?: boolean; // 현재는 blockedStopLoss만 있음

// resolveWatchDecision 수정
return {
  action: "HOLD",
  blockedStopLoss: base.action === "STOP_LOSS",
  blockedTakeProfit: base.action === "TAKE_PROFIT", // 추가
};
```

**영향**: 목표가 도달 후 반전 시 포지션이 수익 실현 없이 보유 지속. 사후 분석 불가.

---

## 우선순위 요약

| 순위 | 항목 | 예상 효과 | 구현 난이도 | 예상 시간 |
|------|------|---------|-----------|---------|
| 1 | G. 추가매수 buyPrice=0 버그 | 데이터 오류로 인한 잘못된 매수 방지 | 하 | 30분 |
| 2 | I. TP/SL 차단 구분 | 수익 실현 기회 추적 및 감사 | 하 | 1시간 |
| 3 | B. Kelly 포지션 사이징 | 기대값 최적화, 수익성 직접 개선 | 중 | 1~2일 |
| 4 | A. 슬리피지 모델 | 백테스트 현실화, 과대 기대 방지 | 중 | 반나절 |
| 5 | F. 매도 신호 페이지네이션 에러 처리 | 고점 탈출 신호 유실 방지 | 하 | 1시간 |
| 6 | H. 점수 엔진 단축 계산 | IPO 직후 종목 발굴 | 중 | 반나절 |
| 7 | C. 시장 국면 감지 | 하락장 손실 방어 | 상 | 2~3일 |
| 8 | D. 멀티배거 필터 | 퀄리티 종목 집중 | 중 | 1일 |
| 9 | E. AVWAP 적응형 | 지지선 정확도 개선 | 하 | 반나절 |

---

## 배경 — 현재 시스템 점수 계산 경로

```
일배치 Step 5:
  1. pnpm run sync:scores (TS 엔진, 권장)
     → AVWAP + RSI + ROC + SMA + MACD + StablePro + 기관수급 반영
     → 실패 시 ↓
  2. Python 폴백 (batch_modules/scores.py)
     → RSI + ROC + SMA + 기관수급 반영 (2026-05-29 수정 후)

절대 실행 금지:
  python scripts/generate_stock_scores.py  ← 차단됨 (sys.exit)
```
