import test from "node:test";
import assert from "node:assert/strict";
import { computeChaseEntry, computeEntryGuardKinds, type DailyBar } from "../src/services/chaseEntrySignal";
import {
  RULE_MIN_DATES_FOR_T,
  buildRuleSnapshot,
  evaluateRuleScoreboard,
  judgeRule,
  neweyWestT,
  type RuleSnapshot,
} from "../src/services/ruleScoreboard";

const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

function flat(n: number, price = 100): DailyBar[] {
  return Array.from({ length: n }, (_, i) => ({ date: day(i), open: price, high: price + 1, close: price, volume: 1000 }));
}

test("computeEntryGuardKinds: 평범한 종목은 아무것도 안 걸림", () => {
  assert.deepEqual(computeEntryGuardKinds(flat(40)), []);
});

test("computeEntryGuardKinds: 윗꼬리와 급락이 겹치면 둘 다 돌려주고, computeChaseEntry는 첫 하나(윗꼬리)와 같다", () => {
  const bars = flat(40);
  // 한 달 전 100 → 마지막 종가 80, 마지막 봉은 고가 90(윗꼬리 12.5%)
  bars[bars.length - 1] = { ...bars[bars.length - 1], open: 82, high: 90, close: 80 };
  const kinds = computeEntryGuardKinds(bars);
  assert.deepEqual(kinds, ["wick", "knife"]);
  assert.equal(computeChaseEntry(bars)?.kind, kinds[0]);
});

test("computeEntryGuardKinds: 급등 사건이 5거래일 안에 있으면 chase", () => {
  const bars = flat(40);
  const i = bars.length - 3;
  bars[i] = { ...bars[i], open: 100, high: 109, close: 108.5, volume: 6000 };
  for (let k = i + 1; k < bars.length; k += 1) bars[k] = { ...bars[k], close: 108.5, high: 109 };
  assert.ok(computeEntryGuardKinds(bars).includes("chase"));
});

test("buildRuleSnapshot: 그날 거래 없는 종목은 후보군에서 빠지고 선호 상위는 20%", () => {
  const barsByCode = new Map<string, DailyBar[]>();
  const asof = day(299);
  for (let c = 0; c < 20; c += 1) {
    // 변동성이 다르고 고가 근접도가 다른 20종목
    barsByCode.set(
      `S${String(c).padStart(2, "0")}`,
      Array.from({ length: 300 }, (_, i) => {
        const price = 100 + (i % 2 === 0 ? c : -c) * 0.5 + i * 0.01;
        return { date: day(i), open: price, high: price * 1.01, close: price, volume: 1000 };
      })
    );
  }
  barsByCode.set("STALE", flat(250)); // 마지막 일봉이 asof가 아님
  const snap = buildRuleSnapshot({
    asof,
    universe: [...barsByCode.keys()],
    barsByCode,
    recordedAt: "2026-10-08T00:00:00Z",
    backfilled: false,
  });
  assert.equal(snap.universe.length, 20);
  assert.ok(!snap.universe.includes("STALE"));
  assert.equal(snap.flags["pref-top"].length, 4);
  // asof 이후 일봉이 있어도 판단에 쓰지 않는다
  const later = new Map(barsByCode);
  later.set("S00", [...barsByCode.get("S00")!, { date: day(300), open: 1, high: 1, close: 1, volume: 1 }]);
  const again = buildRuleSnapshot({ asof, universe: [...later.keys()], barsByCode: later, recordedAt: "x", backfilled: false });
  assert.deepEqual(again.flags, snap.flags);
});

test("neweyWestT: 표본 10개 미만이면 null, 상수열 아니면 부호를 따른다", () => {
  assert.equal(neweyWestT([1, 2, 3], 1), null);
  const t = neweyWestT([0.02, 0.01, 0.03, 0.02, 0.01, 0.02, 0.03, 0.01, 0.02, 0.02, 0.03, 0.01], 3);
  assert.ok(t != null && t > 2);
  const neg = neweyWestT([-0.02, -0.01, -0.03, -0.02, -0.01, -0.02, -0.03, -0.01, -0.02, -0.02, -0.03, -0.01], 3);
  assert.ok(neg != null && neg < -2);
});

