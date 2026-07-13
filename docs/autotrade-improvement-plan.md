# 자동매매 수익률 개선 구현 계획 (P0~P5)

> 2026-07-13 진단 결과 기반. 이 문서만 보고 구현을 이어받을 수 있도록 작성.
> 진단 요약: 6/23~7/10 매매 대부분이 "동결된 종가"(예: 204320이 2주간 65,000원 고정) 위에서 실행됨.
> 봇은 가짜 +28% 익절을 반복 인식 → 성과게이트가 PF 18로 착각해 기준 완화 → 실제로는 -266,245원 실현손실.
> 종가 계산 버그 자체는 4eee429(2026-07-11)에서 수정됨. 아래는 재발 방지 + 구조 개선.

## 대상 파일
- `src/services/virtualAutoTradeService.ts` (메인 오케스트레이션, ~6,700줄)
- `src/services/virtualAutoTradeSelection.ts` (순수 판정 함수 — 테스트 가능한 로직은 여기로)
- `src/services/virtualAutoTradeSizing.ts`
- `src/services/virtualAutoTradePositionStrategy.ts`
- `src/services/decisionLogService.ts`
- `src/indicators/atr.ts` (기존 ATR 유틸, 그대로 사용)
- `tests/virtualAutoTradeService.test.ts`

---

## P0. 종목별 종가 신선도/동결 서킷브레이커

현재 상태: 계정 단위 가드만 존재 (`virtualAutoTradeService.ts` ~4269, `stocks.updated_at` 최대값이 3일
이상 오래되면 일일점검 전체 스킵). 약점: 보유종목 중 하나만 신선해도 통과하고, updated_at은 갱신되는데
close만 동결되는 부분 장애를 못 잡음.

구현:
1. `virtualAutoTradeSelection.ts`에 순수 함수 추가:
   ```ts
   export type CloseFreshnessRow = { date: string; close: number; volume?: number | null };
   export function evaluateCloseFreshness(
     rows: CloseFreshnessRow[],           // 최신순 정렬
     opts?: { nowMs?: number; maxStaleCalendarDays?: number; frozenCloseSessions?: number }
   ): { ok: boolean; reason: "no-data" | "stale-date" | "frozen-close" | null; staleDays: number | null }
   ```
   - rows 없음 → no-data
   - 최신 date가 5 캘린더일(기본값, 주말+공휴일 감안) 초과 → stale-date
   - 최근 4세션 close가 전부 동일하고 그중 volume > 0인 세션 존재 → frozen-close
     (유동성 있는 종목이 4일 연속 같은 종가 + 거래량 존재 = 사실상 파이프라인 동결)
2. `virtualAutoTradeService.ts` 일일점검(daily review)에서 `closeByCode` 구성 직후:
   - 보유종목 코드에 대해 `stock_daily`에서 최근 60일 `date, close, high, low, volume` 일괄 조회
     (`.in("code", codeList).gte("date", ...)` — 이 데이터는 P2 ATR 계산에도 재사용)
   - 종목별 evaluateCloseFreshness 실행. `ok=false`면 그 종목의 매도/익절 판단 전체 스킵
     (`summary.skipped`, actionType SKIP / reason "stale-or-frozen-close", summary.notes에 명시)
   - stock_daily에 high/low 컬럼이 없으면(스키마 확인 필요) close만으로 동결 감지, ATR은 close-to-close
     변동성(표준편차)으로 대체
3. 매수 쪽은 이미 게이트 있음(점수 asof 1영업일 초과 시 차단, `selectMondayCandidates` ~2663) — 손대지 않음.

## P1. 적응형 통계에서 오염 기간 제외 + 최소 표본 상향

1. `virtualAutoTradeSelection.ts`에 상수 export:
   ```ts
   /** 종가 파이프라인 동결 사고(2026-06-12~07-10, 4eee429에서 수정) 기간의 거래를
    *  적응형 통계에서 제외하는 컷오프. 이 이전 거래는 전략이 아니라 데이터 버그를 측정한 것. */
   export const ADAPTIVE_STATS_EXCLUDE_BEFORE_ISO = "2026-07-11T00:00:00+09:00";
   ```
2. `virtualAutoTradeService.ts` `getRecentAutoTradeSellPerformance` (~2003):
   `since = max(since, ADAPTIVE_STATS_EXCLUDE_BEFORE_ISO)` (ISO 문자열 비교로 충분).
3. `decisionLogService.ts` `getFactorWinRateSummary` (~283): sinceIso에 동일 컷오프 적용 (import).
4. `applyPerformanceBuyGuard` (~2072): risk-on(완화) 조건 `sellCount >= 12` → `>= 20`.
   risk-off(보수)는 8건 유지 (적은 표본으로 보수적으로 가는 건 안전).
5. `applyAdaptiveExitGuard` (~2122): 최소 표본 5 → 10. (P2에서 함수 자체 변경됨)

## P2. ATR 기반 손절 + 연속손실 시 "손절 타이트닝" 제거, 사이즈 축소로 대체

1. `applyAdaptiveExitGuard` 수정 (virtualAutoTradeService.ts ~2122):
   - **연속손실 3회 → 손절 4%→3% 타이트닝 브랜치 삭제** (방향이 반대: 더 타이트하면 휘핑쏘 악화)
   - 반환값에 `buySizeScale: number` 추가: maxLossStreak >= 5 → 0.4, >= 3 → 0.6, 그 외 1.0
     (순수 함수 `resolveLossStreakSizeScale(maxLossStreak)`를 selection 모듈에 만들어 재사용)
   - 익절 연장 브랜치는 유지하되 `sellCount >= 10` → `>= 20`
