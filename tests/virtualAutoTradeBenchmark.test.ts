import test from "node:test";
import assert from "node:assert/strict";
import { computeReturnPct, formatBenchmarkLine } from "../src/services/virtualAutoTradeBenchmark";

test("formatBenchmarkLine: 계좌 vs 지수·CD금리 비교와 우위 판정", () => {
  const line = formatBenchmarkLine({
    sinceDate: "2026-06-09",
    accountReturnPct: -1.5,
    benchmarks: [
      { label: "KODEX200", returnPct: -5.2 },
      { label: "CD금리", returnPct: 0.3 },
    ],
  });
  assert.equal(line, "[기준선 06/09~] 계좌 -1.5% vs KODEX200 -5.2% · CD금리 +0.3% · 지수 대비 우위");
  assert.equal(computeReturnPct(100, 110), 10);
  assert.equal(computeReturnPct(0, 110), null);
});
