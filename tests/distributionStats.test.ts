import test from "node:test";
import assert from "node:assert/strict";
import { computeDistributionStats, pickYieldPct, type DistRow } from "../src/lib/distributionStats";

const monthly = (start: string, values: number[]): DistRow[] =>
  values.map((v, i) => {
    const d = new Date(Date.parse(start) + i * 30.44 * 86_400_000);
    return { record_date: d.toISOString().slice(0, 10), per_share: v };
  });

test("1년 넘는 이력은 마지막 지급일 기준 최근 12개월 실제 합계(ttm)", () => {
  // RISE 밸류업고정: 13회 2025-10-15 ~ 2026-10-15, 12개월 합 4,560
  const rows: DistRow[] = [105, 210, 125, 190, 310, 400, 340, 390, 420, 590, 580, 540, 465].map((v, i) => ({
    record_date: ["2025-10-15", "2025-11-14", "2025-12-15", "2026-01-15", "2026-02-13", "2026-03-13", "2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15", "2026-08-14", "2026-09-15", "2026-10-15"][i],
    per_share: v,
  }));
  const s = computeDistributionStats("0094M0", rows, "2026-10-26")!;
  assert.equal(s.basis, "ttm");
  assert.equal(s.payments, 13);
  assert.equal(s.annualPerShare, 210 + 125 + 190 + 310 + 400 + 340 + 390 + 420 + 590 + 580 + 540 + 465);
  assert.equal(s.gapMonths, 1);
  assert.equal(s.stale, false);
  assert.ok(Math.abs(s.lastVsPeakPct - (465 / 590) * 100) < 0.01);
});

test("짧은 이력은 최근 3·6회 평균 중 낮은 쪽을 연환산한다 (SOL 200타겟: 250→170 하락 중)", () => {
  const rows = monthly("2026-04-30", [250, 217, 223, 150, 168, 170]);
  const s = computeDistributionStats("0167B0", rows, "2026-10-26")!;
  assert.equal(s.basis, "recent");
  const m3 = (150 + 168 + 170) / 3;
  assert.ok(Math.abs(s.annualPerShare - m3 * 12) < 0.01);
  assert.ok(s.trendPct! < -25 && s.trendPct! > -33);
  assert.ok(s.cv6! > 0.1 && s.cv6! < 0.25);
});

test("마지막 지급이 간격을 훨씬 넘어 오래됐으면 stale, 분기 지급은 간격을 3개월로 본다", () => {
  const m = computeDistributionStats("X", monthly("2026-01-31", [100, 100, 100, 100]), "2026-10-26")!;
  assert.equal(m.stale, true);
  const q = computeDistributionStats("Q", [
    { record_date: "2025-12-30", per_share: 300 },
    { record_date: "2026-03-31", per_share: 300 },
    { record_date: "2026-06-30", per_share: 300 },
  ], "2026-08-20")!;
  assert.equal(q.gapMonths, 3);
  assert.equal(q.stale, false);
  assert.ok(Math.abs(q.annualPerShare - 300 * 4) < 1);
});

test("pickYieldPct: 6회 이상이면 이력 값, 짧으면 네이버와 낮은 쪽, 낡거나 가격 없으면 null", () => {
  const long = computeDistributionStats("A", monthly("2025-08-31", [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]), "2026-09-20")!;
  assert.ok(Math.abs(pickYieldPct(long, 1000, 9)!.pct - 120) < 1);
  assert.equal(pickYieldPct(long, 1000, 9)!.source, "history");
  const short = computeDistributionStats("B", monthly("2026-07-31", [153, 167, 175]), "2026-10-26")!;
  // KODEX 200커버드콜액티브: 이력 값 약 30%, 네이버 7.5% → 낮은 쪽
  const picked = pickYieldPct(short, 6_590, 7.51)!;
  assert.equal(picked.source, "short");
  assert.equal(picked.pct, 7.51);
  assert.ok(pickYieldPct(short, 6_590, null)!.pct > 25);
  assert.equal(pickYieldPct(short, 0, 7.5), null);
  const old = computeDistributionStats("C", monthly("2025-01-31", [100, 100, 100, 100, 100, 100]), "2026-10-26")!;
  assert.equal(pickYieldPct(old, 1000, 5), null);
  assert.equal(pickYieldPct(null, 1000, 5), null);
});
