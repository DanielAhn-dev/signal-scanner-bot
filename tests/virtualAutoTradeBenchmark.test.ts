import test from "node:test";
import assert from "node:assert/strict";
import { computeReturnPct, formatBenchmarkLine, sumEtfDistributionNetPerShare } from "../src/services/virtualAutoTradeBenchmark";
import { computeDistributionCredit, exDividendDate, type EtfDistribution } from "../src/services/etfDistribution";

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

test("sumEtfDistributionNetPerShare: 기간 내 지급완료 분배금만 세후로 합산", () => {
  const d: EtfDistribution = { code: "069500", recordDate: "2026-06-26", payDate: "2026-07-05", perShare: 855, taxablePerShare: 855 };
  const exDate = exDividendDate(d.recordDate);
  const net = computeDistributionCredit(d, 1).net;

  // 기간 안(분배락일이 sinceDate 이후) + 이미 지급 완료 → 포함
  assert.equal(sumEtfDistributionNetPerShare([d], exDate, d.payDate), net);
  // 지급일이 아직 안 지남 → 제외
  assert.equal(sumEtfDistributionNetPerShare([d], exDate, "2026-07-04"), 0);
  // 계좌 시작일(sinceDate)이 분배락일보다 나중 → 그 전부터 들고 있던 게 아니므로 제외
  const dayAfterEx = new Date(new Date(`${exDate}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  assert.equal(sumEtfDistributionNetPerShare([d], dayAfterEx, d.payDate), 0);
});
