import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStrategyBuyConstraint,
  computeDynamicLargeCapFloor,
  detectAutoTradeMarketPolicy,
  deriveAdaptiveMinBuyScore,
  pickAutoTradeAddOnCandidates,
  pickAutoTradeCandidates,
  resolveDeployableCash,
  selectRunType,
} from "../src/services/virtualAutoTradeSelection";
import {
  classifyAutoTradeEntryProfile,
  buildPositionStrategyMemo,
  parsePositionStrategyState,
  planAutoTradeExit,
  resolvePositionTradeProfile,
} from "../src/services/virtualAutoTradePositionStrategy";
import {
  isKrxIntradayAutoTradeWindow,
  kstWindowKey,
} from "../src/services/virtualAutoTradeTiming";

test("selectRunType: auto 모드는 요일과 무관하게 daily review를 선택한다", () => {
  const sundayUtc = new Date("2026-04-19T18:00:00.000Z");
  assert.equal(selectRunType("auto", sundayUtc), "DAILY_REVIEW");
});

test("deriveAdaptiveMinBuyScore: 현재 상위 점수대에 맞춰 기준을 완화한다", () => {
  assert.equal(deriveAdaptiveMinBuyScore(70, 53), 50);
  assert.equal(deriveAdaptiveMinBuyScore(70, 40), 37);
  assert.equal(deriveAdaptiveMinBuyScore(70, 34), 31);
});

test("pickAutoTradeCandidates: BUY 신호가 없어도 완화 신호(HOLD) 우선으로 후보를 반환한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 53, name: "Alpha", signal: "HOLD" },
      { code: "B", close: 9000, score: 51, name: "Beta", signal: "HOLD" },
      { code: "C", close: 8000, score: 47, name: "Gamma", signal: "SELL" },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
  });

  assert.equal(result.selectionMode, "signal-relaxed");
  assert.equal(result.thresholdUsed, 50);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["A", "B"]
  );
});

test("detectAutoTradeMarketPolicy: 고변동 구간은 대형주 방어 모드로 전환한다", () => {
  const policy = detectAutoTradeMarketPolicy({
    overview: {
      vix: { price: 31 },
      fearGreed: { score: 24 },
      usdkrw: { changeRate: 1.1 },
      kospi: { changeRate: -2.1 },
      kosdaq: { changeRate: -2.8 },
    },
  });

  assert.equal(policy.mode, "large-cap-defense");
  assert.equal(policy.minCashReservePct, 35);
  assert.deepEqual(policy.allowedMarkets, ["KOSPI"]);
});

test("detectAutoTradeMarketPolicy: breadth 악화도 방어 모드 트리거에 포함한다", () => {
  const policy = detectAutoTradeMarketPolicy({
    overview: {
      vix: { price: 20 },
      fearGreed: { score: 45 },
      breadth: { advancingRatio: 28 },
      usdkrw: { changeRate: 0.2 },
      kospi: { changeRate: 0.1 },
      kosdaq: { changeRate: 0.3 },
    },
  });

  assert.equal(policy.mode, "large-cap-defense");
  assert.equal(policy.minCashReservePct, 35);
});

test("computeDynamicLargeCapFloor: 코스피 시총 상위 기준선을 계산한다", () => {
  const rows = [
    { code: "A", close: 1000, score: 80, name: "A", market: "KOSPI", marketCap: 5_000_000_000_000 },
    { code: "B", close: 1000, score: 79, name: "B", market: "KOSPI", marketCap: 3_000_000_000_000 },
    { code: "C", close: 1000, score: 78, name: "C", market: "KOSPI", marketCap: 1_500_000_000_000 },
  ];

  assert.equal(computeDynamicLargeCapFloor(rows, 2), 3_000_000_000_000);
});

test("resolveDeployableCash: 최소 현금 하한을 제외한 금액만 신규 매수에 사용한다", () => {
  const deployableCash = resolveDeployableCash({
    availableCash: 5_000_000,
    seedCapital: 10_000_000,
    minCashReservePct: 30,
  });

  assert.equal(deployableCash, 2_000_000);
});

