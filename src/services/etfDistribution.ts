/**
 * ETF 분배금 — 실제로 따라 하는 사람이 받는 분배금을 가상 계좌에도 똑같이 넣는다.
 *
 * 예전엔 분배금을 넣지 않아 KODEX 200 보유가 실제보다 연 1%p 안팎 낮게 기록됐고(2025년 주당 855원),
 * 지수 보유와 종목 봇 비교가 지수 쪽에 불리했다.
 *
 * - 데이터: 삼성자산운용 KODEX 공식 API (기준일·지급일·주당 분배금·과세표준 주당 금액)
 * - 받을 자격: 분배락일(기준일 전 거래일) 전날까지 산 수량 = 거래 기록에서 락일 전까지의 매수 − 매도
 * - 지급일이 지난 첫 실행 때 한 번, 세후 금액을 가상 현금과 확정 수익(virtual_realized_pnl)에 더한다
 *   → 매주 시드 재계산 때 시드로 들어가 재투자된다. 목표 트래커는 시드 변경이 "이전 시드 + 확정손익"과 같아 입출금으로 보지 않는다.
 * - 세금: 과세표준(taxDividA) × 15.4% (일반 계좌 기준)
 */
import { isKrxTradingDate } from "../lib/krxCalendar";

export type EtfDistribution = {
  code: string;
  /** 분배금 기준일 YYYY-MM-DD */
  recordDate: string;
  /** 지급일 YYYY-MM-DD */
  payDate: string;
  /** 주당 분배금 (원) */
  perShare: number;
  /** 과세표준 주당 금액 (원) */
  taxablePerShare: number;
};

export type DistributionRecord = {
  code: string;
  recordDate: string;
  payDate: string;
  quantity: number;
  gross: number;
  tax: number;
  net: number;
};

/** 분배금 이력을 받을 수 있는 ETF → KODEX 상품 ID */
export const KODEX_FUND_IDS: Record<string, string> = {
  "069500": "2ETF01", // KODEX 200
};

export const DISTRIBUTION_TAX_RATE = 0.154;
/** 지급일이 이보다 오래된 분배금은 새로 넣지 않는다 (기능 도입 전 과거분을 한꺼번에 넣지 않게) */
export const DISTRIBUTION_LOOKBACK_DAYS = 45;

const toDateKey = (yyyymmdd: string) =>
  /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : "";

export function parseKodexDistributions(code: string, json: unknown): EtfDistribution[] {
  const list = (json as { dividList?: Array<Record<string, string>> } | null)?.dividList;
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => ({
      code,
      recordDate: toDateKey(String(r.basicD ?? "")),
      payDate: toDateKey(String(r.payD ?? "")),
      perShare: Number(String(r.dividA ?? "").replace(/,/g, "")),
      taxablePerShare: Number(String(r.taxDividA ?? "").replace(/,/g, "")),
    }))
    .filter((d) => d.recordDate && d.payDate && d.perShare > 0)
    .map((d) => ({ ...d, taxablePerShare: Number.isFinite(d.taxablePerShare) ? Math.max(0, d.taxablePerShare) : d.perShare }));
}

const cache = new Map<string, { at: number; list: EtfDistribution[] }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function fetchEtfDistributions(code: string): Promise<EtfDistribution[]> {
  const id = KODEX_FUND_IDS[code];
  if (!id) return [];
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`https://www.samsungfund.com/api/v1/kodex/divid-info.do?id=${id}`, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: `https://www.samsungfund.com/etf/product/view.do?id=${id}` },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const list = parseKodexDistributions(code, await res.json());
    if (list.length) cache.set(code, { at: Date.now(), list });
    return list;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** 분배락일 = 기준일 전 거래일. 이날 이전(락일 전날까지) 산 수량이 받는다 */
export function exDividendDate(recordDate: string): string {
  const d = new Date(`${recordDate}T00:00:00Z`);
  for (let i = 0; i < 10; i += 1) {
    d.setUTCDate(d.getUTCDate() - 1);
    const key = d.toISOString().slice(0, 10);
    if (isKrxTradingDate(key)) return key;
  }
  return recordDate;
}

/** 거래 기록(KST 날짜)으로 락일 전까지의 보유 수량 */
export function eligibleQuantity(
  trades: Array<{ side: string; quantity: number; tradedDate: string }>,
  exDate: string
): number {
  let qty = 0;
  for (const t of trades) {
    if (t.tradedDate >= exDate) continue;
    if (t.side === "BUY") qty += t.quantity;
    else if (t.side === "SELL") qty -= t.quantity;
  }
  return Math.max(0, qty);
}

export function computeDistributionCredit(d: EtfDistribution, quantity: number): DistributionRecord {
  const gross = Math.round(d.perShare * quantity);
  const tax = Math.floor(d.taxablePerShare * quantity * DISTRIBUTION_TAX_RATE);
  return { code: d.code, recordDate: d.recordDate, payDate: d.payDate, quantity, gross, tax, net: gross - tax };
}

/** 오늘 넣을 차례인 분배금 (지급일 도래, 최근 45일 이내, 아직 안 넣은 것) */
export function dueDistributions(list: EtfDistribution[], todayKey: string, credited: DistributionRecord[]): EtfDistribution[] {
  const since = new Date(new Date(`${todayKey}T00:00:00Z`).getTime() - DISTRIBUTION_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const done = new Set(credited.map((r) => `${r.code}:${r.recordDate}`));
  return list.filter((d) => d.payDate <= todayKey && d.payDate >= since && !done.has(`${d.code}:${d.recordDate}`));
}

export function readDistributionLog(prefs: Record<string, unknown>): DistributionRecord[] {
  const raw = prefs.virtual_distribution_log;
  return Array.isArray(raw) ? (raw as DistributionRecord[]).filter((r) => r && typeof r.recordDate === "string") : [];
}
