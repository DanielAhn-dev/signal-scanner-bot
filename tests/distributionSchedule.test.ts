import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDistribution } from "../src/lib/distributionSchedule";

const rows = (dates: string[], payGap?: number) =>
  dates.map((d) => ({
    record_date: d,
    pay_date: payGap == null ? null : new Date(Date.parse(d) + payGap * 86_400_000).toISOString().slice(0, 10),
  }));

test("월분배: 월말 마지막 거래일 규칙이면 다음 월말 거래일로 추정하고 분배락은 하루 전, 마지막 매수일은 이틀 전", () => {
  // 2026-10-31은 토요일 → 10-30(금)이 기준일
  const n = nextDistribution(rows(["2026-07-31", "2026-08-31", "2026-09-30"]), "2026-10-20");
  assert.ok(n);
  assert.equal(n.recordDate, "2026-10-30");
  assert.equal(n.exDate, "2026-10-29");
  assert.equal(n.lastBuyDate, "2026-10-28");
  assert.equal(n.intervalMonths, 1);
  assert.equal(n.estimated, true);
  assert.equal(n.payDate, null);
});

test("마지막 매수일이 이미 지났으면 그 다음 회차를 보여 준다", () => {
  const n = nextDistribution(rows(["2026-07-31", "2026-08-31", "2026-09-30"]), "2026-10-29");
  assert.ok(n);
  assert.equal(n.recordDate, "2026-11-30");
});

test("지급일 간격이 이력에 있으면 지급일도 추정한다", () => {
  const n = nextDistribution(rows(["2026-07-31", "2026-08-31", "2026-09-30"], 7), "2026-10-20");
  assert.ok(n);
  assert.ok(n.payDate && n.payDate > n.recordDate);
});

test("분기 분배는 3개월 뒤 같은 날짜 규칙", () => {
  const n = nextDistribution(rows(["2026-01-15", "2026-04-15", "2026-07-15"]), "2026-09-01");
  assert.ok(n);
  assert.equal(n.intervalMonths, 3);
  assert.equal(n.recordDate, "2026-10-15");
});

test("이력에 이미 다가오는 기준일이 있으면 추정이 아니라 그 값", () => {
  const n = nextDistribution(rows(["2026-08-31", "2026-09-30", "2026-10-30"]), "2026-10-20");
  assert.ok(n);
  assert.equal(n.recordDate, "2026-10-30");
  assert.equal(n.estimated, false);
});

test("이력이 3건 미만이거나 오래 끊겼으면 추정하지 않는다", () => {
  assert.equal(nextDistribution(rows(["2026-08-31", "2026-09-30"]), "2026-10-20"), null);
  assert.equal(nextDistribution(rows(["2024-01-31", "2024-02-29", "2024-03-29"]), "2026-10-20"), null);
});
