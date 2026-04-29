import { buildInvestmentPlan } from "../src/lib/investPlan";
import { scaleScoreFactorsToReferencePrice } from "../src/lib/priceScale";
import { calculateAutoTradeBuySizing } from "../src/services/virtualAutoTradeSizing";
import { esc, fmtInt, fmtPct, LINE } from "../src/bot/messages/format";
import { buildMessage, header, section } from "../src/bot/messages/layout";

function toNum(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

async function main() {
  const prefs = { risk_profile: "balanced", virtual_seed_capital: 5000000, virtual_cash: 5000000, capital_krw: 5000000 };
  const availableCash = prefs.virtual_cash;

  const mockCandidates = [
    { code: "005930", name: "삼성전자", close: 68000, score: 82.3, rsi14: 45, liquidity: 90000000 },
    { code: "000660", name: "SK하이닉스", close: 182000, score: 78.5, rsi14: 52, liquidity: 45000000 },
  ];

  const marketEnv = { vix: 18.3, fearGreed: 52, usdkrw: 1388 };

  const summaryLines: string[] = [
    `<b>장전 주문 플랜 (모의)</b>`,
    LINE,
    `투자성향 <code>${prefs.risk_profile}</code> · 가용현금 <code>${fmtInt(availableCash)}원</code>`,
  ];

  const blocks: string[] = [];
  let rank = 1;
  for (const c of mockCandidates) {
    const factors = scaleScoreFactorsToReferencePrice(
      {
        sma20: c.close,
        sma50: c.close,
        sma200: c.close,
        rsi14: c.rsi14,
        atr14: 0,
        atr_pct: 1.5,
        vol_ratio: 1,
      },
      c.close,
      c.close
    );

    const plan = buildInvestmentPlan({
      currentPrice: c.close,
      factors,
      technicalScore: c.score,
      variantSeed: `sim:${c.code}`,
      marketEnv,
    } as any);

    const orderPrice = Math.round(c.close);
    const sizing = calculateAutoTradeBuySizing({
      availableCash,
      price: orderPrice,
      slotsLeft: 2,
      currentHoldingCount: 0,
      maxPositions: 8,
      stopLossPct: Math.abs(plan.stopPct * 100),
      prefs,
    } as any);

    const qty = sizing.quantity || Math.max(1, Math.floor((availableCash / 2) / orderPrice));
    const invested = qty * orderPrice;

    const orderLines = [
      `<b>${rank}. ${esc(String(c.name))}</b> <code>${c.code}</code>`,
      `- 판단 ${plan.status} · 점수 <code>${c.score.toFixed(1)}</code> · 손익비 <code>${plan.riskReward?.toFixed(1) ?? "-"}:1</code>`,
      `- 매수주문 <code>${qty}주 x ${fmtInt(orderPrice)}원</code> = <code>${fmtInt(invested)}원</code>`,
      `- 진입구간 <code>${fmtInt(plan.entryLow)}원</code> ~ <code>${fmtInt(plan.entryHigh)}원</code>`,
      `- 손절 <code>${fmtInt(plan.stopPrice)}원</code> (${fmtPct(-plan.stopPct * 100)})`,
    ];

    blocks.push(orderLines.join("\n"));
    rank += 1;
  }

  const msg = buildMessage([...summaryLines, ...blocks, "", "권장: 자동 점검 또는 수동 확인 후 주문하세요."]);
  console.log(msg);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
