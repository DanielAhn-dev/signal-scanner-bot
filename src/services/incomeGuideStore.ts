/**
 * 리밸런싱 가이드 저장·조회 — 웹 경로(handlers/ui/income-guide.ts)와 월 자동 기록 배치(scripts/income_guide_monthly.ts)가 같이 쓴다.
 * 파일: market-snapshots/income-guide/{chatId}.json = { settings, history, receipts, adherenceExcluded, accounts, cashDeposits, cashChecks, cashActivity }
 * 계좌 보유 = virtual_positions 중 증권사·계좌명이 있는 행("계좌/보유 추가"로 입력). 봇 가상 계좌는 넣지 않는다.
 */
import { computeDistributionStats, pickYieldPct } from "../lib/distributionStats";
import { loadDistributionRows } from "./etfDistributionStore";
import { fetchRealtimePriceBatch, type RealtimeStockData } from "../utils/fetchRealtimePrice";
import { fetchEtfKeyIndicators } from "./etfKeyIndicator";
import { selectPaged } from "./supabasePaging";
import { isExchangeTradedProduct } from "../lib/securitiesTax";
import { sanitizeReceipts, type DistributionReceipt } from "../lib/distributionReceipts";
import { sanitizeCashActivity, sanitizeCashChecks, type CashActivity, type CashChecks } from "../lib/accountCash";
import { sanitizeAccountGuideMap, type AccountGuideMap } from "../lib/guideAccountScope";
import { overseasPctOfMix, readInvestPlan, type MixEntry } from "./userPlan";
import {
  DEFAULT_INCOME_GUIDE_SETTINGS,
  readCashUpdatedAt,
  sanitizeCashDeposits,
  sanitizeIncomeGuideSettings,
  type CashDeposit,
  type GuideHistoryEntry,
  type GuideHolding,
  type IncomeGuideSettings,
  type YieldPctByCode,
} from "../lib/incomeGuide";

const BUCKET = "market-snapshots";
const DIR = "income-guide";

export type GuideFile = {
  settings: IncomeGuideSettings;
  history: GuideHistoryEntry[];
  /** 실계좌 분배금 받은 기록(src/lib/distributionReceipts.ts) */
  receipts?: DistributionReceipt[];
  /** 가이드 따름 판정에서 사용자가 뺀 항목 키(입력 실수 등, src/lib/guideAdherence.ts) */
  adherenceExcluded?: string[];
  /** 계좌별 종류·목표·월 넣는 돈·점검 기록 (src/lib/guideAccountScope.ts). 키는 accountKey("증권사|계좌") */
  accounts?: AccountGuideMap;
  /** 분배금만큼 은행에서 증권 계좌로 넣은 돈(달마다 한 계좌) — 예수금에 더한 몫을 되돌릴 수 있게 남긴다 */
  cashDeposits?: CashDeposit[];
  /** 계좌별로 실제 잔액을 마지막으로 적은 값·날짜(src/lib/accountCash.ts) — 그 뒤 자동 반영된 몫을 보여 준다 */
  cashChecks?: CashChecks;
  /** 계좌별 수동 입금·잔액 보정 이력(src/lib/accountCash.ts) */
  cashActivity?: CashActivity;
};

const pathOf = (chatId: string | number) => `${DIR}/${chatId}.json`;

