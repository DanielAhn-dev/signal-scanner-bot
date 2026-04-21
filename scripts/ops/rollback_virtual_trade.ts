import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../../src/db/portfolioSchema";
import { parseStrategyMemo } from "../../src/lib/strategyMemo";
import { syncVirtualPortfolio } from "../../src/services/portfolioService";
import { getUserInvestmentPrefs, setUserInvestmentPrefs } from "../../src/services/userService";

type TradeSide = "BUY" | "SELL" | "ADJUST";

type CliArgs = {
  chatId: number;
  code?: string;
  query?: string;
  buyTradeId?: number;
  sellTradeId?: number;
  apply: boolean;
};

type TradeRow = {
  id: number;
  chat_id: number;
  code: string;
  side: TradeSide;
  price: number;
  quantity: number;
  gross_amount: number;
  net_amount: number;
  fee_amount: number;
  tax_amount: number;
  pnl_amount: number;
  memo: string | null;
  traded_at: string;
};

type StockRow = {
  code: string;
  name: string;
};

type PositionRow = {
  id: number;
  code: string;
  quantity: number | null;
  buy_price: number | null;
  invested_amount: number | null;
  status: string | null;
  memo?: string | null;
};

type UserRow = {
  tg_id: number;
  prefs: Record<string, unknown> | null;
};

type LotRow = {
  id: number;
  chat_id: number;
  code: string;
  source_trade_id: number | null;
  acquired_price: number;
  acquired_quantity: number;
  remaining_quantity: number;
  acquired_at: string;
  closed_at: string | null;
};

type LotMatchRow = {
  id: number;
  trade_id: number;
  lot_id: number;
  quantity: number;
  unit_cost: number;
  cost_amount: number;
  pnl_amount: number;
};

