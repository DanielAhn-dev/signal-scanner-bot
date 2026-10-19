// 리밸런싱 가이드 주문안이 내 계획 구성(지수·비중·상품·계좌)대로 사는지 — 홈 할 일·가이드 ①과 같은 기준
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView, type GuideHolding, type IncomeGuideSettings } from "../src/lib/incomeGuide";

const settings: IncomeGuideSettings = { ...DEFAULT_INCOME_GUIDE_SETTINGS, overseasPct: 50 };
const h = (code: string, name: string, price: number, quantity: number, accountKey: string, accountLabel: string): GuideHolding => ({
  code, name, price, quantity, accountKey, accountLabel, avgPrice: price,
});
// 인컴 목표 10%를 채우고도 남는 큰 새 돈. 해외는 S&P500을 많이, 나스닥100을 조금 가진 상태 — 예전 규칙이면 새 돈이 가진 금액 비례(대부분 S&P500)로 간다
const holdings: GuideHolding[] = [
  h("069500", "KODEX 200", 50_000, 200, "키움|일반", "키움 / 일반"),
  h("360750", "TIGER 미국S&P500", 20_000, 450, "미래|ISA", "미래 / ISA"),
  h("133690", "TIGER 미국나스닥100", 100_000, 10, "미래|ISA", "미래 / ISA"),
];
const mix = [
  { index: "kospi200", weight: 0.5, product: null, account: null },
  { index: "sp500", weight: 0.25, product: null, account: { broker: "미래", account: "ISA" } },
  { index: "nasdaq100", weight: 0.25, product: null, account: { broker: "미래", account: "ISA" } },
];

function globalBuys(planMix: typeof mix | null) {
  const v = buildIncomeGuideView({ holdings, settings, today: "2026-10-19", contribution: 20_000_000, planMix });
  const buys = v.contribution!.orders.filter((o) => o.side === "buy");
  const amt = (code: string) => buys.filter((o) => o.code === code).reduce((s, o) => s + o.amount, 0);
  return { sp: amt("360750"), nq: amt("133690"), v };
}

test("구성이 있으면 해외 몫 안의 S&P500·나스닥100을 구성 비중(반반)대로 산다", () => {
  const before = globalBuys(null);
  assert.ok(before.sp > before.nq * 3, "구성 없으면 가진 금액 비례");
  const after = globalBuys(mix);
  assert.ok(after.sp > 0 && after.nq > 0);
  assert.ok(Math.abs(after.sp - after.nq) <= 200_000, `반반이어야 함: ${after.sp} vs ${after.nq}`);
});

test("구성 지수를 가진 상품이 없으면 그 지수 이름·고른 상품으로 '새로 살 금액'을 남긴다", () => {
  const noNasdaq = holdings.filter((x) => x.code !== "133690");
  const withProduct = mix.map((e) => (e.index === "nasdaq100" ? { ...e, product: { code: "133690", name: "TIGER 미국나스닥100" } } : e));
  const v = buildIncomeGuideView({ holdings: noNasdaq, settings, today: "2026-10-19", contribution: 20_000_000, planMix: withProduct });
  const u = v.contribution!.unfilled.find((x) => x.indexLabel === "나스닥100");
  assert.ok(u, "나스닥100 몫이 새로 살 금액으로 남아야 함");
  assert.equal(u!.productName, "TIGER 미국나스닥100");
  assert.ok(u!.amount > 0);
});

test("구성에 고른 상품·계좌가 있으면 그 줄에서 산다", () => {
  const two = [...holdings, h("379800", "KODEX 미국S&P500", 19_000, 10, "키움|일반", "키움 / 일반")];
  const picked = mix.map((e) => (e.index === "sp500" ? { ...e, product: { code: "379800", name: "KODEX 미국S&P500" }, account: { broker: "키움", account: "일반" } } : e));
  const v = buildIncomeGuideView({ holdings: two, settings, today: "2026-10-19", contribution: 20_000_000, planMix: picked });
  const spBuys = v.contribution!.orders.filter((o) => o.side === "buy" && /S&P500/.test(o.name));
  assert.deepEqual([...new Set(spBuys.map((o) => o.code))], ["379800"]);
});

test("코스피200 하나뿐인 구성은 예전과 같다", () => {
  const solo = [{ index: "kospi200", weight: 1, product: null, account: null }];
  const a = buildIncomeGuideView({ holdings, settings, today: "2026-10-19", contribution: 20_000_000, planMix: solo });
  const b = buildIncomeGuideView({ holdings, settings, today: "2026-10-19", contribution: 20_000_000 });
  assert.deepEqual(a.contribution, b.contribution);
  assert.deepEqual(a.rebalance.orders, b.rebalance.orders);
});
