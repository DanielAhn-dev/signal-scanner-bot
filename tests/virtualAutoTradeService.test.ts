import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAdaptiveExitGuard,
  applyStrategyBuyConstraint,
  computeDynamicLargeCapFloor,
  detectAutoTradeMarketPolicy,
  deriveAdaptiveMinBuyScore,
  evaluateCloseFreshness,
  isActionableTodayBuySignal,
  isTakeProfitCooldownOverridable,
  pickAutoTradeAddOnCandidates,
  pickAutoTradeCandidates,
  resolveDeployableCash,
  resolveExitPnlPct,
  resolveLossStreakSizeScale,
  resolveStatsSinceIso,
  resolveTakeProfitCooldownDays,
  resolveVolatilityAdjustedStopPct,
  selectRunType,
  shouldOverrideTakeProfitCooldown,
} from "../src/services/virtualAutoTradeSelection";
import {
  classifyAutoTradeEntryProfile,
  buildPositionStrategyMemo,
  evaluatePlannedReviewExit,
  evaluateSectorRotationExit,
  parsePositionStrategyState,
  planAutoTradeExit,
  planOverweightReduction,
  resolvePositionTradeProfile,
} from "../src/services/virtualAutoTradePositionStrategy";
import {
  isKrxIntradayAutoTradeWindow,
  kstWindowKey,
} from "../src/services/virtualAutoTradeTiming";

test("selectRunType: auto 모드는 한국시간 월요일이면 monday buy를 선택한다", () => {
  const sundayUtc = new Date("2026-04-19T18:00:00.000Z");
  assert.equal(selectRunType("auto", sundayUtc), "MONDAY_BUY");
});

test("selectRunType: auto 모드는 한국시간 월요일 외에는 daily review를 선택한다", () => {
  const tuesdayUtc = new Date("2026-04-21T04:00:00.000Z");
  assert.equal(selectRunType("auto", tuesdayUtc), "DAILY_REVIEW");
});

test("deriveAdaptiveMinBuyScore: 현재 상위 점수대에 맞춰 기준을 완화한다", () => {
  assert.equal(deriveAdaptiveMinBuyScore(70, 53), 50);
  assert.equal(deriveAdaptiveMinBuyScore(70, 40), 37);
  assert.equal(deriveAdaptiveMinBuyScore(70, 34), 31);
});

test("isActionableTodayBuySignal: 오늘 적극 매수 신호는 BUY/STRONG_BUY만 인정한다", () => {
  assert.equal(isActionableTodayBuySignal("BUY"), true);
  assert.equal(isActionableTodayBuySignal("STRONG_BUY"), true);
  assert.equal(isActionableTodayBuySignal("WATCH"), false);
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

test("pickAutoTradeCandidates: 오늘 BUY 신호가 있으면 WATCH보다 우선해 signal-preferred로 선택한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 72, name: "Alpha", signal: "WATCH" },
      { code: "B", close: 10000, score: 71, name: "Beta", signal: "BUY" },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
  });

  assert.equal(result.selectionMode, "signal-preferred");
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["B"]
  );
});

test("pickAutoTradeCandidates: 점수대가 유사하면 PEG가 낮은 종목을 우선한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 73, name: "Alpha", signal: "BUY", peg: 2.4 },
      { code: "B", close: 10000, score: 72, name: "Beta", signal: "BUY", peg: 0.9 },
    ],
    preferredMinBuyScore: 70,
    limit: 1,
    heldCodes: new Set<string>(),
  });

  assert.equal(result.selectionMode, "signal-preferred");
  assert.equal(result.candidates[0]?.code, "B");
});

test("pickAutoTradeCandidates: PEG 데이터가 없어도 기존처럼 후보 수는 유지한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 73, name: "Alpha", signal: "BUY" },
      { code: "B", close: 9900, score: 72, name: "Beta", signal: "BUY" },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
  });

  assert.equal(result.selectionMode, "signal-preferred");
  assert.equal(result.candidates.length, 2);
});

