import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQualityAlert,
  buildWeeklyQualitySummary,
  evaluateQualityTrend,
  findBadNames,
  findLimitBreaches,
  findNewlyMissing,
  findRequiredIssues,
  isLastTradingDayOfWeek,
  type DailyMetrics,
  type MetricSpec,
} from "../src/services/dataQualityTrend";

const specs: MetricSpec[] = [
  { key: "scores", label: "종목 점수", floorShare: 0.9 },
  { key: "credit", label: "공매도 거래량", floorShare: 0.8 },
  { key: "balance", label: "공매도 잔고", trackOnly: true },
];

function days(series: Record<string, (number | null)[]>): DailyMetrics[] {
  const n = Object.values(series)[0].length;
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-10-${String(10 + i).padStart(2, "0")}`,
    values: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, v[i]])),
  }));
}

test("품질 추세: 평소 수준이면 급감·만성 없음", () => {
  const h = days({ scores: [230, 232, 231, 233, 230, 229, 231, 232], credit: [240, 241, 240, 242, 240, 241, 240, 241], balance: [60, 118, 70, 62, 90, 76, 63, 10] });
  assert.deepEqual(evaluateQualityTrend(h, specs, 244), { drops: [], chronic: [] });
});

test("품질 추세: 행 수는 그대로여도 정상 상태가 평소의 80% 아래로 떨어지면 급감", () => {
  const h = days({ scores: [230, 232, 231, 233, 230, 229, 231, 232], credit: [240, 241, 240, 242, 240, 241, 240, 150], balance: [60, 60, 60, 60, 60, 60, 60, 60] });
  const r = evaluateQualityTrend(h, specs, 244);
  assert.deepEqual(r.drops.map((d) => d.key), ["credit"]);
  assert.equal(r.drops[0].baseline, 240);
});

test("품질 추세: 평소부터 낮던 항목은 급감이 아니라 만성 부족으로", () => {
  const h = days({ scores: [150, 151, 150, 152, 150, 151, 150, 151], credit: [240, 241, 240, 242, 240, 241, 240, 241], balance: [0, 0, 0, 0, 0, 0, 0, 0] });
  const r = evaluateQualityTrend(h, specs, 244);
  assert.deepEqual(r.drops, []);
  assert.deepEqual(r.chronic.map((c) => c.key), ["scores"]);
});

test("품질 추세: 조회 실패(null) 날은 평소 계산에서 빠지고 최신이 null이면 판정 안 함", () => {
  const h = days({ scores: [null, null, 230, 231, 232, 230, 231, null], credit: [240, null, 240, 242, 240, 241, 240, 241], balance: [1, 1, 1, 1, 1, 1, 1, 1] });
  assert.deepEqual(evaluateQualityTrend(h, specs, 244).drops, []);
});

test("가격제한폭 초과: 분할 미반영처럼 ±30% 넘는 등락만 큰 순으로", () => {
  const prev = [{ ticker: "A", close: 10000 }, { ticker: "B", close: 10000 }, { ticker: "C", close: 10000 }, { ticker: "D", close: 0 }];
  const latest = [{ ticker: "A", close: 13000 }, { ticker: "B", close: 2000 }, { ticker: "C", close: 14000 }, { ticker: "D", close: 5000 }, { ticker: "E", close: 100 }];
  assert.deepEqual(findLimitBreaches(latest, prev).map((b) => b.ticker), ["B", "C"]);
});

test("새로 빠진 종목: 어제 있던 유니버스 종목만, 원래 없던 거래정지 종목은 제외", () => {
  assert.deepEqual(findNewlyMissing(["A", "B", "C", "S"], ["A"], ["A", "B", "C"]), ["B", "C"]);
});

test("이름 이상: 비었거나 코드와 같은 행", () => {
  assert.deepEqual(findBadNames([{ code: "005930", name: "삼성전자" }, { code: "000001", name: "000001" }, { code: "000002", name: " " }, { code: "000003", name: null }]), ["000001", "000002", "000003"]);
});

test("품질 알림: 문제가 없으면 보내지 않는다", () => {
  assert.equal(buildQualityAlert({ trend: { drops: [], chronic: [{ key: "x", label: "x", latest: 1, share: 0.1, floorShare: 0.9 }] }, limitBreaches: [], newlyMissing: [], badNames: [] }), null);
  const msg = buildQualityAlert({ trend: { drops: [{ key: "credit", label: "공매도 거래량", latest: 150, baseline: 241 }] }, limitBreaches: [], newlyMissing: ["B"], badNames: [] } as never);
  assert.ok(msg && msg.includes("평소 241건의 62%") && msg.includes("오늘 빠진 종목 1개"));
});

test("주간 요약: 최근 5거래일 값과 만성 부족 표시", () => {
  const h = days({ scores: [1, 2, 3, 4, 5, 6, 7, 8], credit: [1, 1, 1, 1, 1, 1, 1, null], balance: [0, 0, 0, 0, 0, 0, 0, 0] });
  const text = buildWeeklyQualitySummary(h, specs, 244, [{ key: "b", label: "공매도 잔고 누적", latest: 80, share: 0.33, floorShare: 0.9 }]);
  assert.ok(text.includes("종목 점수: 4 · 5 · 6 · 7 · 8"));
  assert.ok(text.includes("공매도 거래량: 1 · 1 · 1 · 1 · -"));
  assert.ok(text.includes("공매도 잔고 누적: 33% (기준 90%)"));
});

test("주의 마지막 거래일: 금요일, 금요일 휴장이면 목요일", () => {
  assert.equal(isLastTradingDayOfWeek("2026-10-23", "2026-10-26"), true); // 금→월
  assert.equal(isLastTradingDayOfWeek("2026-10-21", "2026-10-22"), false); // 수→목
  assert.equal(isLastTradingDayOfWeek("2026-10-01", "2026-10-05"), true); // 목→(금 휴장)월
});

test("필요 종목은 비활성이어도 문제를 알린다", () => {
  const required = new Map([
    ["091170", ["보유"]],
    ["210780", ["보유"]],
    ["069500", ["시장 판정"]],
    ["999999", ["추천"]],
  ]);
  const rows = [
    { code: "091170", name: "KODEX 은행", is_active: true, close: 0 }, // 2026-10-21: close=0이 −100%로 쓰였다
    { code: "210780", name: "210780", is_active: false, close: null },
    { code: "069500", name: "KODEX 200", is_active: true, close: 40000 },
  ];
  const issues = findRequiredIssues(required, rows, new Set(["069500", "091170"]));
  assert.deepEqual(issues, [
    { code: "091170", uses: ["보유"], issues: ["종가 없음"] },
    { code: "210780", uses: ["보유"], issues: ["비활성", "이름 없음", "종가 없음", "그날 시세 없음"] },
    { code: "999999", uses: ["추천"], issues: ["종목 목록에 없음", "그날 시세 없음"] },
  ]);
});

test("그날 시세를 못 읽었으면 시세 항목은 건너뛴다", () => {
  const issues = findRequiredIssues(new Map([["069500", ["시장 판정"]]]), [{ code: "069500", name: "KODEX 200", is_active: true, close: 40000 }], null);
  assert.deepEqual(issues, []);
});

test("필요 종목 문제는 알림 맨 위에 쓰임과 함께 적는다", () => {
  const msg = buildQualityAlert({
    trend: { drops: [], chronic: [] },
    limitBreaches: [],
    newlyMissing: [],
    badNames: [],
    requiredIssues: [{ code: "091170", uses: ["보유"], issues: ["종가 없음"] }],
    nameByCode: new Map([["091170", "KODEX 은행"]]),
  });
  assert.ok(msg);
  assert.match(msg!, /보유·추천에 필요한 종목 문제 1개/);
  assert.match(msg!, /KODEX 은행\(091170\) \[보유\] 종가 없음/);
});
