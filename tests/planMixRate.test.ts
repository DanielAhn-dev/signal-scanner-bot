import test from "node:test";
import assert from "node:assert/strict";
import { planMixRates, planMixSeries } from "../src/lib/planMixRate";
import { PLAN_INDEX_MONTHLY } from "../src/data/planIndexMonthly";
import { MIX_ASSETS } from "../web/src/data/mixData";
import { simulateMix } from "../web/src/lib/mix";
import { impliedAnnualRate as webImplied } from "../web/src/lib/goalReach";
import { simulateDca, maxSimYears } from "../web/src/lib/accumulate";

test("서버 지수 이력은 웹 섞어보기 데이터와 같다 (같은 스크립트가 만든다)", () => {
  for (const s of PLAN_INDEX_MONTHLY) {
    const w = MIX_ASSETS.find((a) => a.id === s.id)!;
    assert.deepEqual(s.monthly, w.monthly, s.id);
    assert.equal(s.dragPct, w.dragPct, s.id);
  }
});

test("구성 이력은 웹 섞어보기 월 재조정과 같은 값", () => {
  const mix = [{ index: "kospi200", weight: 0.5 }, { index: "sp500", weight: 0.5 }];
  const server = planMixSeries(mix)!;
  const web = simulateMix({ kospi200: 50, sp500: 50 }, "month")!;
  assert.equal(server.length, web.curve.length);
  for (let i = 0; i < server.length; i += 1) assert.ok(Math.abs(server[i][1] - web.curve[i]) < 1e-9, `month ${i}`);
});

test("적립 연 수익률은 웹 모아가기 4번 계산(simulateDca·impliedAnnualRate)과 같다", () => {
  for (const mix of [
    [{ index: "kospi200", weight: 1 }],
    [{ index: "kospi200", weight: 0.5 }, { index: "sp500", weight: 0.5 }],
    [{ index: "kospi200", weight: 1 / 3 }, { index: "sp500", weight: 1 / 3 }, { index: "nasdaq100", weight: 1 / 3 }],
  ]) {
    const r = planMixRates(mix)!;
    const prices = planMixSeries(mix)!.map(([, p]) => p);
    const years = maxSimYears(prices.length);
    const sim = simulateDca({ monthly: 1, years, prices })!;
    const q = (f: number) => sim.finalRatios[Math.floor((sim.finalRatios.length - 1) * f)];
    assert.equal(r.years, years);
    assert.ok(Math.abs(r.typicalPct - webImplied(q(0.5), sim.months)! * 100) < 0.051, r.label);
    assert.ok(Math.abs(r.lowPct - webImplied(q(0.1), sim.months)! * 100) < 0.051, r.label);
    assert.ok(r.lowPct <= r.typicalPct);
  }
});

test("구성이 없으면 코스피200 100%, 이력 시작은 가장 짧은 지수", () => {
  assert.equal(planMixRates(null)!.label, "코스피200 100");
  assert.equal(planMixRates([{ index: "kospi200", weight: 0.5 }, { index: "nasdaq100", weight: 0.5 }])!.from, "2010-10");
});
