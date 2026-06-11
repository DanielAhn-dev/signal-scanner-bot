import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBuyMirrorOrder,
  buildMirrorOrderSheet,
  buildSellMirrorOrder,
  resolveKrxTickSize,
  resolveMirrorScale,
  roundToKrxTick,
  scaleMirrorQuantity,
} from "../src/services/mtsMirrorOrderService";

test("resolveKrxTickSize: KRX 호가단위 구간을 반환한다", () => {
  assert.equal(resolveKrxTickSize(1_500), 1);
  assert.equal(resolveKrxTickSize(2_000), 5);
  assert.equal(resolveKrxTickSize(4_990), 5);
  assert.equal(resolveKrxTickSize(5_000), 10);
  assert.equal(resolveKrxTickSize(19_990), 10);
  assert.equal(resolveKrxTickSize(20_000), 50);
  assert.equal(resolveKrxTickSize(50_000), 100);
  assert.equal(resolveKrxTickSize(200_000), 500);
  assert.equal(resolveKrxTickSize(500_000), 1_000);
});

test("roundToKrxTick: 내림/올림 방향대로 호가단위에 맞춘다", () => {
  assert.equal(roundToKrxTick(71_230, "floor"), 71_200);
  assert.equal(roundToKrxTick(71_230, "ceil"), 71_300);
  assert.equal(roundToKrxTick(71_200, "ceil"), 71_200);
  assert.equal(roundToKrxTick(0), 0);
});

test("resolveMirrorScale: 실투자금/가상시드 비율을 계산한다", () => {
  const scale = resolveMirrorScale({ realCapitalKrw: 5_000_000, virtualSeedCapital: 3_000_000 });
  assert.equal(scale.basis, "real-capital");
  assert.ok(Math.abs(scale.ratio - 5 / 3) < 1e-9);
});

test("resolveMirrorScale: 실투자금 미설정이면 가상 수량 그대로(virtual-only)", () => {
  assert.equal(resolveMirrorScale({ realCapitalKrw: 0, virtualSeedCapital: 3_000_000 }).basis, "virtual-only");
  assert.equal(resolveMirrorScale({ realCapitalKrw: null, virtualSeedCapital: 3_000_000 }).basis, "virtual-only");
  assert.equal(resolveMirrorScale({ realCapitalKrw: 5_000_000, virtualSeedCapital: 0 }).basis, "virtual-only");
});

test("resolveMirrorScale: 비율이 사실상 1이면 1로 고정한다", () => {
  const scale = resolveMirrorScale({ realCapitalKrw: 3_000_000, virtualSeedCapital: 3_000_000 });
  assert.equal(scale.basis, "real-capital");
  assert.equal(scale.ratio, 1);
});

test("scaleMirrorQuantity: 버림 환산하되 최소 1주를 보장한다", () => {
  const half = resolveMirrorScale({ realCapitalKrw: 1_500_000, virtualSeedCapital: 3_000_000 });
  assert.equal(scaleMirrorQuantity(5, half), 2);
  assert.equal(scaleMirrorQuantity(1, half), 1);
  assert.equal(scaleMirrorQuantity(0, half), 0);

  const virtualOnly = resolveMirrorScale({ realCapitalKrw: 0, virtualSeedCapital: 0 });
  assert.equal(scaleMirrorQuantity(5, virtualOnly), 5);
});

test("buildBuyMirrorOrder: 손절은 올림, 매수가/익절은 내림으로 호가 보정한다", () => {
  const entry = buildBuyMirrorOrder({
    kind: "new-buy",
    code: "005930",
    name: "삼성전자",
    quantity: 5,
    limitPrice: 71_230,
    stopLossPct: 8,
    takeProfitPct: 8,
  });

  assert.equal(entry.limitPrice, 71_200);
  // 71,230 * 0.92 = 65,531.6 → ceil → 65,600
  assert.equal(entry.stopLossPrice, 65_600);
  // 71,230 * 1.08 = 76,928.4 → floor → 76,900
  assert.equal(entry.takeProfitPrice, 76_900);
});

