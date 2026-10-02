import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_PROFILES,
  PROFILE_CODES,
  PROFILE_ETFS,
  parseNaverSiseJson,
  simulateAllCoreProfiles,
  simulateCoreProfile,
  type CloseBar,
} from "../src/services/coreProfiles";
import { NON_CANDIDATE_STRATEGIES } from "../src/services/strategyForwardTest";

const series = (rows: Array<[string, number]>): CloseBar[] => rows.map(([date, close]) => ({ date, close }));

test("coreProfiles: 모든 프로필의 비중 합은 1이고 구성 ETF 이름이 정의돼 있다", () => {
  for (const p of CORE_PROFILES) {
    const sum = Object.values(p.weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${p.name} 비중 합 ${sum}`);
  }
  for (const code of PROFILE_CODES) assert.ok(PROFILE_ETFS[code], `${code} 이름 없음`);
});

test("coreProfiles: 프로필은 종목 봇 승격 후보가 아니다", () => {
  for (const p of CORE_PROFILES) assert.ok(NON_CANDIDATE_STRATEGIES.includes(p.name), p.name);
});

test("coreProfiles: 네이버 응답에서 날짜와 종가를 읽는다", () => {
  const text = `[["날짜","시가","고가","저가","종가","거래량","외국인소진율"],
["20260928", 100, 101, 99, 100, 1000, 0.1],
["20260929", 100, 103, 99, 102.5, 1000, 0.1],
]`;
  assert.deepEqual(parseNaverSiseJson(text), series([["2026-09-28", 100], ["2026-09-29", 102.5]]));
});

test("coreProfiles: 한 자산 100%면 그 자산의 기준일 이후 수익과 같다", () => {
  const closes = new Map([["360750", series([["2026-09-25", 100], ["2026-09-28", 101], ["2026-09-29", 103.02]])]]);
  const r = simulateCoreProfile({ profile: { name: "sp500-hold", weights: { "360750": 1 } }, closesByCode: closes, startDate: "2026-09-28" })!;
  // 기준일 직전 종가(100) → 마지막(103.02)
  assert.ok(Math.abs(r.totalReturnPct - 3.02) < 1e-9);
  assert.equal(r.periods, 2);
});

test("coreProfiles: 두 자산을 섞으면 그 사이 수익이 나오고 낙폭이 줄어든다", () => {
  const a = series([["2026-09-25", 100], ["2026-09-28", 100], ["2026-09-29", 80], ["2026-09-30", 80]]);
  const b = series([["2026-09-25", 100], ["2026-09-28", 100], ["2026-09-29", 100], ["2026-09-30", 100]]);
  const closes = new Map([["069500", a], ["411060", b]]);
  const mix = simulateCoreProfile({ profile: { name: "profile-domestic", weights: { "069500": 0.5, "411060": 0.5 } }, closesByCode: closes, startDate: "2026-09-28" })!;
  const alone = simulateCoreProfile({ profile: { name: "kodex200-hold", weights: { "069500": 1 } }, closesByCode: closes, startDate: "2026-09-28" })!;
  assert.ok(Math.abs(mix.totalReturnPct - -10) < 1e-9);
  assert.ok(mix.maxDrawdownPct > alone.maxDrawdownPct);
});

test("coreProfiles: 해가 바뀌면 목표 비중으로 되돌리며 비용을 뗀다", () => {
  const a = series([["2026-12-29", 100], ["2026-12-30", 200], ["2027-01-04", 200], ["2027-01-05", 200]]);
  const b = series([["2026-12-29", 100], ["2026-12-30", 100], ["2027-01-04", 100], ["2027-01-05", 100]]);
  const closes = new Map([["069500", a], ["411060", b]]);
  const r = simulateCoreProfile({ profile: { name: "profile-domestic", weights: { "069500": 0.5, "411060": 0.5 } }, closesByCode: closes, startDate: "2026-12-30" })!;
  // 12-30: 0.5*2+0.5 = 1.5, 비중 (0.667, 0.333) → 목표 (0.5, 0.5)로 되돌리면 바뀐 비중 합 0.333 × 0.035% 비용
  assert.ok(Math.abs(r.totalReturnPct - (1.5 * (1 - (1 / 3) * 0.00035) - 1) * 100) < 1e-9);
});

test("coreProfiles: 구성 ETF 데이터가 없으면 그 프로필은 건너뛴다", () => {
  const closes = new Map([["069500", series([["2026-09-25", 100], ["2026-09-28", 101]])]]);
  assert.equal(simulateAllCoreProfiles(closes, "2026-09-28").length, 0);
});