test("pickAutoTradeCandidates: 대형주 방어 모드에서는 코스피 대형주만 남긴다", () => {
  const policy = detectAutoTradeMarketPolicy({
    overview: {
      vix: { price: 30 },
      fearGreed: { score: 25 },
    },
  });

  const result = pickAutoTradeCandidates({
    rows: [
      {
        code: "A",
        close: 10000,
        score: 82,
        name: "Alpha",
        signal: "BUY",
        market: "KOSPI",
        marketCap: 4_000_000_000_000,
        liquidity: 50_000_000_000,
        universeLevel: "core",
      },
      {
        code: "B",
        close: 9000,
        score: 81,
        name: "Beta",
        signal: "BUY",
        market: "KOSDAQ",
        marketCap: 5_000_000_000_000,
        liquidity: 60_000_000_000,
        universeLevel: "core",
      },
      {
        code: "C",
        close: 8000,
        score: 80,
        name: "Gamma",
        signal: "BUY",
        market: "KOSPI",
        marketCap: 800_000_000_000,
        liquidity: 60_000_000_000,
        universeLevel: "extended",
      },
    ],
    preferredMinBuyScore: 70,
    limit: 3,
    heldCodes: new Set<string>(),
    marketPolicy: policy,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["A"]
  );
});

test("applyStrategyBuyConstraint: HOLD_SAFE 무보유면 1종목만 최소 진입 허용", () => {
  const result = applyStrategyBuyConstraint({
    selectedStrategy: "HOLD_SAFE",
    requestedSlots: 3,
    baseMinBuyScore: 70,
    activeCount: 0,
  });

  assert.equal(result.buySlots, 1);
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "hold-safe-probe");
});

test("applyStrategyBuyConstraint: HOLD_SAFE 기존 보유 1종목이면 1종목 추가 진입을 허용", () => {
  const result = applyStrategyBuyConstraint({
    selectedStrategy: "HOLD_SAFE",
    requestedSlots: 2,
    baseMinBuyScore: 70,
    activeCount: 1,
  });

  assert.equal(result.buySlots, 1);
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "hold-safe-probe");
});

test("applyStrategyBuyConstraint: HOLD_SAFE 기존 보유 2종목이면 신규 매수를 차단", () => {
  const result = applyStrategyBuyConstraint({
    selectedStrategy: "HOLD_SAFE",
    requestedSlots: 2,
    baseMinBuyScore: 70,
    activeCount: 2,
  });

  assert.equal(result.buySlots, 0);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "strategy-blocked-buy");
});

test("applyStrategyBuyConstraint: 페이싱 완화 레벨이 있으면 최소점수가 낮아진다", () => {
  const result = applyStrategyBuyConstraint({
    selectedStrategy: "SWING",
    requestedSlots: 2,
    baseMinBuyScore: 72,
    activeCount: 0,
    pacingRelaxLevel: 2,
  });

  assert.equal(result.buySlots, 2);
  assert.equal(result.minBuyScore, 68);
});

test("pickAutoTradeAddOnCandidates: 보유 종목도 눌림 또는 강한 연속 신호면 추가매수 후보가 된다", () => {
  const result = pickAutoTradeAddOnCandidates({
    rows: [
      { code: "A", close: 10200, score: 76, name: "Alpha", signal: "BUY" },
      { code: "B", close: 15000, score: 80, name: "Beta", signal: "HOLD" },
    ],
    preferredMinBuyScore: 72,
    limit: 2,
    holdingsByCode: new Map([
      ["A", { code: "A", buyPrice: 10000 }],
      ["B", { code: "B", buyPrice: 12000 }],
    ]),
  });

  assert.equal(result.selectionMode, "held-add-on");
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["A"]
  );
});