test("buildBuyMirrorOrder: 추가매수는 새 평균단가 기준으로 손절/익절을 계산한다", () => {
  const entry = buildBuyMirrorOrder({
    kind: "add-on-buy",
    code: "035720",
    quantity: 3,
    limitPrice: 50_000,
    exitBasePrice: 48_000,
    stopLossPct: 10,
    takeProfitPct: 10,
  });

  assert.equal(entry.limitPrice, 50_000);
  // 48,000 * 0.9 = 43,200 → ceil(tick 50) → 43,200
  assert.equal(entry.stopLossPrice, 43_200);
  // 48,000 * 1.1 = 52,800 → floor(tick 100) → 52,800
  assert.equal(entry.takeProfitPrice, 52_800);
});

test("buildMirrorOrderSheet: 항목이 없으면 null", () => {
  const scale = resolveMirrorScale({ realCapitalKrw: 0, virtualSeedCapital: 0 });
  assert.equal(buildMirrorOrderSheet({ entries: [], scale }), null);
});

test("buildMirrorOrderSheet: 매도가 매수보다 먼저 나오고 환산 수량이 표기된다", () => {
  const scale = resolveMirrorScale({ realCapitalKrw: 6_000_000, virtualSeedCapital: 3_000_000 });
  const sheet = buildMirrorOrderSheet({
    entries: [
      buildBuyMirrorOrder({
        kind: "new-buy",
        code: "005930",
        name: "삼성전자",
        quantity: 5,
        limitPrice: 71_200,
        stopLossPct: 8,
        takeProfitPct: 8,
      }),
      buildSellMirrorOrder({
        kind: "stop-loss",
        code: "035720",
        name: "카카오",
        quantity: 4,
        limitPrice: 55_000,
        remainQuantity: 0,
        pnlPct: -4.2,
      }),
    ],
    scale,
  });

  assert.ok(sheet);
  const text = sheet as string;
  assert.ok(text.includes("[MTS 따라하기 주문서]"));
  assert.ok(text.indexOf("[매도 1]") < text.indexOf("[매수 1]"), "매도가 매수보다 먼저 나와야 함");
  assert.ok(text.includes("카카오(035720) · 손절"));
  assert.ok(text.includes("지정가 매도 55,000원 × 8주 (가상 4주) (전량)"));
  assert.ok(text.includes("삼성전자(005930) · 신규"));
  assert.ok(text.includes("지정가 매수 71,200원 × 10주 (가상 5주)"));
  assert.ok(text.includes("2.00배 환산"));
});

test("buildMirrorOrderSheet: 부분매도는 잔여 수량을 표기한다", () => {
  const scale = resolveMirrorScale({ realCapitalKrw: 0, virtualSeedCapital: 0 });
  const sheet = buildMirrorOrderSheet({
    entries: [
      buildSellMirrorOrder({
        kind: "take-profit-partial",
        code: "000660",
        name: "SK하이닉스",
        quantity: 2,
        limitPrice: 210_000,
        remainQuantity: 3,
        pnlPct: 9.1,
      }),
    ],
    scale,
  });

  assert.ok(sheet);
  const text = sheet as string;
  assert.ok(text.includes("SK하이닉스(000660) · 부분익절"));
  assert.ok(text.includes("잔여 3주 보유 유지"));
  assert.ok(text.includes("실투자금 미설정"));
});

test("buildMirrorOrderSheet: 섀도우 모드 라벨을 붙인다", () => {
  const scale = resolveMirrorScale({ realCapitalKrw: 0, virtualSeedCapital: 0 });
  const sheet = buildMirrorOrderSheet({
    entries: [
      buildBuyMirrorOrder({
        kind: "new-buy",
        code: "005930",
        quantity: 1,
        limitPrice: 71_200,
        stopLossPct: 4,
        takeProfitPct: 8,
      }),
    ],
    scale,
    isShadow: true,
  });

  assert.ok(sheet);
  const text = sheet as string;
  assert.ok(text.startsWith("[섀도우] [MTS 따라하기 주문서]"));
  assert.ok(text.includes("섀도우 모드"));
});

test("buildMirrorOrderSheet: 수량 0 또는 가격 0 항목은 제외한다", () => {
  const scale = resolveMirrorScale({ realCapitalKrw: 0, virtualSeedCapital: 0 });
  const sheet = buildMirrorOrderSheet({
    entries: [
      buildSellMirrorOrder({ kind: "stop-loss", code: "035720", quantity: 0, limitPrice: 55_000 }),
      buildSellMirrorOrder({ kind: "stop-loss", code: "005930", quantity: 3, limitPrice: 0 }),
    ],
    scale,
  });
  assert.equal(sheet, null);
});