export async function loadGuideFile(supabase: any, chatId: string | number): Promise<GuideFile | null> {
  // Storage CDN이 옛 내용을 돌려주지 않게 매번 캐시를 우회한다 (goalTracker와 같은 이유)
  const { data, error } = await supabase.storage.from(BUCKET).download(pathOf(chatId), { cacheNonce: String(Date.now()) });
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as { settings?: Partial<IncomeGuideSettings>; history?: GuideHistoryEntry[]; receipts?: unknown; adherenceExcluded?: unknown; accounts?: unknown; cashDeposits?: unknown; cashChecks?: unknown; cashActivity?: unknown };
    if (!parsed.settings) return null;
    const cashUpdatedAt = readCashUpdatedAt(parsed.settings.cashUpdatedAt);
    const settings = {
      ...sanitizeIncomeGuideSettings(parsed.settings, DEFAULT_INCOME_GUIDE_SETTINGS),
      ...(cashUpdatedAt ? { cashUpdatedAt } : {}),
    };
    return {
      settings,
      accounts: sanitizeAccountGuideMap(parsed.accounts, settings),
      history: Array.isArray(parsed.history) ? parsed.history : [],
      receipts: sanitizeReceipts(parsed.receipts),
      adherenceExcluded: Array.isArray(parsed.adherenceExcluded) ? parsed.adherenceExcluded.map(String).slice(-500) : [],
      cashDeposits: sanitizeCashDeposits(parsed.cashDeposits),
      cashChecks: sanitizeCashChecks(parsed.cashChecks),
      cashActivity: sanitizeCashActivity(parsed.cashActivity),
    };
  } catch {
    return null;
  }
}

/**
 * 내 계획 구성의 해외지수 몫(%) — 정했으면 가이드의 해외 비중 목표 대신 쓴다(화면 지도 7단계: 같은 질문을 두 곳이 따로 답하지 않게).
 * 구성이 없거나 prefs를 못 읽으면 null — 가이드에 적어 둔 값을 그대로 쓴다(읽기 실패로 목표를 바꾸지 않는다).
 */
export async function loadPlanOverseasPct(supabase: any, chatId: string | number): Promise<number | null> {
  return (await loadGuidePlan(supabase, chatId))?.overseasPct ?? null;
}

/** 가이드·리포트가 읽는 내 계획 — 구성(새 돈 나누기 src/lib/planMixGuide.ts)·매달 금액·해외 몫. prefs를 못 읽으면 null */
export async function loadGuidePlan(
  supabase: any,
  chatId: string | number
): Promise<{ overseasPct: number | null; mix: MixEntry[] | null; monthly: number } | null> {
  const { data, error } = await supabase.from("users").select("prefs").eq("tg_id", chatId).maybeSingle();
  if (error || !data) return null;
  const plan = readInvestPlan(((data as any).prefs ?? {}) as Record<string, unknown>);
  return { overseasPct: overseasPctOfMix(plan.mix), mix: plan.mix, monthly: plan.monthly };
}

/** 계산용 설정 — 저장 파일은 건드리지 않는다 */
export function withPlanOverseas(settings: IncomeGuideSettings, planOverseasPct: number | null): IncomeGuideSettings {
  return planOverseasPct == null ? settings : { ...settings, overseasPct: planOverseasPct };
}

export async function saveGuideFile(supabase: any, chatId: string | number, file: GuideFile): Promise<string | null> {
  const { error } = await supabase.storage.from(BUCKET).upload(pathOf(chatId), JSON.stringify(file), {
    upsert: true,
    contentType: "application/json",
    cacheControl: "0",
  });
  return error ? String(error.message) : null;
}

type PositionStock = { name?: string; close?: number; product_type?: string | null; etf_tax_class?: string | null };
type PositionRow = {
  chat_id?: string | number;
  code: string;
  quantity: number;
  buy_price: number | null;
  status: string | null;
  broker_name: string | null;
  account_name: string | null;
  stock: PositionStock | PositionStock[] | null;
};

/** 계좌 보유 행 — chatId를 주면 그 사용자만, 안 주면 계좌 보유가 있는 모든 사용자 */
export async function loadAccountPositionRows(supabase: any, chatId?: string | number): Promise<PositionRow[]> {
  // 1000행에서 조용히 잘리면 일부 종목이 빠진 채 비중이 계산되므로 끝까지 받는다
  const rows = await selectPaged<PositionRow>(
    async (from, to) => {
      let q = supabase
        .from("virtual_positions")
        .select("id, chat_id, code, quantity, buy_price, status, broker_name, account_name, stock:stocks(name, close, product_type, etf_tax_class)")
        .gt("quantity", 0)
        .or("broker_name.not.is.null,account_name.not.is.null")
        .order("id", { ascending: true });
      if (chatId != null) q = q.eq("chat_id", chatId);
      return await q.range(from, to);
    },
    { logLabel: "incomeGuide.account_positions" }
  );
  return rows.filter((r) => String(r.status ?? "holding") !== "closed");
}

