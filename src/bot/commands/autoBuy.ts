import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { fetchRealtimeStockData } from "../../utils/fetchRealtimePrice";
import { buildInvestmentPlan } from "../../lib/investPlan";
import { calculateAutoTradeBuySizing } from "../../services/virtualAutoTradeSizing";
import { fmtKRW } from "../../lib/normalize";
import { fmtInt, LINE } from "../messages/format";
import { actionButtons } from "../messages/layout";
import { positionSizeByVolatility, fractionalKelly } from "../../risk";

export async function handleAutoBuyCommand(code: string, ctx: ChatContext, tgSend: any) {
  if (!code) return tgSend("sendMessage", { chat_id: ctx.chatId, text: "종목 코드가 없습니다." });
  // create supabase client lazily to avoid top-level errors when env not set in local tests
  let supabase: any = null;
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    }
  } catch (e) {
    supabase = null;
  }

  // 1) 기본 데이터
  let stock: any = null;
  if (supabase) {
    const q = await supabase.from("stocks").select("code,name,close").eq("code", code).limit(1).single().catch(() => null);
    stock = q?.data ?? q;
  }
  if (!stock) {
    // fallback minimal stock info when DB not available
    stock = { code, name: code, close: 0 };
  }
  if (!stock) return tgSend("sendMessage", { chat_id: ctx.chatId, text: "종목을 찾을 수 없습니다." });

  const realtime = await fetchRealtimeStockData(code).catch(() => ({} as any));
  const price = realtime?.price ?? stock.close ?? 0;

  // 2) 간단한 투자 계획(기존 함수 재사용)
  const series = []; // placeholder - investPlan can handle missing series
  const plan = buildInvestmentPlan({ currentPrice: price, factors: {}, technicalScore: undefined, variantSeed: code });

  // 3) sizing: use user prefs if available
  const { data: prefs } = await supabase.from("users").select("id,capital_krw,split_count,virtual_seed_capital").eq("id", ctx.from?.id ?? ctx.chatId).limit(1).single();
  const capital = (prefs?.virtual_seed_capital ?? prefs?.capital_krw ?? 0) as number;

  // volatility-based sizing using plan.stopPct
  const stopPct = Math.abs(plan.stopPct) || 0.05;
  const sizing = positionSizeByVolatility({ accountBalance: capital || 100000, targetRiskPct: 0.01, price, stopLossPct: stopPct, volMultiplier: 2 });

  // Kelly suggestion (placeholder winprob/winloss)
  const kelly = fractionalKelly(0.55, 1.5, 0.5);

  const lines = [
    `<b>권장 매수 — ${stock.name} (${stock.code})</b>`,
    LINE,
    `현재가: <code>${fmtInt(price)}원</code>`,
    `권장 손절: <code>${fmtInt(plan.stopPrice)}</code> (${(stopPct * 100).toFixed(2)}%)`,
    `권장 리스크(계정 기준): <code>1% (기본)</code>`,
    `권장 매수량: <code>${sizing.shares}주</code> / 약 <code>${fmtKRW(Math.round(sizing.positionValue || 0))}원</code>`,
    `Kelly(분수) 제안: ${(kelly * 100).toFixed(2)}%`,
  ];

  const text = lines.join("\n");

  // Build callback for exec with encoded sizing
  const execCallback = `autobuy_exec:${code}:${sizing.shares}:${Math.floor(price)}`;
  const kb = actionButtons([
    { text: "가상매수 추가", callback_data: `watchadd:${code}` },
    { text: "실거래 실행", callback_data: execCallback },
    { text: "종목분석", callback_data: `trade:${code}` },
  ], 2);

  await tgSend("sendMessage", { chat_id: ctx.chatId, text, parse_mode: "HTML", reply_markup: kb });
}

export default { handleAutoBuyCommand };
