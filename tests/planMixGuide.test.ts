import test from "node:test";
import assert from "node:assert/strict";
import { indexOfProductName, planMixLineForAccount, planMixLines, splitAmount } from "../src/lib/planMixGuide";

const half = [
  { index: "kospi200", weight: 0.5, product: null, account: { broker: "키움", account: "일반" } },
  { index: "sp500", weight: 0.5, product: { code: "360750", name: "TIGER 미국S&P500" }, account: { broker: "토스", account: "ISA" } },
];

test("구성이 없거나 코스피200 하나면 null — 예전처럼 성장 ETF 한 곳", () => {
  assert.equal(planMixLines({ mix: null, monthly: 1_000_000 }), null);
  assert.equal(planMixLines({ mix: [{ index: "kospi200", weight: 1, product: null, account: null }], monthly: 1_000_000 }), null);
});

test("지수마다 한 줄: 계획 × 비중(홈 할 일과 같은 나누기), 고른 상품 → 가진 같은 지수 상품, 계좌", () => {
  const lines = planMixLines({ mix: half, monthly: 1_220_000, held: [{ code: "294400", name: "KIWOOM 200TR", accountKey: "키움|일반" }, { code: "069500", name: "KODEX 200", accountKey: "토스|ISA" }] })!;
  assert.deepEqual(lines.map((l) => [l.label, l.weightPct, l.monthly, l.product?.name, l.accountKey]), [
    ["코스피200", 50, 610_000, "KIWOOM 200TR", "키움|일반"],
    ["S&P500", 50, 610_000, "TIGER 미국S&P500", "토스|ISA"],
  ]);
  assert.deepEqual(splitAmount(1_000_000, [1 / 3, 1 / 3, 1 / 3]), [330_000, 330_000, 340_000]);
});

test("상품 이름으로 지수 판정 — 업종·레버리지·환헤지는 제외", () => {
  assert.equal(indexOfProductName("KIWOOM 200TR"), "kospi200");
  assert.equal(indexOfProductName("KODEX 200"), "kospi200");
  assert.equal(indexOfProductName("ACE 미국S&P500"), "sp500");
  assert.equal(indexOfProductName("TIGER 미국나스닥100"), "nasdaq100");
  for (const n of ["KODEX 미국S&P500테크놀로지", "TIGER 미국나스닥100레버리지(합성)", "KODEX 미국S&P500(H)", "KODEX 200선물인버스2X", "KODEX 코스닥150"]) {
    assert.equal(indexOfProductName(n), null, n);
  }
});

test("리포트 한 줄: 이 계좌가 맡은 몫 / 다른 계좌에서 삽니다 / 아직 계좌를 안 정함", () => {
  const lines = planMixLines({ mix: half, monthly: 1_220_000 })!;
  assert.match(planMixLineForAccount(lines, "토스|ISA"), /이 계좌는 S&P500 몫\(매달 61만원 → TIGER 미국S&P500\)을 삽니다/);
  assert.match(planMixLineForAccount(lines, "미래|연금"), /이 계좌에 정한 지수는 없습니다\. 코스피200은 키움 · 일반, S&P500은 토스 · ISA에서 삽니다/);
  const noAccount = planMixLines({ mix: half.map((e) => ({ ...e, account: null })), monthly: 1_220_000 })!;
  assert.match(planMixLineForAccount(noAccount, "키움|일반"), /홈 '이번 달 할 일'에서 처음 살 때 정해집니다/);
});