/** 종목 시세 — 실시간가(장 마감 뒤엔 종가) → stocks.close 순. ETF는 stocks.close가 비어 있는 경우가 많다 */
export async function fetchGuidePrices(supabase: any, codes: string[]): Promise<{ prices: Map<string, number>; names: Map<string, string>; realtimeHits: Set<string> }> {
  const unique = Array.from(new Set(codes.map((c) => String(c || "").trim()).filter(Boolean)));
  const prices = new Map<string, number>();
  const names = new Map<string, string>();
  const realtimeHits = new Set<string>();
  if (!unique.length) return { prices, names, realtimeHits };
  const realtime = await fetchRealtimePriceBatch(unique).catch(() => ({}) as Record<string, RealtimeStockData>);
  // .in()에 큰 배열을 한 번에 넘기면 URL이 커져 실패하므로 나눠서 조회한다
  const stockRows: Array<{ code: string; name: string | null; close: number | null }> = [];
  for (let i = 0; i < unique.length; i += 150) {
    const { data } = await supabase.from("stocks").select("code, name, close").in("code", unique.slice(i, i + 150));
    stockRows.push(...((data ?? []) as typeof stockRows));
  }
  const byCode = new Map(stockRows.map((s) => [String(s.code), s]));
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
      productType: stock?.product_type ?? null,
      etfTaxClass: stock?.etf_tax_class ?? null,
    };
  });
  return { holdings, priceFallbacks };
}

/**
 * ETF 종목별 최근 12개월 실제 분배율(네이버) — 가이드·할 일·리포트가 같은 값을 쓰게 한다(resolveYieldPct).
 * 느리거나 실패하면 빈 값을 돌려주고 상품 유형별 가정으로 계산된다(화면을 막지 않는다).
 */
export async function fetchYieldPctByCode(
  holdings: Array<{ code: string; name: string; price?: number; productType?: string | null }>,
  timeoutMs = 5_000,
  /** 주면 운용사 분배금 이력(etf_distributions)으로 분배율을 바로잡는다 — 규칙은 pickYieldPct. 이력 조회가 실패하면 네이버 값 그대로 */
  history?: { supabase: any; today: string },
): Promise<YieldPctByCode> {
  const codes = holdings.filter((h) => isExchangeTradedProduct(h.code, h.name, h.productType)).map((h) => h.code);
  if (!codes.length) return {};
  type Indicators = Awaited<ReturnType<typeof fetchEtfKeyIndicators>>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const map = await Promise.race<Indicators>([
    fetchEtfKeyIndicators(codes).catch(() => new Map()),
    new Promise<Indicators>((resolve) => { timer = setTimeout(() => resolve(new Map()), timeoutMs); }),
  ]);
  if (timer) clearTimeout(timer);
  const out: YieldPctByCode = {};
  for (const [code, k] of map) if (k?.yieldTtm != null) out[code] = k.yieldTtm;
  if (history) {
    try {
      const priceOf = new Map<string, number>();
      for (const h of holdings) if (h.price && h.price > 0) priceOf.set(h.code, h.price);
      const rowsByCode = await loadDistributionRows(history.supabase, [...priceOf.keys()]);
      for (const [code, rows] of rowsByCode) {
        const pick = pickYieldPct(computeDistributionStats(code, rows, history.today), priceOf.get(code) ?? 0, out[code]);
        if (pick) out[code] = pick.pct;
      }
    } catch {
      // 이력을 못 읽으면 네이버 값 그대로 — 분배율을 못 구했다고 가이드를 막지 않는다
    }
  }
  return out;
}
