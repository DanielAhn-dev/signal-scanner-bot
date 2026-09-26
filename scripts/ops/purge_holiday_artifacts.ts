/**
 * KRX 휴장일에 잘못 생성된 데이터·가상매매를 정리한다.
 *
 * 2026-09 이전엔 장 판단이 주말만 걸렀고 일부 배치가 "오늘" 날짜로 폴백해서
 *   1) pullback_signals / scores / scan_signal_history에 휴장일 날짜 행이 복제 저장됐고
 *   2) 추석(2026-09-24)에 자동매매가 전일 종가로 매수(+매수 자금용 현금 스윕 매도)를 체결했다.
 *
 * 기본은 미리보기(드라이런). --apply를 주면 백업 JSON을 scripts/ops/_backups/에 쓴 뒤 반영한다.
 *   pnpm ops:purge-holiday            # 미리보기
 *   pnpm ops:purge-holiday -- --apply # 백업 후 반영
 *
 * 가상매매 되돌리기는 안전한 형태만 처리하고, 아니면 중단한다.
 *   - BUY: 그 매수로 새로 생긴 포지션(수량·매수일 일치)이고 이후 같은 종목 거래가 없을 때 → 포지션·로트·결정로그 삭제
 *   - 현금 스윕 SELL(lot match 없음): 스윕 포지션 수량·투자금 복원, 실현손익에서 제외
 *   현금은 두 거래가 바꾼 만큼만 되돌린다(전체 재계산 syncVirtualPortfolio는 쓰지 않음).
 *
 * 3) 원장 보정: 시드 재계산 이력이 없는 계정은 실현손익 = 거래기록 매도손익 합, 현금 = 시드 + 실현손익 − 보유 투자금
 *    으로 맞춘다. 예전 실현손익 갱신 방식(실행 시작 값 + 누적분 덮어쓰기)이 2026-09-22에 −85,372원을
 *    이중 반영하고 09-24에 스윕 손익 −2,007원을 누락해 현금이 83,365원 적게 잡혀 있었다.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../../src/db/portfolioSchema";
import { isKrxTradingDate, toKstDateKey } from "../../src/lib/krxCalendar";
import { parseStrategyMemo } from "../../src/lib/strategyMemo";

const APPLY = process.argv.includes("--apply");
const FROM_DATE = "2025-08-01";
const CASH_SWEEP_STRATEGY_ID = "cash-sweep.v1";

const DATA_TABLES: Array<{ table: string; column: string }> = [
  { table: "pullback_signals", column: "trade_date" },
  { table: "scores", column: "asof" },
  { table: "scan_signal_history", column: "trade_date" },
  { table: "daily_indicators", column: "trade_date" },
  { table: "investor_daily", column: "date" },
  { table: "stock_daily", column: "date" },
];

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const backupDir = join("scripts", "ops", "_backups", `holiday-purge-${new Date().toISOString().replace(/[:.]/g, "-")}`);

function backup(name: string, rows: unknown): void {
  if (!APPLY) return;
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(backupDir, `${name}.json`), JSON.stringify(rows, null, 1));
}

function nonTradingWeekdays(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${fromKey}T00:00:00Z`); t <= Date.parse(`${toKey}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 10);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !isKrxTradingDate(key)) out.push(key);
  }
  return out;
}

async function fetchAll(table: string, column: string, value: string): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select("*").eq(column, value).range(from, from + 999);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function purgeHolidayRows(): Promise<void> {
  const holidays = nonTradingWeekdays(FROM_DATE, toKstDateKey());
  console.log(`=== 1) 휴장일 날짜 데이터 (평일 휴장일 ${holidays.length}일 점검) ===`);
  for (const { table, column } of DATA_TABLES) {
    for (const date of holidays) {
      const rows = await fetchAll(table, column, date);
      if (!rows.length) continue;
      console.log(`  ${table} ${date}: ${rows.length}행`);
      if (!APPLY) continue;
      backup(`${table}_${date}`, rows);
      const { error } = await supabase.from(table).delete().eq(column, date);
      if (error) throw new Error(`${table} ${date} 삭제 실패: ${error.message}`);
    }
  }
}

async function revertHolidayTrades(): Promise<void> {
  console.log("=== 2) 휴장일 가상매매 ===");
  const { data: tradesRaw, error } = await supabase
    .from(PORTFOLIO_TABLES.trades)
    .select("*")
    .gte("traded_at", `${FROM_DATE}T00:00:00+09:00`)
    .order("traded_at", { ascending: true });
  if (error) throw new Error(`virtual_trades 조회 실패: ${error.message}`);
  const allTrades = (tradesRaw ?? []) as any[];
  // 자동매매(source=AUTO)만 대상. 수동 입력 거래는 사용자가 기록한 것이라 건드리지 않는다.
  const holidayTrades = allTrades.filter(
    (t) => t.source === "AUTO" && !isKrxTradingDate(toKstDateKey(new Date(t.traded_at)))
  );
  if (!holidayTrades.length) {
    console.log("  없음");
    return;
  }

  const byChat = new Map<number, any[]>();
  for (const t of holidayTrades) byChat.set(Number(t.chat_id), [...(byChat.get(Number(t.chat_id)) ?? []), t]);

  for (const [chatId, trades] of byChat) {
    let cashDelta = 0;
    let realizedDelta = 0;
    const ops: Array<() => Promise<void>> = [];
    const backupRows: Record<string, unknown[]> = { trades };

    for (const trade of trades) {
      const kstDate = toKstDateKey(new Date(trade.traded_at));
      const later = allTrades.filter(
        (t) => Number(t.chat_id) === chatId && t.code === trade.code && t.traded_at > trade.traded_at && t.id !== trade.id
      );
      const strategyId = parseStrategyMemo(trade.memo).strategyId;
      console.log(`  [${chatId}] #${trade.id} ${kstDate} ${trade.side} ${trade.code} ${trade.quantity}주 @${trade.price} (${strategyId})`);
      if (later.length) throw new Error(`#${trade.id} 이후 같은 종목 거래(${later.map((t) => t.id).join(",")})가 있어 자동 되돌리기 중단`);

      const { data: positions, error: posError } = await supabase
        .from(PORTFOLIO_TABLES.positions)
        .select("*")
        .eq("chat_id", chatId)
        .eq("code", trade.code);
      if (posError) throw new Error(`포지션 조회 실패: ${posError.message}`);
      backupRows[`positions_${trade.code}`] = positions ?? [];

      if (trade.side === "BUY") {
        const pos = (positions ?? []).find(
          (p: any) => String(p.buy_date ?? "").slice(0, 10) === kstDate && Number(p.quantity) === Number(trade.quantity)
        );
        if (!pos) throw new Error(`#${trade.id} 매수로 생긴 포지션(매수일 ${kstDate}, ${trade.quantity}주)을 찾지 못해 중단`);
        const [{ data: lots }, { data: logs }] = await Promise.all([
          supabase.from(PORTFOLIO_TABLES.lots).select("*").eq("chat_id", chatId).eq("position_id", pos.id),
          supabase.from(PORTFOLIO_TABLES.decisionLogs).select("*").eq("linked_trade_id", trade.id),
        ]);
        const lotIds = (lots ?? []).map((l: any) => l.id);
        if (lotIds.length) {
          const { data: matches } = await supabase.from(PORTFOLIO_TABLES.lotMatches).select("id").in("lot_id", lotIds);
          if ((matches ?? []).length) throw new Error(`#${trade.id} 로트에 매도 매칭이 있어 중단`);
        }
        backupRows[`lots_${trade.code}`] = lots ?? [];
        backupRows[`decision_logs_${trade.id}`] = logs ?? [];
        console.log(`      → 포지션 #${pos.id} · 로트 ${lotIds.length}건 · 결정로그 ${(logs ?? []).length}건 삭제, 현금 +${trade.net_amount}`);
        cashDelta += Number(trade.net_amount);
        ops.push(async () => {
          if ((logs ?? []).length) {
            const r = await supabase.from(PORTFOLIO_TABLES.decisionLogs).delete().in("id", (logs ?? []).map((l: any) => l.id));
            if (r.error) throw new Error(`결정로그 삭제 실패: ${r.error.message}`);
          }
          if (lotIds.length) {
            const r = await supabase.from(PORTFOLIO_TABLES.lots).delete().in("id", lotIds);
            if (r.error) throw new Error(`로트 삭제 실패: ${r.error.message}`);
          }
          const r = await supabase.from(PORTFOLIO_TABLES.positions).delete().eq("id", pos.id).eq("chat_id", chatId);
          if (r.error) throw new Error(`포지션 삭제 실패: ${r.error.message}`);
        });
      } else if (trade.side === "SELL" && strategyId === CASH_SWEEP_STRATEGY_ID) {
        const { data: matches } = await supabase.from(PORTFOLIO_TABLES.lotMatches).select("id").eq("trade_id", trade.id);
        if ((matches ?? []).length) throw new Error(`#${trade.id} 스윕 매도에 로트 매칭이 있어 중단`);
        const pos = (positions ?? []).find((p: any) => (p.status ?? "holding") === "holding");
        if (!pos) throw new Error(`#${trade.id} 스윕 포지션을 찾지 못해 중단`);
        const costBasis = Number(trade.net_amount) - Number(trade.pnl_amount);
        const nextQty = Number(pos.quantity) + Number(trade.quantity);
        const nextInvested = Math.round(Number(pos.invested_amount) + costBasis);
        console.log(`      → 스윕 포지션 #${pos.id} ${pos.quantity}→${nextQty}주, 투자금 ${pos.invested_amount}→${nextInvested}, 현금 -${trade.net_amount}, 실현손익 ${-Number(trade.pnl_amount) >= 0 ? "+" : ""}${-Number(trade.pnl_amount)}`);
        cashDelta -= Number(trade.net_amount);
        realizedDelta -= Number(trade.pnl_amount);
        ops.push(async () => {
          const r = await supabase
            .from(PORTFOLIO_TABLES.positions)
            .update({ quantity: nextQty, invested_amount: nextInvested, status: "holding" })
            .eq("id", pos.id)
            .eq("chat_id", chatId);
          if (r.error) throw new Error(`스윕 포지션 복원 실패: ${r.error.message}`);
        });
      } else {
        throw new Error(`#${trade.id} (${trade.side}/${strategyId})는 자동 되돌리기 대상이 아닙니다. 수동 확인 필요`);
      }
    }

    const { data: user, error: userError } = await supabase.from("users").select("prefs").eq("tg_id", chatId).maybeSingle();
    if (userError) throw new Error(`users 조회 실패: ${userError.message}`);
    const prefs = ((user?.prefs ?? {}) as Record<string, unknown>) ?? {};
    const cash = Number(prefs.virtual_cash ?? 0);
    const realized = Number(prefs.virtual_realized_pnl ?? 0);
    console.log(`  [${chatId}] 현금 ${cash} → ${Math.round(cash + cashDelta)} · 실현손익 ${realized} → ${Math.round(realized + realizedDelta)}`);
    if (!APPLY) continue;

    backup(`virtual_${chatId}`, { ...backupRows, prefs });
    for (const op of ops) await op();
    const del = await supabase.from(PORTFOLIO_TABLES.trades).delete().in("id", trades.map((t) => t.id)).eq("chat_id", chatId);
    if (del.error) throw new Error(`거래 삭제 실패: ${del.error.message}`);
    const upd = await supabase
      .from("users")
      .update({
        prefs: {
          ...prefs,
          virtual_cash: Math.round(cash + cashDelta),
          virtual_realized_pnl: Math.round(realized + realizedDelta),
        },
      })
      .eq("tg_id", chatId);
    if (upd.error) throw new Error(`현금·실현손익 반영 실패: ${upd.error.message}`);
  }
}

async function reconcileLedger(): Promise<void> {
  console.log("=== 3) 원장 보정 (실현손익·현금) ===");
  const { data: settings, error } = await supabase.from("virtual_autotrade_settings").select("chat_id");
  if (error) throw new Error(`virtual_autotrade_settings 조회 실패: ${error.message}`);
  for (const chatId of (settings ?? []).map((r: any) => Number(r.chat_id))) {
    const { data: user } = await supabase.from("users").select("prefs").eq("tg_id", chatId).maybeSingle();
    const prefs = ((user?.prefs ?? {}) as Record<string, unknown>) ?? {};
    const seed = Number(prefs.virtual_seed_capital ?? 0);
    if (!(seed > 0)) continue;
    if (prefs.virtual_last_seed_rebase_at) {
      console.log(`  [${chatId}] 시드 재계산 이력이 있어 거래기록 합으로 검산할 수 없음 — 건너뜀`);
      continue;
    }
    const [{ data: trades, error: tErr }, { data: positions, error: pErr }] = await Promise.all([
      supabase.from(PORTFOLIO_TABLES.trades).select("side, pnl_amount").eq("chat_id", chatId).limit(10000),
      supabase.from(PORTFOLIO_TABLES.positions).select("invested_amount, status").eq("chat_id", chatId),
    ]);
    if (tErr || pErr) throw new Error(`원장 조회 실패: ${tErr?.message ?? pErr?.message}`);
    const realized = Math.round((trades ?? []).filter((t: any) => t.side === "SELL").reduce((s: number, t: any) => s + Number(t.pnl_amount ?? 0), 0));
    const invested = Math.round((positions ?? []).filter((p: any) => (p.status ?? "holding") === "holding").reduce((s: number, p: any) => s + Number(p.invested_amount ?? 0), 0));
    const cash = Math.max(0, seed + realized - invested);
    const curRealized = Number(prefs.virtual_realized_pnl ?? 0);
    const curCash = Number(prefs.virtual_cash ?? 0);
    if (Math.abs(curRealized - realized) < 1 && Math.abs(curCash - cash) < 1) {
      console.log(`  [${chatId}] 일치 (현금 ${curCash}, 실현손익 ${curRealized})`);
      continue;
    }
    console.log(`  [${chatId}] 실현손익 ${curRealized} → ${realized} · 현금 ${curCash} → ${cash}${APPLY ? "" : " (2단계 되돌리기 반영 전 기준 — --apply 시 반영 후 값으로 다시 계산)"}`);
    if (!APPLY) continue;
    backup(`ledger_${chatId}`, { prefs });
    const upd = await supabase
      .from("users")
      .update({ prefs: { ...prefs, virtual_realized_pnl: realized, virtual_cash: cash } })
      .eq("tg_id", chatId);
    if (upd.error) throw new Error(`원장 보정 실패: ${upd.error.message}`);
  }
}

async function main(): Promise<void> {
  console.log(APPLY ? `[적용 모드] 백업: ${backupDir}` : "[미리보기] 반영하려면 --apply");
  await purgeHolidayRows();
  await revertHolidayTrades();
  await reconcileLedger();
  console.log(APPLY ? "완료" : "미리보기 끝 — 변경 없음");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