2. buySizeScale 배선:
   - 일일점검: add-on 사이징(~4998 `riskBudgetScale: dailyRiskBudget.scale`)과 rebalance 사이징의
     riskBudgetScale에 `* adaptiveExitGuard.buySizeScale` 곱함
   - 월요매수: `mondaySellPerf.maxLossStreak`로 `resolveLossStreakSizeScale` 직접 호출해 동일 적용
     (월요매수 흐름의 사이징 호출부에서 riskBudgetScale에 곱함)
3. ATR 기반 손절 확장:
   - selection 모듈에 순수 함수:
     ```ts
     export function resolveVolatilityAdjustedStopPct(input: { baseStopLossPct: number; atrPct: number | null }): number
     // atrPct 없으면 base 그대로. 있으면 max(base, min(12, 2.2 * atrPct))
     ```
   - 일일점검 루프에서 P0에서 가져온 stock_daily 히스토리로 `calcATR`(src/indicators/atr.ts) 계산
     → `tradeProfile.stopLossPct` 대신 조정값을 `resolveAdaptiveExitThreshold`에 전달
   - `resolveAdaptiveExitThreshold`(~896)의 stopLossPct 클램프 상한 8 → 12로 상향
     (안 올리면 ATR 확장이 클램프에서 다시 깎임). takeProfitPct < stopLossPct + 1.5 보정은 유지.
   - 참고: catastrophic -10%/-15%, halfExit -7%/-12% 백스톱은 그대로 둠 (계층 방어)

## P3. 대형주 방어 모드에서 신규매수/추매 완전 차단

현재: 방어 모드는 후보 필터(대형 KOSPI만)와 익절목표 -1%p 조정만 하고 매수 자체는 허용 →
6/23, 7/8 방어 모드에서 매수 직후 손실. "현금 보유"가 하락장 전략이 되도록:
1. 월요매수(runMondayBuy, ~3104): `const remainSlots = buyConstraint.buySlots` →
   방어 모드면 0으로 강제 + note `[레짐게이트] 대형주 방어 모드: 신규 매수 중단 (기존 포지션 관리만)`
2. 일일점검 rebalance-buy (~5290): `rawBuySlots` 계산에 동일 게이트
3. 일일점검 add-on buy 섹션 시작부: 방어 모드면 추매도 스킵 (note 동일 계열)
4. actionType SKIP / reason "regime-defense-no-new-buy"로 로그

## P4. 손실 매도 후 재매수 쿨다운 무조건화

현재(2e14711): loss-trim 2~6일, 익절 2일 쿨다운, STRONG_BUY+80점이면 전부 오버라이드 가능.
실제 사고: 032830을 7/10 340,500원 손실 매도 → 같은 날 344,500원 재매수.
1. `resolveTakeProfitCooldownDays` (selection 모듈): loss-trim을 pnl에 따라 5/6/8일로 상향
   (<= -8% → 8일, <= -4% → 6일, 그 외 5일). 익절(take-profit-*)은 2일 유지.
2. 오버라이드를 손실 매도에는 적용 금지:
   - `fetchTakeProfitCooldownCodes`(service ~1746)가 `Set<string>` 대신
     `Map<string, { canOverride: boolean }>` 반환.
     canOverride = reason이 take-profit-*이고 pnlPct(resolveExitPnlPct) > 0인 경우만 true.
   - `selectMondayCandidates`(~2847)의 오버라이드 필터에서 canOverride=false면
     shouldOverrideTakeProfitCooldown 무시하고 무조건 배제.
   - lookbackDays 10 → 12 (최장 쿨다운 8일 커버 여유)
3. 기존 stop-loss 쿨다운(5~10일, 오버라이드 없음)은 그대로.

## P5. 자잘한 버그/충돌

1. `planOverweightReduction` (virtualAutoTradePositionStrategy.ts ~581):
   - `quantity <= 1`이면 HOLD 반환 (현재 qty=1일 때 `Math.max(1, Math.min(raw, 0))` = 1로
     "최소 1주 유지" 의도와 달리 마지막 1주를 팔아버림)
   - `quantityToSell = Math.min(rawQtyToSell, quantity - 1)`; 1 미만이면 HOLD
2. `virtualAutoTradeSizing.ts` `MAX_POSITION_WEIGHT` 0.25 → 0.20:
   현재 확신도 1.2 × (시드/5종목=20%) = 24% 매수 직후, 출구쪽 비중상한 25%와 1%p 차이라
   가격이 조금만 올라도 비중조정 매도(→ 손실이면 loss-trim 라벨) 트리거되는 핑퐁 구조.
   매수 상한을 출구 목표비중(TARGET_WEIGHT_PCT=20)과 일치시켜 해소.

## 검증
1. `npx tsc --noEmit`
2. `tests/virtualAutoTradeService.test.ts` 갱신: 쿨다운 일수 변경, evaluateCloseFreshness,
   resolveVolatilityAdjustedStopPct, resolveLossStreakSizeScale, planOverweightReduction qty=1 케이스
3. 테스트 실행 (package.json의 test 스크립트 확인, 보통 `node --test` 계열)
4. dry-run 실행 경로가 있으면 (payload.dryRun) 일일점검 한 번 돌려 notes 확인