test("pickAutoTradeCandidates: 교집합(2개 이상) 후보를 단일 소스 후보보다 우선 배치한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      {
        code: "A",
        close: 10000,
        score: 83,
        name: "Alpha",
        signal: "BUY",
        discoveryOverlapCount: 1,
      },
      {
        code: "B",
        close: 10000,
        score: 79,
        name: "Beta",
        signal: "BUY",
        discoveryOverlapCount: 2,
      },
    ],
    preferredMinBuyScore: 70,
    limit: 1,
    heldCodes: new Set<string>(),
  });

  assert.equal(result.selectionMode, "signal-preferred");
  assert.equal(result.candidates[0]?.code, "B");
});

test("pickAutoTradeCandidates: 3개 이상 교집합 후보를 2개 교집합보다 우선 배치한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      {
        code: "A",
        close: 10000,
        score: 85,
        name: "Alpha",
        signal: "BUY",
        discoveryOverlapCount: 2,
      },
      {
        code: "B",
        close: 10000,
        score: 82,
        name: "Beta",
        signal: "BUY",
        discoveryOverlapCount: 3,
      },
    ],
    preferredMinBuyScore: 70,
    limit: 1,
    heldCodes: new Set<string>(),
  });

  assert.equal(result.selectionMode, "signal-preferred");
  assert.equal(result.candidates[0]?.code, "B");
});

test("pickAutoTradeCandidates: todayBuyScore가 높은 후보를 우선 배치한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      {
        code: "A",
        close: 10000,
        score: 84,
        name: "Alpha",
        signal: "BUY",
        todayBuyScore: 62,
      },
      {
        code: "B",
        close: 10000,
        score: 80,
        name: "Beta",
        signal: "BUY",
        todayBuyScore: 88,
      },
    ],
    preferredMinBuyScore: 70,
    limit: 1,
    heldCodes: new Set<string>(),
  });

  assert.equal(result.candidates[0]?.code, "B");
});

test("pickAutoTradeCandidates: immediateExcludeSignal 종목은 후보에서 제외한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      {
        code: "A",
        close: 10000,
        score: 85,
        name: "Alpha",
        signal: "BUY",
        immediateExcludeSignal: true,
      },
      {
        code: "B",
        close: 9800,
        score: 79,
        name: "Beta",
        signal: "BUY",
      },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["B"]
  );
  assert.equal(result.filteringMetrics?.rejectedByReason?.immediateExclude, 1);
});

test("pickAutoTradeCandidates: 유망섹터 부스트가 적용되면 점수가 낮은 종목도 우선 선택될 수 있다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 75, name: "Alpha", signal: "BUY" },
      { code: "B", close: 10000, score: 72, name: "Beta", signal: "BUY", sectorId: "SEC1" },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
    sectorBoostById: new Map([["SEC1", 10]]),
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["B", "A"]
  );
});

test("pickAutoTradeCandidates: 동일 섹터에 이미 2종목 보유 중이면 추가 후보를 제외한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 80, name: "Alpha", signal: "BUY", sectorId: "SEC1" },
      { code: "B", close: 10000, score: 75, name: "Beta", signal: "BUY", sectorId: "SEC2" },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
    heldSectorCounts: new Map([["SEC1", 2]]),
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["B"]
  );
});

test("pickAutoTradeCandidates: 비중 데이터가 없을 때(fallback)는 섹터 리더가 종목수 상한 예외를 허용한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 80, name: "Alpha", signal: "BUY", sectorId: "SEC1", isSectorLeader: true },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
    heldSectorCounts: new Map([["SEC1", 2]]),
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["A"]
  );
});

test("pickAutoTradeCandidates: 비중 데이터가 있으면 섹터 리더도 예외 없이 비중 상한에 걸린다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 80, name: "Alpha", signal: "BUY", sectorId: "SEC1", isSectorLeader: true },
      { code: "B", close: 10000, score: 75, name: "Beta", signal: "BUY", sectorId: "SEC2" },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
    heldSectorCounts: new Map([["SEC1", 1]]),
    heldSectorWeightPct: new Map([["SEC1", 32]]),
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["B"]
  );
});

