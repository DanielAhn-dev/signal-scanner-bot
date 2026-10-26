import test from "node:test";
import assert from "node:assert/strict";
import { diffDistributions, suspiciousRows } from "../src/services/etfDistributionStore";

const row = (recordDate: string, perShare: number) => ({ recordDate, payDate: null, perShare, ratePct: null });

test("diffDistributions: 새 기준일 / 금액이 바뀐 기준일 / 같은 기준일을 센다", () => {
  const existing = [
    { record_date: "2026-08-31", per_share: 168 },
    { record_date: "2026-09-30", per_share: 170 },
  ];
  const d = diffDistributions(existing, [row("2026-08-31", 168), row("2026-09-30", 175), row("2026-10-30", 160)]);
  assert.deepEqual(d, { added: 1, changed: 1, same: 1 });
  assert.deepEqual(diffDistributions([], [row("2026-09-30", 170)]), { added: 1, changed: 0, same: 0 });
});

test("suspiciousRows: 분배금이 현재가의 25%를 넘는 행만, 가격을 모르면 없음", () => {
  const rows = [row("2026-09-30", 170), row("2026-08-31", 3000)];
  assert.deepEqual(suspiciousRows(rows, 9_375).map((r) => r.recordDate), ["2026-08-31"]);
  assert.deepEqual(suspiciousRows(rows, null), []);
});
