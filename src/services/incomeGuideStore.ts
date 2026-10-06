/**
 * 리밸런싱 가이드 저장·조회 — 웹 경로(handlers/ui/income-guide.ts)와 월 자동 기록 배치(scripts/income_guide_monthly.ts)가 같이 쓴다.
 * 파일: market-snapshots/income-guide/{chatId}.json = { settings, history }
 * 계좌 보유 = virtual_positions 중 증권사·계좌명이 있는 행("계좌/보유 추가"로 입력). 봇 가상 계좌는 넣지 않는다.
 */
import { fetchRealtimePriceBatch, type RealtimeStockData } from "../utils/fetchRealtimePrice";
import {
  DEFAULT_INCOME_GUIDE_SETTINGS,
  sanitizeIncomeGuideSettings,
  type GuideHistoryEntry,
  type GuideHolding,
  type IncomeGuideSettings,
} from "../lib/incomeGuide";

const BUCKET = "market-snapshots";
const DIR = "income-guide";

export type GuideFile = { settings: IncomeGuideSettings; history: GuideHistoryEntry[] };

const pathOf = (chatId: string | number) => `${DIR}/${chatId}.json`;

export async function loadGuideFile(supabase: any, chatId: string | number): Promise<GuideFile | null> {
  // Storage CDN이 옛 내용을 돌려주지 않게 매번 캐시를 우회한다 (goalTracker와 같은 이유)
  const { data, error } = await supabase.storage.from(BUCKET).download(pathOf(chatId), { cacheNonce: String(Date.now()) });
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as { settings?: Partial<IncomeGuideSettings>; history?: GuideHistoryEntry[] };
    if (!parsed.settings) return null;
    return {
      settings: sanitizeIncomeGuideSettings(parsed.settings, DEFAULT_INCOME_GUIDE_SETTINGS),
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return null;
  }
}

export async function saveGuideFile(supabase: any, chatId: string | number, file: GuideFile): Promise<string | null> {
  const { error } = await supabase.storage.from(BUCKET).upload(pathOf(chatId), JSON.stringify(file), {
    upsert: true,
    contentType: "application/json",
    cacheControl: "0",
  });
  return error ? String(error.message) : null;
}

type PositionRow = {
  chat_id?: string | number;
  code: string;
  quantity: number;
  buy_price: number | null;
  status: string | null;
  broker_name: string | null;
  account_name: string | null;
  stock: { name?: string; close?: number } | Array<{ name?: string; close?: number }> | null;
};

/** 계좌 보유 행 — chatId를 주면 그 사용자만, 안 주면 계좌 보유가 있는 모든 사용자 */
export async function loadAccountPositionRows(supabase: any, chatId?: string | number): Promise<PositionRow[]> {
  let q = supabase
    .from("virtual_positions")
    .select("chat_id, code, quantity, buy_price, status, broker_name, account_name, stock:stocks(name, close)")
    .gt("quantity", 0)
    .or("broker_name.not.is.null,account_name.not.is.null");
  if (chatId != null) q = q.eq("chat_id", chatId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as PositionRow[]).filter((r) => String(r.status ?? "holding") !== "closed");
}

/** 종목 시세 — 실시간가(장 마감 뒤엔 종가) → stocks.close 순. ETF는 stocks.close가 비어 있는 경우가 많다 */
export async function fetchGuidePrices(supabase: any, codes: string[]): Promise<{ prices: Map<string, number>; names: Map<string, string>; realtimeHits: Set<string> }> {
  const unique = Array.from(new Set(codes.map((c) => String(c || "").trim()).filter(Boolean)));
  const prices = new Map<string, number>();
  const names = new Map<string, string>();
  const realtimeHits = new Set<string>();
  if (!unique.length) return { prices, names, realtimeHits };
  const realtime = await fetchRealtimePriceBatch(unique).catch(() => ({}) as Record<string, RealtimeStockData>);
  const { data } = await supabase.from("stocks").select("code, name, close").in("code", unique);
  const byCode = new Map(((data ?? []) as Array<{ code: string; name: string | null; close: number | null }>).map((s) => [String(s.code), s]));
  for (const code of unique) {
    const rt = Number(realtime[code]?.price);
    const close = Number(byCode.get(code)?.close);
    if (rt > 0) {
      prices.set(code, rt);
      realtimeHits.add(code);
    } else if (close > 0) prices.set(code, close);
    const name = byCode.get(code)?.name;
    if (name) names.set(code, String(name));
  }
  return { prices, names, realtimeHits };
}

/** 보유 행 → 가이드 보유. 시세가 없으면 매수가를 쓴다. priceFallbacks = 실시간가를 못 받은 행 수(화면 안내용) */
export function toGuideHoldings(
  rows: PositionRow[],
  prices: Map<string, number>,
  realtimeHits?: Set<string>,
): { holdings: GuideHolding[]; priceFallbacks: number } {
  let priceFallbacks = 0;
  const holdings = rows.map((r) => {
    const code = String(r.code || "").trim();
    const stock = Array.isArray(r.stock) ? r.stock[0] : r.stock;
    const buy = Number(r.buy_price);
    const live = prices.get(code) ?? 0;
    if (realtimeHits ? !realtimeHits.has(code) : !(live > 0)) priceFallbacks += 1;
    const broker = String(r.broker_name ?? "").trim();
    const account = String(r.account_name ?? "").trim();
    const label = [broker, account].filter(Boolean).join(" / ");
    return {
      code,
      name: String(stock?.name ?? code),
      quantity: Math.max(0, Math.floor(Number(r.quantity ?? 0))),
      price: live > 0 ? live : buy > 0 ? buy : 0,
      avgPrice: buy > 0 ? buy : null,
      accountKey: `${broker}|${account}`,
      accountLabel: label || "계좌",
    };
  });
  return { holdings, priceFallbacks };
}