test("pickAutoTradeCandidates: 비중 데이터가 있어도 상한 미만이면 섹터 리더 매수를 허용한다", () => {
  const result = pickAutoTradeCandidates({
    rows: [
      { code: "A", close: 10000, score: 80, name: "Alpha", signal: "BUY", sectorId: "SEC1", isSectorLeader: true },
    ],
    preferredMinBuyScore: 70,
    limit: 2,
    heldCodes: new Set<string>(),
    heldSectorCounts: new Map([["SEC1", 1]]),
    heldSectorWeightPct: new Map([["SEC1", 15]]),
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.code),
    ["A"]
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

test("evaluatePlannedReviewExit: 검토일 전이면 아무 것도 하지 않는다", () => {
  const now = new Date("2026-08-14T00:00:00.000Z");
  const result = evaluatePlannedReviewExit({
    plannedReviewAt: "2026-08-20T00:00:00.000Z",
    pnlPct: -2,
    takeProfitPct: 8,
    signal: "HOLD",
    score: 40,
    quantity: 10,
    takeProfitTranchesDone: 0,
    expectedHorizonDays: 5,
    now,
  });
  assert.equal(result.action, "none");
});

test("evaluatePlannedReviewExit: 검토일 도달 + 이미 목표수익 달성이면 아무 것도 하지 않는다(다른 익절 경로에 맡김)", () => {
  const now = new Date("2026-08-14T00:00:00.000Z");
  const result = evaluatePlannedReviewExit({
    plannedReviewAt: "2026-08-10T00:00:00.000Z",
    pnlPct: 12,
    takeProfitPct: 8,
    signal: "HOLD",
    score: 40,
    quantity: 10,
    takeProfitTranchesDone: 0,
    expectedHorizonDays: 5,
    now,
  });
  assert.equal(result.action, "none");
});

test("evaluatePlannedReviewExit: 검토일 도달 + 목표 미달 + 신호 약화(HOLD)면 수익 중이어도 정리(익절 종료)한다", () => {
  const now = new Date("2026-08-14T00:00:00.000Z");
  const result = evaluatePlannedReviewExit({
    plannedReviewAt: "2026-08-10T00:00:00.000Z",
    pnlPct: 3,
    takeProfitPct: 8,
    signal: "HOLD",
    score: 50,
    quantity: 10,
    takeProfitTranchesDone: 0,
    expectedHorizonDays: 5,
    now,
  });
  assert.equal(result.action, "exit");
  if (result.action === "exit") {
    assert.equal(result.plan.action, "TAKE_PROFIT");
    assert.equal(result.plan.reason, "take-profit-final");
    assert.equal(result.plan.quantityToSell, 10);
  }
});

test("evaluatePlannedReviewExit: 검토일 도달 + 손실 + 신호 약화면 손절로 정리한다", () => {
  const now = new Date("2026-08-14T00:00:00.000Z");
  const result = evaluatePlannedReviewExit({
    plannedReviewAt: "2026-08-10T00:00:00.000Z",
    pnlPct: -3,
    takeProfitPct: 8,
    signal: "WATCH",
    score: 45,
    quantity: 10,
    takeProfitTranchesDone: 0,
    expectedHorizonDays: 5,
    now,
  });
  assert.equal(result.action, "exit");
  if (result.action === "exit") {
    assert.equal(result.plan.action, "STOP_LOSS");
    assert.equal(result.plan.reason, "stop-loss");
  }
});

test("evaluatePlannedReviewExit: 검토일 도달했지만 BUY 신호 + 고득점이면 매도하지 않고 검토일을 연장한다", () => {
  const now = new Date("2026-08-14T00:00:00.000Z");
  const result = evaluatePlannedReviewExit({
    plannedReviewAt: "2026-08-10T00:00:00.000Z",
    pnlPct: 3,
    takeProfitPct: 8,
    signal: "STRONG_BUY",
    score: 70,
    quantity: 10,
    takeProfitTranchesDone: 0,
    expectedHorizonDays: 7,
    now,
  });
  assert.equal(result.action, "extend");
  if (result.action === "extend") {
    assert.equal(result.nextReviewAt, "2026-08-21T00:00:00.000Z");
  }
});

test("evaluatePlannedReviewExit: BUY 신호여도 점수가 최소 기준 미만이면 신호를 신뢰하지 않고 정리한다", () => {
  const now = new Date("2026-08-14T00:00:00.000Z");
  const result = evaluatePlannedReviewExit({
    plannedReviewAt: "2026-08-10T00:00:00.000Z",
    pnlPct: 1,
    takeProfitPct: 8,
    signal: "BUY",
    score: 40,
    quantity: 10,
    takeProfitTranchesDone: 0,
    expectedHorizonDays: 5,
    now,
  });
  assert.equal(result.action, "exit");
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

test("evaluateSectorRotationExit: 섹터 Grade C + 손실 -3% 이내면 전량 매도를 트리거한다", () => {
  const result = evaluateSectorRotationExit({
    quantity: 10,
    pnlPct: -1,
    isSectorLeader: false,
    sectorGrade: "C",
  });

  assert.deepEqual(result, { triggered: true, quantityToSell: 10 });
});

test("evaluateSectorRotationExit: 손실이 -3%를 초과하면 트리거하지 않는다 (손실 확정 방지)", () => {
  const result = evaluateSectorRotationExit({
    quantity: 10,
    pnlPct: -5,
    isSectorLeader: false,
    sectorGrade: "C",
  });

  assert.deepEqual(result, { triggered: false });
});

test("evaluateSectorRotationExit: 섹터 리더는 Grade C여도 트리거하지 않는다", () => {
  const result = evaluateSectorRotationExit({
    quantity: 10,
    pnlPct: 2,
    isSectorLeader: true,
    sectorGrade: "C",
  });

  assert.deepEqual(result, { triggered: false });
});

test("evaluateSectorRotationExit: 섹터 등급이 A/B이거나 미상이면 트리거하지 않는다", () => {
  assert.deepEqual(
    evaluateSectorRotationExit({ quantity: 10, pnlPct: 1, isSectorLeader: false, sectorGrade: "A" }),
    { triggered: false }
  );
  assert.deepEqual(
    evaluateSectorRotationExit({ quantity: 10, pnlPct: 1, isSectorLeader: false, sectorGrade: "B" }),
    { triggered: false }
  );
  assert.deepEqual(
    evaluateSectorRotationExit({ quantity: 10, pnlPct: 1, isSectorLeader: false, sectorGrade: undefined }),
    { triggered: false }
  );
});

test("resolveExitPnlPct: buyPrice/close로 손익률을 계산한다", () => {
  assert.equal(resolveExitPnlPct({ buyPrice: 50000, close: 45000 }), -10);
  assert.equal(resolveExitPnlPct({ buyPrice: 50000, close: 55000 }), 10);
  assert.equal(resolveExitPnlPct(null), null);
  assert.equal(resolveExitPnlPct({ buyPrice: 0, close: 45000 }), null);
  assert.equal(resolveExitPnlPct({ buyPrice: 50000, close: "not-a-number" }), null);
});

test("resolveTakeProfitCooldownDays: 손실정리는 손실폭에 따라 5~8일 차등, 익절은 항상 2일", () => {
  assert.equal(resolveTakeProfitCooldownDays("loss-trim", -10), 8);
  assert.equal(resolveTakeProfitCooldownDays("loss-trim", -5), 6);
  assert.equal(resolveTakeProfitCooldownDays("loss-trim", -1), 5);
  assert.equal(resolveTakeProfitCooldownDays("loss-trim", null), 5);
  assert.equal(resolveTakeProfitCooldownDays("take-profit-partial", -20), 2);
  assert.equal(resolveTakeProfitCooldownDays("take-profit-final", 30), 2);
});

test("shouldOverrideTakeProfitCooldown: STRONG_BUY + 고득점만 쿨다운을 건너뛴다", () => {
  assert.equal(shouldOverrideTakeProfitCooldown({ score: 85, signal: "STRONG_BUY" }), true);
  assert.equal(shouldOverrideTakeProfitCooldown({ score: 79, signal: "STRONG_BUY" }), false);
  assert.equal(shouldOverrideTakeProfitCooldown({ score: 90, signal: "BUY" }), false);
  assert.equal(shouldOverrideTakeProfitCooldown(undefined), false);
});

test("isTakeProfitCooldownOverridable: 손실정리(loss-trim)는 오버라이드 불가, 익절만 가능", () => {
  assert.equal(isTakeProfitCooldownOverridable("loss-trim"), false);
  assert.equal(isTakeProfitCooldownOverridable("take-profit-partial"), true);
  assert.equal(isTakeProfitCooldownOverridable("take-profit-final"), true);
  assert.equal(isTakeProfitCooldownOverridable("stop-loss"), false);
});

test("resolveStatsSinceIso: 오염기간 컷오프보다 이른 since는 컷오프로 당겨진다", () => {
  assert.equal(
    resolveStatsSinceIso("2026-01-01T00:00:00.000Z"),
    "2026-07-11T00:00:00+09:00"
  );
  assert.equal(
    resolveStatsSinceIso("2026-08-01T00:00:00.000Z"),
    "2026-08-01T00:00:00.000Z"
  );
});

test("resolveLossStreakSizeScale: 연속손실이 클수록 매수 사이즈를 축소한다", () => {
  assert.equal(resolveLossStreakSizeScale(0), 1.0);
  assert.equal(resolveLossStreakSizeScale(2), 1.0);
  assert.equal(resolveLossStreakSizeScale(3), 0.6);
  assert.equal(resolveLossStreakSizeScale(4), 0.6);
  assert.equal(resolveLossStreakSizeScale(5), 0.4);
  assert.equal(resolveLossStreakSizeScale(10), 0.4);
});

test("resolveVolatilityAdjustedStopPct: ATR%가 기준 손절폭보다 넓으면 ATR 기준으로 확장한다", () => {
  assert.equal(resolveVolatilityAdjustedStopPct({ baseStopLossPct: 3, atrPct: null }), 3);
  // 2.2 * 1% = 2.2% < 기준 3% → 기준 유지
  assert.equal(resolveVolatilityAdjustedStopPct({ baseStopLossPct: 3, atrPct: 1 }), 3);
  // 2.2 * 5% = 11% > 기준 3% → ATR 기준으로 확장 (상한 12)
  assert.equal(resolveVolatilityAdjustedStopPct({ baseStopLossPct: 3, atrPct: 5 }), 11);
  // 2.2 * 10% = 22% > 상한 12 → 12로 캡
  assert.equal(resolveVolatilityAdjustedStopPct({ baseStopLossPct: 3, atrPct: 10 }), 12);
});

test("evaluateCloseFreshness: 데이터가 없으면 no-data", () => {
  const result = evaluateCloseFreshness([]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-data");
});

test("evaluateCloseFreshness: 최신 종가 날짜가 오래되면 stale-date", () => {
  const nowMs = Date.parse("2026-07-13T00:00:00Z");
  const result = evaluateCloseFreshness(
    [{ date: "2026-07-01", close: 50000, volume: 100000 }],
    { nowMs }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale-date");
});

test("evaluateCloseFreshness: 유동성 있는 종목의 종가가 여러 세션 동결되면 frozen-close", () => {
  const nowMs = Date.parse("2026-07-13T00:00:00Z");
  const rows = [
    { date: "2026-07-13", close: 65000, volume: 120000 },
    { date: "2026-07-12", close: 65000, volume: 90000 },
    { date: "2026-07-11", close: 65000, volume: 110000 },
    { date: "2026-07-10", close: 65000, volume: 80000 },
    { date: "2026-07-09", close: 64000, volume: 70000 },
  ];
  const result = evaluateCloseFreshness(rows, { nowMs });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "frozen-close");
});

test("evaluateCloseFreshness: 종가가 동일해도 거래량이 전부 0이면 동결로 보지 않는다(거래정지 등)", () => {
  const nowMs = Date.parse("2026-07-13T00:00:00Z");
  const rows = [
    { date: "2026-07-13", close: 65000, volume: 0 },
    { date: "2026-07-12", close: 65000, volume: 0 },
    { date: "2026-07-11", close: 65000, volume: 0 },
    { date: "2026-07-10", close: 65000, volume: 0 },
  ];
  const result = evaluateCloseFreshness(rows, { nowMs });
  assert.equal(result.ok, true);
});

test("evaluateCloseFreshness: 신선하고 정상적으로 변동하는 종가는 통과한다", () => {
  const nowMs = Date.parse("2026-07-13T00:00:00Z");
  const rows = [
    { date: "2026-07-13", close: 65000, volume: 120000 },
    { date: "2026-07-12", close: 64500, volume: 90000 },
    { date: "2026-07-11", close: 64000, volume: 110000 },
    { date: "2026-07-10", close: 63500, volume: 80000 },
  ];
  const result = evaluateCloseFreshness(rows, { nowMs });
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
});

test("applyAdaptiveExitGuard: 표본 10건 미만이면 조정하지 않는다", () => {
  const result = applyAdaptiveExitGuard({
    baseStopLossPct: 4,
    baseTakeProfitPct: 8,
    perf: { windowDays: 45, sellCount: 5, winRate: 20, profitFactor: 0.5, maxLossStreak: 4 },
  });
  assert.equal(result.stopLossPct, 4);
  assert.equal(result.takeProfitPct, 8);
  assert.equal(result.buySizeScale, 1);
});

test("applyAdaptiveExitGuard: 연속손실 3회 이상이면 손절폭은 그대로 두고 매수 사이즈만 축소한다", () => {
  const result = applyAdaptiveExitGuard({
    baseStopLossPct: 4,
    baseTakeProfitPct: 8,
    perf: { windowDays: 45, sellCount: 10, winRate: 30, profitFactor: 0.7, maxLossStreak: 3 },
  });
  assert.equal(result.stopLossPct, 4);
  assert.equal(result.takeProfitPct, 8);
  assert.equal(result.buySizeScale, 0.6);
  assert.ok(result.note?.includes("매수사이즈"));
});

test("applyAdaptiveExitGuard: 승률/PF 양호 + 표본 20건 이상이면 익절 목표를 연장한다", () => {
  const result = applyAdaptiveExitGuard({
    baseStopLossPct: 4,
    baseTakeProfitPct: 8,
    perf: { windowDays: 45, sellCount: 20, winRate: 60, profitFactor: 1.3, maxLossStreak: 1 },
  });
  assert.equal(result.stopLossPct, 4);
  assert.equal(result.takeProfitPct, 9.5);
  assert.equal(result.buySizeScale, 1);
});

test("applyAdaptiveExitGuard: 표본 20건 미만이면 승률이 좋아도 익절을 연장하지 않는다", () => {
  const result = applyAdaptiveExitGuard({
    baseStopLossPct: 4,
    baseTakeProfitPct: 8,
    perf: { windowDays: 45, sellCount: 15, winRate: 60, profitFactor: 1.3, maxLossStreak: 1 },
  });
  assert.equal(result.takeProfitPct, 8);
  assert.equal(result.buySizeScale, 1);
});

test("planOverweightReduction: 1주만 보유 중이면 최소 1주 유지를 위해 매도하지 않는다", () => {
  const result = planOverweightReduction({
    currentWeightPct: 40,
    maxWeightPct: 25,
    targetWeightPct: 20,
    quantity: 1,
    currentPrice: 100000,
    totalPortfolioValue: 1000000,
    takeProfitTranchesDone: 0,
  });
  assert.equal(result.action, "HOLD");
  assert.equal(result.quantityToSell, 0);
});

test("planOverweightReduction: 2주 이상이면 최소 1주를 남기고 초과분을 분할 매도한다", () => {
  // quantity=2 * price=300,000 = 600,000 → 포트폴리오(1,000,000)의 60% 비중
  const result = planOverweightReduction({
    currentWeightPct: 60,
    maxWeightPct: 25,
    targetWeightPct: 20,
    quantity: 2,
    currentPrice: 300000,
    totalPortfolioValue: 1000000,
    takeProfitTranchesDone: 0,
  });
  assert.equal(result.action, "OVERWEIGHT_REDUCTION");
  assert.ok(result.quantityToSell >= 1);
  assert.ok(result.quantityToSell < 2);
});