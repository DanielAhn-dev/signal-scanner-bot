import test from "node:test";
import assert from "node:assert/strict";
import { buildChoiceReview, sanitizeEvents, MIN_REVIEW_DAYS, type SwitchEvent } from "../src/services/choiceReview";

const event: SwitchEvent = {
  id: "e1", date: "2026-01-02", from: "stock", to: "index_hold", value: 1_000_000, cash: 200_000,
  holdings: [{ code: "005930", qty: 10 }], // 80,000원 x 10 = 800,000 + 현금 200,000
};
const hist = (date: string, total: number) => ({ date, seed: 1_000_000, total });
const closes = { "005930": [{ date: "2026-01-02", close: 80_000 }, { date: "2026-03-01", close: 88_000 }] };

test("choiceReview: 전환 뒤 30일이 지나기 전에는 숫자를 내지 않는다", () => {
  const r = buildChoiceReview({ event, history: [hist("2026-01-02", 1_000_000), hist("2026-01-20", 1_020_000)], closes });
  assert.equal(r.ready, false);
  assert.equal(r.points.length, 0);
  assert.equal(r.actualPct, null);
});

test("choiceReview: 실제와 안 바꿨다면을 같은 출발점에서 비교한다", () => {
  const r = buildChoiceReview({ event, history: [hist("2026-01-02", 1_000_000), hist("2026-03-01", 1_050_000)], closes });
  assert.equal(r.ready, true);
  assert.ok(r.days >= MIN_REVIEW_DAYS);
  assert.ok(Math.abs((r.actualPct ?? 0) - 5) < 1e-9);
  // 안 바꿨다면: 88,000 x 10 + 200,000 = 1,080,000 → +8%
  assert.ok(Math.abs((r.altPct ?? 0) - 8) < 1e-9);
  assert.ok(Math.abs((r.diffPct ?? 0) - -3) < 1e-9);
  assert.equal(r.points[0].actual, 100);
  assert.equal(r.points[0].alt, 100);
});

test("choiceReview: 입금한 날은 수익으로 치지 않는다", () => {
  const h = [
    { date: "2026-01-02", seed: 1_000_000, total: 1_000_000 },
    { date: "2026-02-01", seed: 1_600_000, total: 1_600_000 }, // 60만원 입금
    { date: "2026-03-01", seed: 1_600_000, total: 1_680_000 }, // +5%
  ];
  const r = buildChoiceReview({ event, history: h, closes });
  assert.ok(Math.abs((r.actualPct ?? 0) - 5) < 1e-9);
});

test("choiceReview: 가격 기록이 없으면 안 바꿨다면은 비우고 실제만 보여준다", () => {
  const r = buildChoiceReview({ event, history: [hist("2026-01-02", 1_000_000), hist("2026-03-01", 1_050_000)], closes: {} });
  assert.equal(r.ready, true);
  assert.equal(r.altPct, null);
  assert.equal(r.diffPct, null);
});

test("choiceReview: 저장소에서 읽은 입력을 검증·축소한다", () => {
  const events = sanitizeEvents([
    { date: "bad", holdings: [] },
    { id: "ok", date: "2026-01-02", from: "stock", to: "index_hold", value: "100", cash: -5, holdings: [{ code: "005930", qty: 3.9 }, { code: "!!", qty: 1 }, { code: "069500", qty: 0 }] },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].cash, 0);
  assert.deepEqual(events[0].holdings, [{ code: "005930", qty: 3 }]);
});