type DecisionLogRow = {
  id: number;
  linked_trade_id: number | null;
  action: string | null;
  decision_at: string;
};

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function fmtWon(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toLocaleString("ko-KR")}원`;
}

function parseArgs(argv: string[]): CliArgs {
  let chatId = 0;
  let code: string | undefined;
  let query: string | undefined;
  let buyTradeId: number | undefined;
  let sellTradeId: number | undefined;
  let apply = false;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const key = argv[idx];
    const next = argv[idx + 1];
    if (key === "--chatId" && next) {
      chatId = Math.floor(toNumber(next, 0));
      idx += 1;
      continue;
    }
    if (key === "--code" && next) {
      code = String(next).trim();
      idx += 1;
      continue;
    }
    if (key === "--query" && next) {
      query = String(next).trim();
      idx += 1;
      continue;
    }
    if (key === "--buyTradeId" && next) {
      const value = Math.floor(toNumber(next, 0));
      if (value > 0) buyTradeId = value;
      idx += 1;
      continue;
    }
    if (key === "--sellTradeId" && next) {
      const value = Math.floor(toNumber(next, 0));
      if (value > 0) sellTradeId = value;
      idx += 1;
      continue;
    }
    if (key === "--apply") {
      apply = true;
    }
  }

  if (chatId <= 0) {
    throw new Error("--chatId 는 필수입니다.");
  }

  return { chatId, code, query, buyTradeId, sellTradeId, apply };
}

function printUsage(chatId: number): void {
  console.log("사용법:");
  console.log(`  pnpm ops:rollback-trade -- --chatId ${chatId} --query OCI홀딩스`);
  console.log(`  pnpm ops:rollback-trade -- --chatId ${chatId} --code 456040`);
  console.log(`  pnpm ops:rollback-trade -- --chatId ${chatId} --code 456040 --buyTradeId 123 --sellTradeId 124`);
  console.log(`  pnpm ops:rollback-trade -- --chatId ${chatId} --code 456040 --buyTradeId 123 --sellTradeId 124 --apply`);
}

function summarizeSellStats(rows: TradeRow[]): {
  sellCount: number;
  winCount: number;
  loseCount: number;
  winRate: number;
  realizedPnl: number;
} {
  const sells = rows.filter((row) => row.side === "SELL");
  const sellCount = sells.length;
  const winCount = sells.filter((row) => row.pnl_amount > 0).length;
  const loseCount = sells.filter((row) => row.pnl_amount < 0).length;
  const realizedPnl = sells.reduce((sum, row) => sum + row.pnl_amount, 0);
  const winRate = sellCount > 0 ? (winCount / sellCount) * 100 : 0;
  return { sellCount, winCount, loseCount, winRate, realizedPnl };
}

function isAutoTradeMemo(memo?: string | null): boolean {
  const parsed = parseStrategyMemo(memo);
  return parsed.strategyId === "core.autotrade.v1" || parsed.raw.startsWith("autotrade-");
}

function printTradeRow(row: TradeRow, stockName?: string | null): void {
  const parsed = parseStrategyMemo(row.memo);
  const autoTag = isAutoTradeMemo(row.memo) ? "AUTO" : "MANUAL";
  const pnlText = row.side === "SELL" ? ` | pnl ${fmtWon(row.pnl_amount)}` : "";
  console.log(
    [
      `${row.id}`,
      row.side,
      stockName ? `${stockName}(${row.code})` : row.code,
      `${row.quantity}주`,
      `${Math.round(row.price).toLocaleString("ko-KR")}원`,
      row.traded_at,
      autoTag,
      `${parsed.strategyId}/${parsed.event}`,
      pnlText,
    ].join(" | ")
  );
}

async function resolveStock(supabase: any, args: CliArgs): Promise<StockRow> {
  if (args.code) {
    const { data, error } = await supabase
      .from("stocks")
      .select("code, name")
      .eq("code", args.code)
      .maybeSingle();
    if (error) throw new Error(`stocks 코드 조회 실패: ${error.message}`);
    if (!data) throw new Error(`종목코드 ${args.code} 를 찾지 못했습니다.`);
    return { code: String((data as any).code), name: String((data as any).name ?? args.code) };
  }

  const query = String(args.query ?? "").trim();
  const { data, error } = await supabase
    .from("stocks")
    .select("code, name")
    .ilike("name", query)
    .limit(5);

  if (error) throw new Error(`stocks 이름 조회 실패: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) {
    const fallback = await supabase
      .from("stocks")
      .select("code, name")
      .ilike("name", `%${query}%`)
      .limit(5);
    if (fallback.error) throw new Error(`stocks 이름 조회 실패: ${fallback.error.message}`);
    const fallbackRows = (fallback.data ?? []) as Array<Record<string, unknown>>;
    if (!fallbackRows.length) throw new Error(`종목명 ${query} 을 찾지 못했습니다.`);
    if (fallbackRows.length > 1) {
      throw new Error(`종목명 ${query} 후보가 여러 개입니다: ${fallbackRows.map((row) => `${row.name}(${row.code})`).join(", ")}`);
    }
    return { code: String(fallbackRows[0].code), name: String(fallbackRows[0].name) };
  }
  if (rows.length > 1) {
    throw new Error(`종목명 ${query} 후보가 여러 개입니다: ${rows.map((row) => `${row.name}(${row.code})`).join(", ")}`);
  }
  return { code: String(rows[0].code), name: String(rows[0].name) };
}

