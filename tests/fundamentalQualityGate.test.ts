import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFundamentalGate, type QuarterRow } from "../src/services/fundamentalQualityGate";

const TODAY = "2026-09-28";
const q = (periodEnd: string, operatingIncome: number | null, eps: number | null, isConsensus = false): QuarterRow => ({
  periodEnd,
  operatingIncome,
  eps,
  isConsensus,
});

test("evaluateFundamentalGate: 흑자 + 영업이익 전년 같은 분기보다 증가면 통과", () => {
  const rows = [q("2025-06-30", 100, 10), q("2025-09-30", 110, 10), q("2025-12-31", 90, 10), q("2026-03-31", 120, 10), q("2026-06-30", 130, 10)];
  assert.deepEqual(evaluateFundamentalGate(rows, TODAY), { status: "pass" });
});

test("evaluateFundamentalGate: 최근 4분기 EPS 합이 음수면 적자로 제외", () => {
  const rows = [q("2025-06-30", 100, 10), q("2025-09-30", 110, -30), q("2025-12-31", 90, -10), q("2026-03-31", 120, 5), q("2026-06-30", 130, 5)];
  const r = evaluateFundamentalGate(rows, TODAY);
  assert.equal(r.status, "fail");
  assert.equal(r.status === "fail" && r.reason, "최근 4분기 적자");
});

test("evaluateFundamentalGate: 영업이익이 전년 같은 분기 이하면 제외", () => {
  const rows = [q("2025-06-30", 130, 10), q("2025-09-30", 110, 10), q("2025-12-31", 90, 10), q("2026-03-31", 120, 10), q("2026-06-30", 130, 10)];
  assert.equal(evaluateFundamentalGate(rows, TODAY).status, "fail");
});

test("evaluateFundamentalGate: 컨센서스(추정치) 행은 쓰지 않는다", () => {
  // 실제 최신 분기(2026-06)는 감소, 추정치(2026-09)는 급증 — 추정치로 통과시키면 안 된다
  const rows = [q("2025-06-30", 130, 10), q("2025-09-30", 110, 10), q("2025-12-31", 90, 10), q("2026-03-31", 120, 10), q("2026-06-30", 100, 10), q("2026-09-30", 999, 99, true)];
  assert.equal(evaluateFundamentalGate(rows, TODAY).status, "fail");
});

test("evaluateFundamentalGate: 데이터 부족·오래된 실적은 판정하지 않음(제외하지 않음)", () => {
  assert.equal(evaluateFundamentalGate([q("2026-06-30", 1, 1)], TODAY).status, "unknown");
  const old = [q("2024-06-30", 100, 10), q("2024-09-30", 110, 10), q("2024-12-31", 90, 10), q("2025-03-31", 120, 10)];
  assert.equal(evaluateFundamentalGate(old, TODAY).status, "unknown");
  const noYearAgo = [q("2025-09-30", 110, 10), q("2025-12-31", 90, 10), q("2026-03-31", 120, 10), q("2026-06-30", 130, 10)];
  assert.equal(evaluateFundamentalGate(noYearAgo, TODAY).status, "unknown");
});
