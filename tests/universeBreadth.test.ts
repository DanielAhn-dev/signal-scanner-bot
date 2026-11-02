import test from "node:test";
import assert from "node:assert/strict";
import { computeUniverseBreadth } from "../src/lib/universeBreadth";

const rows = (n: number, up: (i: number) => boolean) =>
  Array.from({ length: n }, (_, i) => [
    { ticker: `T${i}`, date: "2026-11-02", close: up(i) ? 110 : 90 },
    { ticker: `T${i}`, date: "2026-10-30", close: 100 },
  ]).flat();

test("오른 종목 비율을 계산한다", () => {
  assert.equal(computeUniverseBreadth(rows(100, (i) => i < 25), "2026-11-02"), 25);
});

test("어느 한쪽 날짜 종가가 없는 종목은 제외한다", () => {
  const r = [...rows(60, () => true), { ticker: "ONLY_CUR", date: "2026-11-02", close: 50 }, { ticker: "ONLY_PREV", date: "2026-10-30", close: 50 }];
  assert.equal(computeUniverseBreadth(r, "2026-11-02"), 100);
});

test("비교 가능한 종목이 50개 미만이면 null", () => {
  assert.equal(computeUniverseBreadth(rows(49, () => true), "2026-11-02"), null);
});

test("행이 1000개를 넘어도(종목 600개 × 2일) 전부 센다", () => {
  assert.equal(computeUniverseBreadth(rows(600, (i) => i % 2 === 0), "2026-11-02"), 50);
});
