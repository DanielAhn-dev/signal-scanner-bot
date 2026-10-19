import test from "node:test";
import assert from "node:assert/strict";
import type { GuideHistoryEntry } from "../src/lib/incomeGuide";
import { adviceFromPlan, buildAdherence } from "../src/lib/guideAdherence";

const E = (date: string, holdings: Array<[string, string, number]>, prices: Record<string, number>, advice?: GuideHistoryEntry["advice"]): GuideHistoryEntry => ({
  date,
  total: 1,
  groups: [],
  holdings: holdings.map(([code, name, quantity]) => ({ code, name, quantity })),
  prices,
  ...(advice ? { advice } : {}),
});
const ADVICE = { buy: [{ code: "294400", name: "KIWOOM 200TR" }], noBuyGroups: ["income" as const] };

test("adviceFromPlan: 계좌별 살 곳을 모두, 현금 채우는 중이면 아무것도 사지 않기", () => {
  const view = { groups: [{ group: "satellite" as const, actualPct: 15 }], settings: { satelliteCapPct: 10 } };
  const a = adviceFromPlan({ buyTarget: { code: "A", name: "A" }, buyTargetsByAccount: [{ target: { code: "A", name: "A" } }, { target: { code: "B", name: "B" } }] }, view)!;
  assert.deepEqual(a.buy.map((x) => x.code), ["A", "B"]);
  assert.deepEqual(a.noBuyGroups, ["income", "satellite"], "위성이 상한을 넘으면 위성도");
  const filling = adviceFromPlan({ buyTarget: { code: "A", name: "A" }, cash: { state: "filling" } }, view)!;
  assert.deepEqual(filling.buy, []);
  assert.equal(adviceFromPlan(null, view), null);
});

test("안내대로 산 것은 따름, 다른 TR·인컴을 산 것은 다르게 함 — 3개월 지나면 양쪽 지금 가치로 비교", () => {
  const history = [
    E("2026-07-01", [["278530", "KODEX 200TR", 100]], { "278530": 20_000, "294400": 20_000 }, ADVICE),
    E("2026-08-01", [["278530", "KODEX 200TR", 150], ["294400", "KIWOOM 200TR", 10], ["498400", "KODEX 200타겟위클리커버드콜", 100]], { "278530": 20_000, "294400": 20_000, "498400": 10_000 }),
  ];
  const now: Record<string, number> = { "278530": 22_000, "294400": 22_100, "498400": 9_000 };
  const s = buildAdherence({ history, today: "2026-12-01", priceOf: (c) => now[c] });
  assert.equal(s.followed, 1);
  assert.equal(s.deviated, 2);
  assert.equal(s.since, "2026-07-01");
  const kodex = s.rows.find((r) => r.code === "278530")!;
  assert.equal(kodex.amount, 1_000_000);
  assert.equal(kodex.actualNow, 1_100_000);
  assert.equal(kodex.advisedNow, 1_105_000);
  assert.equal(kodex.diff, -5_000);
  const cc = s.rows.find((r) => r.code === "498400")!;
  assert.match(cc.reason, /인컴 ETF는 더 사지 않기로/);
  assert.equal(cc.diff, 900_000 - 1_105_000);
  assert.equal(s.matureCount, 2);
});

test("분배금 받은 기록은 다르게 산 쪽 가치에 더한다 — 사용자 선택이 나았으면 그대로 플러스", () => {
  const history = [
    E("2026-07-01", [], { "294400": 20_000 }, ADVICE),
    E("2026-08-01", [["498400", "KODEX 200타겟위클리커버드콜", 100]], { "294400": 20_000, "498400": 10_000 }),
  ];
  const now: Record<string, number> = { "294400": 18_000, "498400": 10_000 };
  const receipts = [
    { id: "1", month: "2026-09", code: "498400", name: "x", quantity: 100, perShare: 100, net: 8_460, createdAt: "" },
    { id: "2", month: "2026-08", code: "498400", name: "x", quantity: 100, perShare: 100, net: null, createdAt: "" }, // 산 달은 넣지 않음
  ];
  const s = buildAdherence({ history, today: "2026-12-01", priceOf: (c) => now[c], receipts });
  const r = s.rows[0];
  assert.equal(r.actualNow, 1_000_000 + 8_460);
  assert.equal(r.advisedNow, 900_000);
  assert.ok(r.diff! > 0, "내 선택 우세도 그대로 보인다");
});

test("3개월 안 된 결정은 숫자 없이 아직, 사용자가 뺀 항목은 합계에서 제외, 안내 없는 예전 기록은 판정하지 않음", () => {
  const history = [
    E("2026-06-01", [], {}), // 안내 저장 전 기록
    E("2026-09-01", [], { "294400": 20_000 }, ADVICE),
    E("2026-10-01", [["498400", "KODEX 200타겟위클리커버드콜", 10], ["005930", "삼성전자", 1]], { "294400": 20_000, "498400": 10_000, "005930": 60_000 }),
  ];
  const s = buildAdherence({ history, today: "2026-11-15", priceOf: () => 1, excluded: ["2026-10-01|498400"] });
  assert.equal(s.since, "2026-09-01");
  const cc = s.rows.find((r) => r.code === "498400")!;
  assert.equal(cc.mature, false);
  assert.equal(cc.diff, null);
  assert.equal(cc.excluded, true);
  assert.equal(s.deviated, 0, "뺀 항목은 세지 않는다");
  assert.ok(!s.rows.some((r) => r.code === "005930"), "위성 상한을 안 넘었으면 개별주 매수는 판정하지 않는다");
  assert.equal(s.matureCount, 0);
});
