/**
 * ETF·ETN 매도에 잘못 붙은 증권거래세를 되돌린다.
 *
 * 가상매매가 모든 매도에 0.18% 세금을 붙여 현금 스윕(KODEX CD금리액티브) 매도가 손실로 기록됐다.
 * 해당 매도의 세금을 0으로 바꾸고 net·pnl을 세금만큼 올린 뒤, 계정의 현금·실현손익에도 같은 금액을 더한다.
 *   pnpm ops:fix-etf-tax            # 미리보기
 *   pnpm ops:fix-etf-tax -- --apply # 백업 후 반영
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../../src/db/portfolioSchema";
import { isExchangeTradedProduct } from "../../src/lib/securitiesTax";

const APPLY = process.argv.includes("--apply");
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main(): Promise<void> {
  const { data: sells, error } = await supabase
    .from(PORTFOLIO_TABLES.trades)
    .select("*")
    .eq("side", "SELL")
    .gt("tax_amount", 0)
    .limit(10000);
  if (error) throw new Error(`virtual_trades 조회 실패: ${error.message}`);

  const codes = [...new Set((sells ?? []).map((t: any) => String(t.code)))];
  const { data: stocks } = await supabase.from("stocks").select("code, name").in("code", codes);
  const nameByCode = new Map((stocks ?? []).map((s: any) => [String(s.code), String(s.name ?? "")]));
  const targets = (sells ?? []).filter((t: any) => isExchangeTradedProduct(t.code, nameByCode.get(t.code)));

  if (!targets.length) {
    console.log("보정 대상 없음");
    return;
  }

  const refundByChat = new Map<number, number>();
  for (const t of targets as any[]) {
    const { data: matches } = await supabase.from(PORTFOLIO_TABLES.lotMatches).select("id").eq("trade_id", t.id);
    if ((matches ?? []).length) throw new Error(`#${t.id}에 로트 매칭이 있어 자동 보정 중단 (수동 확인 필요)`);
    const tax = Number(t.tax_amount);
    console.log(
      `#${t.id} [${t.chat_id}] ${t.traded_at.slice(0, 10)} ${nameByCode.get(t.code) ?? t.code} ${t.quantity}주 · 세금 ${tax} → 0 · 손익 ${t.pnl_amount} → ${Number(t.pnl_amount) + tax}`
    );
    refundByChat.set(Number(t.chat_id), (refundByChat.get(Number(t.chat_id)) ?? 0) + tax);
  }

  const prefsByChat = new Map<number, Record<string, unknown>>();
  for (const [chatId, refund] of refundByChat) {
    const { data: user } = await supabase.from("users").select("prefs").eq("tg_id", chatId).maybeSingle();
    const prefs = ((user?.prefs ?? {}) as Record<string, unknown>) ?? {};
    prefsByChat.set(chatId, prefs);
    console.log(
      `[${chatId}] 현금 ${prefs.virtual_cash} → ${Number(prefs.virtual_cash ?? 0) + refund} · 실현손익 ${prefs.virtual_realized_pnl} → ${Number(prefs.virtual_realized_pnl ?? 0) + refund}`
    );
  }

  if (!APPLY) {
    console.log("미리보기 끝 — 반영하려면 --apply");
    return;
  }

  const dir = join("scripts", "ops", "_backups", `etf-tax-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "trades.json"), JSON.stringify(targets, null, 1));
  writeFileSync(join(dir, "prefs.json"), JSON.stringify(Object.fromEntries(prefsByChat), null, 1));

  for (const t of targets as any[]) {
    const tax = Number(t.tax_amount);
    const upd = await supabase
      .from(PORTFOLIO_TABLES.trades)
      .update({ tax_amount: 0, net_amount: Number(t.net_amount) + tax, pnl_amount: Number(t.pnl_amount) + tax })
      .eq("id", t.id);
    if (upd.error) throw new Error(`#${t.id} 보정 실패: ${upd.error.message}`);
  }
  for (const [chatId, refund] of refundByChat) {
    const prefs = prefsByChat.get(chatId) ?? {};
    const upd = await supabase
      .from("users")
      .update({
        prefs: {
          ...prefs,
          virtual_cash: Math.round(Number(prefs.virtual_cash ?? 0) + refund),
          virtual_realized_pnl: Math.round(Number(prefs.virtual_realized_pnl ?? 0) + refund),
        },
      })
      .eq("tg_id", chatId);
    if (upd.error) throw new Error(`[${chatId}] 현금·손익 보정 실패: ${upd.error.message}`);
  }
  console.log(`완료 — 백업: ${dir}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
