import test from "node:test";
import assert from "node:assert/strict";
import { resolveStructuralTargets } from "../src/services/structuralTargets";
import { buildBuyMirrorOrder, buildMirrorOrderSheet } from "../src/services/mtsMirrorOrderService";

test("resolveStructuralTargets: 원익IPS 9/22 사례 — 박스 상단·박스 목표·직전 고점대 순", () => {
  const levels = resolveStructuralTargets({ entryPrice: 130230, boxHigh: 134900, boxLow: 100900, priorHigh: 187800 });
  assert.deepEqual(levels.map((l) => l.kind), ["box-high", "measured-move", "prior-high"]);
  assert.equal(levels[1].price, 168900);
  assert.equal(levels[0].pct, 3.6);
});

test("resolveStructuralTargets: 진입가 바로 위(3% 미만)·서로 붙은 레벨은 제외/병합", () => {
  const levels = resolveStructuralTargets({ entryPrice: 100, boxHigh: 102, boxLow: 90, priorHigh: 115 });
  // 박스 상단 102(+2%)는 제외, 박스 목표 114와 직전 고점 115는 3% 이내라 하나로 병합
  assert.deepEqual(levels.map((l) => l.price), [114]);
  assert.deepEqual(resolveStructuralTargets({ entryPrice: 0, boxHigh: 10 }), []);
});

test("buildMirrorOrderSheet: 구조 저항을 참고 줄로 표시", () => {
  const entry = {
    ...buildBuyMirrorOrder({ kind: "new-buy", code: "240810", name: "원익IPS", quantity: 9, limitPrice: 130230, stopLossPct: 10, takeProfitPct: 12 }),
    structuralTargets: [{ label: "박스 상단", price: 134900, pct: 3.6 }],
  };
  const sheet = buildMirrorOrderSheet({ entries: [entry], scale: { basis: "virtual-seed", ratio: 1 } as any });
  assert.match(sheet ?? "", /구조 저항\(참고·자동매도 기준 아님\): 박스 상단 134,900원\(\+3\.6%\)/);
});