test("judgeRule: 20일 미만 표본 부족, 60일 전에는 확정 판정 없음", () => {
  assert.equal(judgeRule({ expected: -1, maturedDates: 19, meanExcess: -0.05, t: null }), "insufficient");
  assert.equal(judgeRule({ expected: -1, maturedDates: 30, meanExcess: -0.01, t: 5 }), "direction-match");
  assert.equal(judgeRule({ expected: 1, maturedDates: 30, meanExcess: -0.01, t: null }), "direction-opposite");
  assert.equal(judgeRule({ expected: -1, maturedDates: RULE_MIN_DATES_FOR_T, meanExcess: -0.01, t: -2.5 }), "confirmed");
  assert.equal(judgeRule({ expected: -1, maturedDates: RULE_MIN_DATES_FOR_T, meanExcess: 0.01, t: 2.5 }), "contradicted");
  assert.equal(judgeRule({ expected: -1, maturedDates: RULE_MIN_DATES_FOR_T, meanExcess: -0.01, t: -1.5 }), "direction-match");
});

test("evaluateRuleScoreboard: 시가 대 시가 20거래일, 같은 날 평균 대비, 안 끝난 날은 대기", () => {
  const dates = Array.from({ length: 30 }, (_, i) => day(i));
  // 후보군 10종목: U0..U9. U0은 flagged(chase), 가격은 진입일 100 → 청산일 90(-10%), 나머지는 +10%
  const universe = Array.from({ length: 10 }, (_, i) => `U${i}`);
  const entry = dates[6]; // asof=dates[5]의 다음 거래일
  const exit = dates[26];
  const open = (code: string, date: string): number | null => {
    if (date === entry) return 100;
    if (date === exit) return code === "U0" ? 90 : code === "069500" ? 105 : 110;
    return 100;
  };
  const snap = (asof: string): RuleSnapshot => ({
    asof,
    recordedAt: "x",
    backfilled: false,
    universe,
    flags: { chase: ["U0"], wick: [], knife: [], "pref-top": ["U1"] },
  });
  const board = evaluateRuleScoreboard({
    snapshots: [snap(dates[5]), snap(dates[20])], // 둘째는 청산일(dates[41])이 달력 밖 → 대기
    tradingDates: dates,
    openAt: open,
    indexCode: "069500",
    generatedAt: "2026-10-08T00:00:00Z",
  });
  const chase = board.rules.find((r) => r.id === "chase")!;
  assert.equal(chase.maturedDates, 1);
  assert.equal(chase.pendingDates, 1);
  assert.equal(chase.events, 1);
  // 후보군 평균 = (-10% + 9×10%) / 10 = +8%, U0은 -10% → 초과 -18%
  assert.ok(Math.abs(chase.meanExcessUniverse! - -0.18) < 1e-9);
  // 지수 +5% 대비: -10% - 5% = -15%
  assert.ok(Math.abs(chase.meanExcessIndex! - -0.15) < 1e-9);
  assert.equal(chase.verdict, "insufficient");
  const wick = board.rules.find((r) => r.id === "wick")!;
  assert.equal(wick.events, 0);
  assert.equal(wick.meanExcessUniverse, null);
  const pref = board.rules.find((r) => r.id === "pref-top")!;
  assert.ok(Math.abs(pref.meanExcessUniverse! - 0.02) < 1e-9); // U1 +10% vs 평균 +8%
});

test("evaluateRuleScoreboard: 후보군 가격이 10종목 미만이면 그날은 성숙으로 세지 않음", () => {
  const dates = Array.from({ length: 30 }, (_, i) => day(i));
  const board = evaluateRuleScoreboard({
    snapshots: [{ asof: dates[2], recordedAt: "x", backfilled: true, universe: ["A", "B"], flags: { chase: ["A"], wick: [], knife: [], "pref-top": [] } }],
    tradingDates: dates,
    openAt: () => 100,
    indexCode: "069500",
    generatedAt: "2026-10-08T00:00:00Z",
  });
  assert.equal(board.rules[0].maturedDates, 0);
  assert.equal(board.rules[0].pendingDates, 1);
  assert.equal(board.backfilledDates, 1);
});