test("pickAutoTradeAddOnCandidates: RSI 과열 구간은 추가매수에서 제외한다", () => {
  const result = pickAutoTradeAddOnCandidates({
    rows: [
      { code: "A", close: 10100, score: 79, name: "Alpha", signal: "BUY", rsi14: 74 },
    ],
    preferredMinBuyScore: 72,
    limit: 1,
    holdingsByCode: new Map([["A", { code: "A", buyPrice: 10000, allowAddOn: true }]]),
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.selectionMode, "none");
});

test("buildPositionStrategyMemo/parsePositionStrategyState: 포지션별 전략과 익절 상태를 memo에 저장한다", () => {
  const memo = buildPositionStrategyMemo({
    event: "entry",
    note: "autotrade-entry",
    profile: "SWING",
    takeProfitTranchesDone: 1,
  });

  const parsed = parsePositionStrategyState(memo, "DEFAULT");
  assert.equal(parsed.profile, "SWING");
  assert.equal(parsed.takeProfitTranchesDone, 1);
});

test("resolvePositionTradeProfile: REDUCE_TIGHT 포지션은 전량 익절 구조를 사용한다", () => {
  const profile = resolvePositionTradeProfile({
    accountStrategy: "REDUCE_TIGHT",
    baseTakeProfitPct: 8,
    baseStopLossPct: 4,
    sellSplitCount: 3,
  });

  assert.equal(profile.profile, "REDUCE_TIGHT");
  assert.equal(profile.takeProfitPct, 4);
  assert.equal(profile.stopLossPct, 2);
  assert.equal(profile.takeProfitSplitCount, 1);
  assert.equal(profile.allowAddOn, false);
});

test("classifyAutoTradeEntryProfile: 보수 전략의 강한 후보는 코어 또는 스윙으로 분류한다", () => {
  const profile = classifyAutoTradeEntryProfile({
    accountStrategy: "HOLD_SAFE",
    riskProfile: "safe",
    candidate: {
      score: 85,
      signal: "BUY",
      rsi14: 54,
      liquidity: 20_000_000_000,
    },
  });

  assert.equal(profile, "POSITION_CORE");
});

test("classifyAutoTradeEntryProfile: 공격 성향의 일반 후보는 단기 스윙으로 분류할 수 있다", () => {
  const profile = classifyAutoTradeEntryProfile({
    accountStrategy: "DEFAULT",
    riskProfile: "active",
    candidate: {
      score: 74,
      signal: "BUY",
      rsi14: 57,
      liquidity: 12_000_000_000,
    },
  });

  assert.equal(profile, "SHORT_SWING");
});

test("planAutoTradeExit: 분할 익절은 첫 신호에서 일부만 매도한다", () => {
  const plan = planAutoTradeExit({
    quantity: 5,
    pnlPct: 9,
    takeProfitPct: 8,
    stopLossPct: 4,
    takeProfitSplitCount: 3,
    takeProfitTranchesDone: 0,
  });

  assert.equal(plan.action, "TAKE_PROFIT");
  assert.equal(plan.isPartial, true);
  assert.equal(plan.quantityToSell, 2);
  assert.equal(plan.nextTakeProfitTranchesDone, 1);
});

test("planAutoTradeExit: 마지막 익절 tranche 는 잔량 전부 매도한다", () => {
  const plan = planAutoTradeExit({
    quantity: 3,
    pnlPct: 9,
    takeProfitPct: 8,
    stopLossPct: 4,
    takeProfitSplitCount: 2,
    takeProfitTranchesDone: 1,
  });

  assert.equal(plan.action, "TAKE_PROFIT");
  assert.equal(plan.isPartial, false);
  assert.equal(plan.quantityToSell, 3);
  assert.equal(plan.reason, "take-profit-final");
});

test("pickAutoTradeCandidates: filteringMetrics에 정책/기본/최종 단계 수가 기록된다", () => {
  const policy = detectAutoTradeMarketPolicy({
    overview: {
      vix: { price: 31 },
      fearGreed: { score: 25 },
      usdkrw: { changeRate: 0.1 },
      kospi: { changeRate: 0.2 },
      kosdaq: { changeRate: -0.5 },
    },
  });

  const result = pickAutoTradeCandidates({
    rows: [
      {
        code: "A",
        close: 10000,
        score: 80,
        name: "Alpha",
        signal: "BUY",
        market: "KOSPI",
        liquidity: 30_000_000_000,
        marketCap: 2_000_000_000_000,
      },
      {
        code: "B",
        close: 10000,
        score: 79,
        name: "Beta",
        signal: "BUY",
        market: "KOSDAQ",
        liquidity: 50_000_000_000,
        marketCap: 2_000_000_000_000,
      },
      {
        code: "C",
        close: 0,
        score: 78,
        name: "Gamma",
        signal: "BUY",
        market: "KOSPI",
        liquidity: 40_000_000_000,
        marketCap: 2_000_000_000_000,
      },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
    marketPolicy: policy,
  });

  assert.ok(result.filteringMetrics);
  assert.equal(result.filteringMetrics?.initialCount, 3);
  assert.equal(result.filteringMetrics?.afterMarketPolicyCount, 2);
  assert.equal(result.filteringMetrics?.afterBaseFilterCount, 1);
  assert.equal(result.filteringMetrics?.selectedCount, 1);
  assert.equal(result.filteringMetrics?.rejectedByReason?.marketPolicy, 1);
  assert.equal(result.filteringMetrics?.rejectedByReason?.invalidOrHeld, 1);
});

test("pickAutoTradeAddOnCandidates: filteringMetrics에 밴드/RSI 탈락 사유를 집계한다", () => {
  const result = pickAutoTradeAddOnCandidates({
    rows: [
      { code: "A", close: 12000, score: 80, name: "Alpha", signal: "BUY", rsi14: 55, liquidity: 20_000_000_000 },
      { code: "B", close: 10100, score: 80, name: "Beta", signal: "BUY", rsi14: 75, liquidity: 20_000_000_000 },
      { code: "C", close: 10100, score: 80, name: "Gamma", signal: "BUY", rsi14: 50, liquidity: 2_000_000_000 },
    ],
    preferredMinBuyScore: 72,
    limit: 3,
    holdingsByCode: new Map([
      ["A", { code: "A", buyPrice: 10000, allowAddOn: true }],
      ["B", { code: "B", buyPrice: 10000, allowAddOn: true }],
      ["C", { code: "C", buyPrice: 10000, allowAddOn: true }],
    ]),
  });

  assert.ok(result.filteringMetrics);
  assert.equal(result.filteringMetrics?.candidatePoolCount, 3);
  assert.equal(result.filteringMetrics?.selectedCount, 1);
  assert.equal(result.filteringMetrics?.rejectedByReason?.addOnBand, 0);
  assert.equal(result.filteringMetrics?.rejectedByReason?.rsi, 1);
  assert.equal(result.filteringMetrics?.rejectedByReason?.liquidity, 1);
});

test("pickAutoTradeCandidates: pullback-first에서 눌림목 후보를 점수 근소 열위여도 우선 선택한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 80, name: "Alpha", signal: "BUY" },
      { code: "B", close: 10000, score: 78, name: "Beta", signal: "BUY" },
    ],
    preferredMinBuyScore: 70,
    limit: 1,
    heldCodes: new Set<string>(),
    entryProfile: "pullback-first",
    pullbackCandidateCodes: new Set(["B"]),
  });

  assert.equal(result.candidates[0]?.code, "B");
  assert.equal(result.pullbackCandidatesUsed, 1);
});