async function printRecentAutoTradeCandidates(supabase: any, chatId: number): Promise<void> {
  const { data, error } = await supabase
    .from(PORTFOLIO_TABLES.trades)
    .select("code, traded_at, memo, stock:stocks(name)")
    .eq("chat_id", chatId)
    .order("traded_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`최근 자동사이클 후보 조회 실패: ${error.message}`);
  }

  const autoRows = ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => isAutoTradeMemo(typeof row.memo === "string" ? row.memo : null));

  if (!autoRows.length) {
    console.log(`chat_id=${chatId} 에 자동사이클 거래가 없습니다.`);
    printUsage(chatId);
    return;
  }

  const seen = new Set<string>();
  const candidates: Array<{ code: string; name: string; tradedAt: string }> = [];
  for (const row of autoRows) {
    const code = String(row.code ?? "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const stock = Array.isArray(row.stock) ? row.stock[0] : row.stock;
    candidates.push({
      code,
      name: String((stock as Record<string, unknown> | null)?.name ?? code),
      tradedAt: String(row.traded_at ?? ""),
    });
    if (candidates.length >= 10) break;
  }

  console.log(`chat_id=${chatId} 최근 자동사이클 종목 후보:`);
  for (const candidate of candidates) {
    console.log(`  - ${candidate.name}(${candidate.code}) | 최근 거래 ${candidate.tradedAt}`);
  }
  console.log("");
  printUsage(chatId);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  }

  const args = parseArgs(process.argv.slice(2));
  const supabase = createClient(url, key);
  if (!args.code && !args.query) {
    await printRecentAutoTradeCandidates(supabase, args.chatId);
    return;
  }
  const stock = await resolveStock(supabase, args);

  const [{ data: tradesRaw, error: tradesError }, { data: userRaw, error: userError }, { data: positionsRaw, error: positionsError }] = await Promise.all([
    supabase
      .from(PORTFOLIO_TABLES.trades)
      .select("id, chat_id, code, side, price, quantity, gross_amount, net_amount, fee_amount, tax_amount, pnl_amount, memo, traded_at")
      .eq("chat_id", args.chatId)
      .eq("code", stock.code)
      .order("traded_at", { ascending: true }),
    supabase
      .from("users")
      .select("tg_id, prefs")
      .eq("tg_id", args.chatId)
      .maybeSingle(),
    supabase
      .from(PORTFOLIO_TABLES.positionsLegacy)
      .select("id, code, quantity, buy_price, invested_amount, status, memo")
      .eq("chat_id", args.chatId)
      .eq("code", stock.code),
  ]);

  if (tradesError) throw new Error(`virtual_trades 조회 실패: ${tradesError.message}`);
  if (userError) throw new Error(`users 조회 실패: ${userError.message}`);
  if (positionsError) throw new Error(`watchlist 조회 실패: ${positionsError.message}`);

  const trades = ((tradesRaw ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    chat_id: Number(row.chat_id),
    code: String(row.code),
    side: String(row.side).toUpperCase() as TradeSide,
    price: toNumber(row.price),
    quantity: Math.floor(toNumber(row.quantity)),
    gross_amount: toNumber(row.gross_amount),
    net_amount: toNumber(row.net_amount),
    fee_amount: toNumber(row.fee_amount),
    tax_amount: toNumber(row.tax_amount),
    pnl_amount: toNumber(row.pnl_amount),
    memo: typeof row.memo === "string" ? row.memo : null,
    traded_at: String(row.traded_at),
  })) as TradeRow[];
  const user = (userRaw as UserRow | null) ?? null;
  const positions = ((positionsRaw ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    quantity: Number(row.quantity ?? 0),
    buy_price: row.buy_price == null ? null : Number(row.buy_price),
    invested_amount: row.invested_amount == null ? null : Number(row.invested_amount),
    status: row.status == null ? null : String(row.status),
    memo: typeof row.memo === "string" ? row.memo : null,
  })) as PositionRow[];

  if (!trades.length) {
    console.log(`거래가 없습니다: ${stock.name}(${stock.code})`);
    return;
  }

  const autoTrades = trades.filter((row) => isAutoTradeMemo(row.memo));
  console.log(`=== ${stock.name}(${stock.code}) 거래 조회 ===`);
  console.log(`chat_id=${args.chatId} | 전체 ${trades.length}건 | 자동사이클 ${autoTrades.length}건`);
  for (const row of trades) {
    printTradeRow(row, stock.name);
  }

  if (!args.buyTradeId || !args.sellTradeId) {
    const latestAutoSell = [...autoTrades].reverse().find((row) => row.side === "SELL") ?? null;
    const recommendedBuy = latestAutoSell
      ? [...autoTrades]
          .filter((row) => row.side === "BUY" && row.traded_at <= latestAutoSell.traded_at)
          .pop() ?? null
      : null;

    console.log("");
    console.log("선택된 trade id 가 없습니다. 먼저 드라이런 대상을 확정하세요.");
    if (recommendedBuy && latestAutoSell) {
      console.log(`추천 페어: buyTradeId=${recommendedBuy.id}, sellTradeId=${latestAutoSell.id}`);
      console.log(`드라이런: pnpm ops:rollback-trade -- --chatId ${args.chatId} --code ${stock.code} --buyTradeId ${recommendedBuy.id} --sellTradeId ${latestAutoSell.id}`);
      console.log(`실제적용: pnpm ops:rollback-trade -- --chatId ${args.chatId} --code ${stock.code} --buyTradeId ${recommendedBuy.id} --sellTradeId ${latestAutoSell.id} --apply`);
    }
    return;
  }

  const buyTrade = trades.find((row) => row.id === args.buyTradeId) ?? null;
  const sellTrade = trades.find((row) => row.id === args.sellTradeId) ?? null;
  if (!buyTrade || buyTrade.side !== "BUY") {
    throw new Error(`BUY 거래 ${args.buyTradeId} 를 찾지 못했습니다.`);
  }
  if (!sellTrade || sellTrade.side !== "SELL") {
    throw new Error(`SELL 거래 ${args.sellTradeId} 를 찾지 못했습니다.`);
  }
  if (buyTrade.traded_at > sellTrade.traded_at) {
    throw new Error("BUY 거래가 SELL 거래보다 뒤에 있습니다. trade id 선택을 다시 확인하세요.");
  }

  const openPositions = positions.filter((row) => (row.status ?? "holding") === "holding" && toNumber(row.quantity, 0) > 0 && toNumber(row.buy_price, 0) > 0);
  if (openPositions.length > 0) {
    throw new Error(`현재 ${stock.name} 보유 포지션이 남아 있어 매매전 롤백을 자동 적용할 수 없습니다. 현재 보유: ${openPositions.map((row) => `${row.id}/${row.quantity}주`).join(", ")}`);
  }

  const { data: lotMatchesRaw, error: lotMatchesError } = await supabase
    .from(PORTFOLIO_TABLES.lotMatches)
    .select("id, trade_id, lot_id, quantity, unit_cost, cost_amount, pnl_amount")
    .eq("trade_id", sellTrade.id);
  if (lotMatchesError) throw new Error(`lot match 조회 실패: ${lotMatchesError.message}`);

  const lotMatches = ((lotMatchesRaw ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    trade_id: Number(row.trade_id),
    lot_id: Number(row.lot_id),
    quantity: Math.floor(toNumber(row.quantity)),
    unit_cost: toNumber(row.unit_cost),
    cost_amount: toNumber(row.cost_amount),
    pnl_amount: toNumber(row.pnl_amount),
  })) as LotMatchRow[];
  if (!lotMatches.length) {
    throw new Error(`SELL 거래 ${sellTrade.id} 에 연결된 FIFO lot match 가 없습니다.`);
  }

  const lotIds = Array.from(new Set(lotMatches.map((row) => row.lot_id)));
  const { data: lotsRaw, error: lotsError } = await supabase
    .from(PORTFOLIO_TABLES.lots)
    .select("id, chat_id, code, source_trade_id, acquired_price, acquired_quantity, remaining_quantity, acquired_at, closed_at")
    .in("id", lotIds);
  if (lotsError) throw new Error(`lot 조회 실패: ${lotsError.message}`);

  const lots = ((lotsRaw ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    chat_id: Number(row.chat_id),
    code: String(row.code),
    source_trade_id: row.source_trade_id == null ? null : Number(row.source_trade_id),
    acquired_price: toNumber(row.acquired_price),
    acquired_quantity: Math.floor(toNumber(row.acquired_quantity)),
    remaining_quantity: Math.floor(toNumber(row.remaining_quantity)),
    acquired_at: String(row.acquired_at),
    closed_at: row.closed_at == null ? null : String(row.closed_at),
  })) as LotRow[];

  const { data: otherMatchesRaw, error: otherMatchesError } = await supabase
    .from(PORTFOLIO_TABLES.lotMatches)
    .select("id, trade_id, lot_id")
    .in("lot_id", lotIds)
    .neq("trade_id", sellTrade.id);
  if (otherMatchesError) throw new Error(`추가 lot match 조회 실패: ${otherMatchesError.message}`);
  const otherMatches = (otherMatchesRaw ?? []) as Array<Record<string, unknown>>;
  if (otherMatches.length > 0) {
    throw new Error(`선택한 SELL 거래가 다른 매도와 lot 을 공유합니다. 안전 롤백 중단: ${otherMatches.map((row) => `${row.trade_id}/${row.lot_id}`).join(", ")}`);
  }

  const matchedQty = lotMatches.reduce((sum, row) => sum + row.quantity, 0);
  const weightedCost = lotMatches.reduce((sum, row) => sum + row.unit_cost * row.quantity, 0);
  const avgUnitCost = matchedQty > 0 ? weightedCost / matchedQty : 0;
  const buyPriceGap = Math.abs(avgUnitCost - buyTrade.price);

  if (matchedQty !== buyTrade.quantity) {
    throw new Error(`BUY ${buyTrade.id} 수량 ${buyTrade.quantity}주와 SELL match 수량 ${matchedQty}주가 다릅니다. 단일 매매전 롤백으로 보기 어려워 자동 적용을 중단합니다.`);
  }
  if (buyPriceGap > 1) {
    throw new Error(`BUY ${buyTrade.id} 단가 ${buyTrade.price}원과 lot 평균단가 ${avgUnitCost.toFixed(2)}원이 다릅니다. 자동 적용을 중단합니다.`);
  }

  const deletableLots = lots.filter((lot) => {
    const matched = lotMatches
      .filter((row) => row.lot_id === lot.id)
      .reduce((sum, row) => sum + row.quantity, 0);
    return lot.remaining_quantity + matched === lot.acquired_quantity;
  });
  if (deletableLots.length !== lots.length) {
    throw new Error("선택한 SELL 거래가 lot 을 부분 청산한 상태라 BUY+SELL 전체 롤백을 자동 적용할 수 없습니다.");
  }

  const tradeIds = [buyTrade.id, sellTrade.id];
  const { data: decisionLogsRaw, error: decisionLogsError } = await supabase
    .from(PORTFOLIO_TABLES.decisionLogs)
    .select("id, linked_trade_id, action, decision_at")
    .in("linked_trade_id", tradeIds);
  if (decisionLogsError) throw new Error(`decision log 조회 실패: ${decisionLogsError.message}`);
  const decisionLogs = ((decisionLogsRaw ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    linked_trade_id: row.linked_trade_id == null ? null : Number(row.linked_trade_id),
    action: row.action == null ? null : String(row.action),
    decision_at: String(row.decision_at),
  })) as DecisionLogRow[];

  const prefs = await getUserInvestmentPrefs(args.chatId);
  const currentRealized = toNumber((user?.prefs ?? {}).virtual_realized_pnl ?? prefs.virtual_realized_pnl, 0);
  const currentStats = summarizeSellStats(trades);
  const nextTrades = trades.filter((row) => !tradeIds.includes(row.id));
  const nextStats = summarizeSellStats(nextTrades);
  const nextRealized = currentRealized - sellTrade.pnl_amount;

  console.log("");
  console.log("=== 롤백 미리보기 ===");
  console.log(`대상 BUY ${buyTrade.id} / SELL ${sellTrade.id}`);
  console.log(`삭제 거래수: 2건 | 삭제 decision log: ${decisionLogs.length}건 | 삭제 lot: ${deletableLots.length}건 | 삭제 lot match: ${lotMatches.length}건`);
  console.log(`누적 실현손익: ${fmtWon(currentRealized)} -> ${fmtWon(nextRealized)}`);
  console.log(`매도 건수: ${currentStats.sellCount} -> ${nextStats.sellCount}`);
  console.log(`승/패: ${currentStats.winCount}/${currentStats.loseCount} -> ${nextStats.winCount}/${nextStats.loseCount}`);
  console.log(`승률: ${currentStats.winRate.toFixed(1)}% -> ${nextStats.winRate.toFixed(1)}%`);
  console.log(`실현손익(FIFO): ${fmtWon(currentStats.realizedPnl)} -> ${fmtWon(nextStats.realizedPnl)}`);

  if (!args.apply) {
    console.log("");
    console.log("드라이런만 수행했습니다. 실제 반영하려면 동일 명령에 --apply 를 추가하세요.");
    return;
  }

  const nowIso = new Date().toISOString();
  for (const lot of deletableLots) {
    const matched = lotMatches
      .filter((row) => row.lot_id === lot.id)
      .reduce((sum, row) => sum + row.quantity, 0);
    const restoredQty = lot.remaining_quantity + matched;
    const { error } = await supabase
      .from(PORTFOLIO_TABLES.lots)
      .update({
        remaining_quantity: restoredQty,
        closed_at: null,
        updated_at: nowIso,
      })
      .eq("id", lot.id)
      .eq("chat_id", args.chatId)
      .eq("code", stock.code);
    if (error) throw new Error(`lot 복원 실패 (${lot.id}): ${error.message}`);
  }

  if (decisionLogs.length > 0) {
    const { error } = await supabase
      .from(PORTFOLIO_TABLES.decisionLogs)
      .delete()
      .in("id", decisionLogs.map((row) => row.id));
    if (error) throw new Error(`decision log 삭제 실패: ${error.message}`);
  }

  const { error: matchDeleteError } = await supabase
    .from(PORTFOLIO_TABLES.lotMatches)
    .delete()
    .eq("trade_id", sellTrade.id);
  if (matchDeleteError) throw new Error(`lot match 삭제 실패: ${matchDeleteError.message}`);

  const { error: sellDeleteError } = await supabase
    .from(PORTFOLIO_TABLES.trades)
    .delete()
    .eq("id", sellTrade.id)
    .eq("chat_id", args.chatId);
  if (sellDeleteError) throw new Error(`SELL 거래 삭제 실패: ${sellDeleteError.message}`);

  const { error: buyDeleteError } = await supabase
    .from(PORTFOLIO_TABLES.trades)
    .delete()
    .eq("id", buyTrade.id)
    .eq("chat_id", args.chatId);
  if (buyDeleteError) throw new Error(`BUY 거래 삭제 실패: ${buyDeleteError.message}`);

  const { error: lotDeleteError } = await supabase
    .from(PORTFOLIO_TABLES.lots)
    .delete()
    .in("id", deletableLots.map((row) => row.id));
  if (lotDeleteError) throw new Error(`lot 삭제 실패: ${lotDeleteError.message}`);

  await setUserInvestmentPrefs(args.chatId, {
    virtual_realized_pnl: nextRealized,
  });
  await syncVirtualPortfolio(args.chatId, args.chatId);

  console.log("");
  console.log("=== 롤백 완료 ===");
  console.log(`${stock.name}(${stock.code}) BUY ${buyTrade.id} / SELL ${sellTrade.id} 를 제거했습니다.`);
  console.log(`누적 실현손익 보정: ${fmtWon(currentRealized)} -> ${fmtWon(nextRealized)}`);
  console.log(`후속 확인: /거래기록, /보유, /리포트 포트폴리오`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});