import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

function parseArgs(argv: string[]): { chatId?: number; days: number } {
  let chatId: number | undefined;
  let days = 365;
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--chatId" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) chatId = n;
      i += 1;
    } else if (key === "--days" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) days = Math.floor(n);
      i += 1;
    }
  }
  return { chatId, days };
}

async function main() {
  const { chatId, days } = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");

  const supabase = createClient(url, key);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // 1) Stop-loss / take-profit executions (with holding-period join via position_id)
  let execQuery = supabase
    .from("stop_loss_take_profit_executions")
    .select("chat_id, code, execution_type, trigger_reason, execution_price, execution_pnl, executed_at, position_id")
    .gte("executed_at", since)
    .order("executed_at", { ascending: true })
    .limit(10000);
  if (chatId) execQuery = execQuery.eq("chat_id", chatId);
  const { data: execs, error: execErr } = await execQuery;
  if (execErr) throw new Error(`stop_loss_take_profit_executions query failed: ${execErr.message}`);

  const positionIds = [...new Set((execs ?? []).map((e: any) => e.position_id).filter(Boolean))];
  const buyDateByPosition = new Map<number, string>();
  if (positionIds.length) {
    const { data: positions, error: posErr } = await supabase
      .from("virtual_positions")
      .select("id, buy_date")
      .in("id", positionIds);
    if (posErr) throw new Error(`virtual_positions query failed: ${posErr.message}`);
    for (const p of positions ?? []) buyDateByPosition.set(p.id, p.buy_date);
  }

  console.log("=== 손절(STOP_LOSS) vs 익절(TAKE_PROFIT) 실행 통계 ===");
  console.log(`window: last ${days} days${chatId ? ` | chat_id=${chatId}` : ""}\n`);

  const byType = new Map<string, { count: number; pnl: number; holdDays: number[] }>();
  for (const e of execs ?? []) {
    const type = e.execution_type ?? "UNKNOWN";
    const bucket = byType.get(type) ?? { count: 0, pnl: 0, holdDays: [] };
    bucket.count += 1;
    bucket.pnl += Number(e.execution_pnl) || 0;
    const buyDate = buyDateByPosition.get(e.position_id);
    if (buyDate && e.executed_at) {
      const days = (new Date(e.executed_at).getTime() - new Date(buyDate).getTime()) / 86400000;
      if (Number.isFinite(days) && days >= 0) bucket.holdDays.push(days);
    }
    byType.set(type, bucket);
  }

  const totalExec = (execs ?? []).length;
  for (const [type, b] of byType.entries()) {
    const avgHold = b.holdDays.length ? b.holdDays.reduce((a, c) => a + c, 0) / b.holdDays.length : null;
    console.log(
      `${type}: ${b.count}건 (${totalExec ? ((b.count / totalExec) * 100).toFixed(1) : "0"}%) | 합계 PnL ${b.pnl >= 0 ? "+" : ""}${fmt(b.pnl)}원 | 평균보유 ${avgHold != null ? avgHold.toFixed(1) + "일" : "N/A"}`
    );
  }
  if (!totalExec) console.log("자동 손절/익절 실행 기록 없음");

  // trigger_reason breakdown
  const byReason = new Map<string, number>();
  for (const e of execs ?? []) {
    const r = e.trigger_reason ?? "unknown";
    byReason.set(r, (byReason.get(r) ?? 0) + 1);
  }
  if (byReason.size) {
    console.log("\n-- trigger_reason 분포 --");
    for (const [r, c] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${r}: ${c}건`);
    }
  }

  // 2) Overall SELL trades from virtual_trades (includes manual sells not via auto stop/tp)
  let tradeQuery = supabase
    .from("virtual_trades")
    .select("chat_id, side, pnl_amount, memo, traded_at")
    .eq("side", "SELL")
    .gte("traded_at", since)
    .order("traded_at", { ascending: true })
    .limit(10000);
  if (chatId) tradeQuery = tradeQuery.eq("chat_id", chatId);
  const { data: trades, error: tradeErr } = await tradeQuery;
  if (tradeErr) throw new Error(`virtual_trades query failed: ${tradeErr.message}`);

  const allSells = trades ?? [];
  const wins = allSells.filter((t: any) => Number(t.pnl_amount) > 0).length;
  const losses = allSells.filter((t: any) => Number(t.pnl_amount) < 0).length;
  const totalPnl = allSells.reduce((acc: number, t: any) => acc + (Number(t.pnl_amount) || 0), 0);

  console.log("\n=== 전체 SELL 거래 (virtual_trades, 수동+자동 모두 포함) ===");
  console.log(`총 매도 ${allSells.length}건 | 승 ${wins}건 | 패 ${losses}건 | 승률 ${allSells.length ? ((wins / allSells.length) * 100).toFixed(1) : "0"}%`);
  console.log(`실현손익 합계: ${totalPnl >= 0 ? "+" : ""}${fmt(totalPnl)}원`);

  // 3) Current portfolio snapshot (latest)
  let snapQuery = supabase
    .from("portfolio_snapshots")
    .select("chat_id, snapshot_date, total_invested, total_current_value, total_pnl, total_pnl_percent, position_count")
    .order("snapshot_date", { ascending: false })
    .limit(chatId ? 5 : 20);
  if (chatId) snapQuery = snapQuery.eq("chat_id", chatId);
  const { data: snaps } = await snapQuery;
  if (snaps && snaps.length) {
    console.log("\n=== 최근 포트폴리오 스냅샷 ===");
    for (const s of snaps) {
      console.log(
        `${s.snapshot_date} | chat=${s.chat_id} | 투자금 ${fmt(s.total_invested)}원 | 현재가치 ${fmt(s.total_current_value)}원 | PnL ${s.total_pnl >= 0 ? "+" : ""}${fmt(s.total_pnl)}원 (${Number(s.total_pnl_percent).toFixed(2)}%) | 포지션 ${s.position_count}개`
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
