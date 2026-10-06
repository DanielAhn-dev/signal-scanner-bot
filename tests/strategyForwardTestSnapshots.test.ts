import test from "node:test";
import assert from "node:assert/strict";
import {
  firstTradingDaysOfMonths,
  pickSnapshotOnOrBefore,
  simulateBotAccount,
  detectBotEquityJump,
} from "../src/services/strategyForwardTest";

test("firstTradingDaysOfMonths: 각 달의 첫 거래일", () => {
  assert.deepEqual(
    firstTradingDaysOfMonths(["2026-09-29", "2026-09-30", "2026-10-05", "2026-10-06", "2026-11-02"]),
    ["2026-09-29", "2026-10-05", "2026-11-02"]
  );
});

test("pickSnapshotOnOrBefore: 기준일 이하 최신, 없으면 가장 이른 스냅샷", () => {
  const snaps = [
    { asof: "2026-10-01", pass: ["A"] },
    { asof: "2026-09-29", pass: ["B"] },
  ];
  assert.equal(pickSnapshotOnOrBefore(snaps, "2026-09-30")?.pass[0], "B");
  assert.equal(pickSnapshotOnOrBefore(snaps, "2026-10-02")?.pass[0], "A");
  assert.equal(pickSnapshotOnOrBefore(snaps, "2026-09-25")?.pass[0], "B");
  assert.equal(pickSnapshotOnOrBefore([], "2026-09-25"), null);
});

test("simulateBotAccount: 평가액 변화를 이어 붙이고, 시드가 바뀐 날은 수익 0으로 본다", () => {
  const r = simulateBotAccount({
    startDate: "2026-09-28",
    points: [
      { date: "2026-09-28", seed: 100, total: 100 },
      { date: "2026-09-29", seed: 100, total: 110 }, // +10%
      { date: "2026-09-30", seed: 200, total: 210 }, // 시드 재설정 — 무시
      { date: "2026-10-01", seed: 200, total: 189 }, // -10%
    ],
  });
  assert.ok(r);
  assert.equal(r!.totalReturnPct.toFixed(2), "-1.00");
  assert.equal(r!.maxDrawdownPct.toFixed(2), "-10.00");
  assert.equal(simulateBotAccount({ startDate: "2026-09-28", points: [{ date: "2026-09-28", seed: 1, total: 1 }] }), null);
});

test("detectBotEquityJump: 입출금 없이 하루 15% 넘게 변하면 기록 오류로 본다(2026-10-01 현금 0 버그)", () => {
  const pts = [
    { date: "2026-09-29", seed: 19_732_419, total: 19_883_719, realized: 0 },
    { date: "2026-09-30", seed: 19_732_419, total: 19_883_404, realized: 0 },
  ];
  assert.match(String(detectBotEquityJump(pts, { date: "2026-10-01", seed: 19_732_419, total: 12_714_100, realized: -85_311 })), /-36\.1%/);
  assert.equal(detectBotEquityJump(pts, { date: "2026-10-01", seed: 19_732_419, total: 19_908_774, realized: -85_311 }), null);
  // 시드가 바뀐 입출금은 변동으로 보지 않는다
  assert.equal(detectBotEquityJump(pts, { date: "2026-10-01", seed: 29_732_419, total: 29_883_404, realized: 0 }), null);
  // 첫 기록은 비교 대상이 없다
  assert.equal(detectBotEquityJump([], pts[0]), null);
});
