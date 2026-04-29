// Use global fetch when available (Node 18+). Dynamically import node-fetch only as fallback at runtime.
import { buildInvestmentPlan } from "../src/lib/investPlan";
import { scaleScoreFactorsToReferencePrice } from "../src/lib/priceScale";
import { calculateAutoTradeBuySizing } from "../src/services/virtualAutoTradeSizing";
import { esc, fmtInt, fmtPct, LINE } from "../src/bot/messages/format";
import { buildMessage } from "../src/bot/messages/layout";
import type { ChatContext } from "../src/bot/router";

async function tgSend(method: string, params: Record<string, any>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('tgSend (dry):', method, params);
    return { ok: true };
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const _fetch = (globalThis as any).fetch
    ? (globalThis as any).fetch
    : (
        // @ts-ignore: dynamic import fallback for environments without global fetch
        (await import('node-fetch')).default
      );
  const res = await _fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

function simulateAndPrint() {
  const prefs = { risk_profile: "balanced", virtual_seed_capital: 5000000, virtual_cash: 5000000, capital_krw: 5000000 };
  const availableCash = prefs.virtual_cash;
  const mockCandidates = [
    { code: "005930", name: "삼성전자", close: 68000, score: 82.3, rsi14: 45 },
    { code: "000660", name: "SK하이닉스", close: 182000, score: 78.5, rsi14: 52 },
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
    const plan = buildInvestmentPlan({ currentPrice: c.close, factors, technicalScore: c.score, variantSeed: `sim:${c.code}`, marketEnv } as any);
    const orderPrice = Math.round(c.close);
    const sizing = calculateAutoTradeBuySizing({ availableCash, price: orderPrice, slotsLeft: 2, currentHoldingCount: 0, maxPositions: 8, stopLossPct: Math.abs(plan.stopPct * 100), prefs } as any);
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

async function main() {
  const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const chatIdEnv = process.env.TARGET_CHAT_ID;
  const chatId = chatIdEnv ? Number(chatIdEnv) : 0;

  if (!hasSupabase) {
    console.log('SUPABASE env missing — running dry simulation instead of invoking handler.');
    simulateAndPrint();
    return;
  }

  const ctx: ChatContext = { chatId, from: { id: chatId }, message: { text: '/오늘계획' } as any } as any;

  try {
    const mod = await import('../src/bot/commands/preMarketPlan.js');
    const handler = mod.handlePreMarketPlanCommand;
    await handler("", ctx, tgSend);
    console.log('handlePreMarketPlanCommand completed.');
  } catch (e) {
    console.error('Error running handler:', e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