test("pickAutoTradeCandidates: pullback-first에서 매집 포착 후보도 우선 선택할 수 있다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 81, name: "Alpha", signal: "HOLD", rsi14: 56, liquidity: 20_000_000_000 },
      { code: "B", close: 10000, score: 78, name: "Beta", signal: "BUY", rsi14: 55, liquidity: 20_000_000_000 },
    ],
    preferredMinBuyScore: 79,
    limit: 1,
    heldCodes: new Set<string>(),
    entryProfile: "pullback-first",
    pullbackCandidateCodes: new Set<string>(),
  });

  assert.equal(result.candidates[0]?.code, "B");
  assert.equal(result.aggressiveCandidatesUsed, 1);
});

test("pickAutoTradeCandidates: Stable bull turn 후보는 신호가 HOLD여도 우선 후보에 포함될 수 있다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      {
        code: "A",
        close: 10000,
        score: 71,
        name: "Alpha",
        signal: "HOLD",
        stableTurn: "bull-strong",
        stableTrust: 74,
        stableAboveAvg: true,
      },
      {
        code: "B",
        close: 10000,
        score: 72,
        name: "Beta",
        signal: "SELL",
      },
    ],
    preferredMinBuyScore: 70,
    limit: 1,
    heldCodes: new Set<string>(),
  });

  assert.equal(result.selectionMode, "signal-preferred");
  assert.equal(result.candidates[0]?.code, "A");
});

test("isKrxIntradayAutoTradeWindow: 평일 장중 10시는 true", () => {
  assert.equal(isKrxIntradayAutoTradeWindow(new Date("2026-04-24T01:00:00.000Z")), true);
});

test("isKrxIntradayAutoTradeWindow: 평일 장마감 후는 false", () => {
  assert.equal(isKrxIntradayAutoTradeWindow(new Date("2026-04-24T07:00:00.000Z")), false);
});

test("kstWindowKey: 장중 실행 키를 10분 창으로 버킷팅한다", () => {
  assert.equal(kstWindowKey(new Date("2026-04-24T01:07:00.000Z"), 10), "2026-04-24T10:00");
  assert.equal(kstWindowKey(new Date("2026-04-24T01:19:00.000Z"), 10), "2026-04-24T10:10");
});