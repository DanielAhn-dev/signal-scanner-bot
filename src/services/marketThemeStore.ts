// src/services/marketThemeStore.ts
// 테마 스냅샷(market_themes·theme_daily) 읽기 + 네이버 ETF 상위 구성 조회. 화면 라우트 handlers/ui/market-themes.ts·my-themes.ts

import type { HoldingWeight, ThemeDay, ThemeMeta } from "../lib/themeFlow";
import type { ThemeNewsItem } from "../lib/marketThemes";

/** 1000행에서 조용히 잘리므로 끝까지 읽는다 */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await page(off, off + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadThemeMeta(supabase: any): Promise<ThemeMeta[]> {
  const rows = await readAll<{ theme_no: number; name: string; member_codes: string[] | null; first_seen: string }>((a, b) =>
    supabase.from("market_themes").select("theme_no, name, member_codes, first_seen").order("theme_no").range(a, b)
  );
  return rows.map((r) => ({ themeNo: Number(r.theme_no), name: r.name, memberCodes: r.member_codes ?? [], firstSeen: String(r.first_seen) }));
}

type DayRow = {
  trade_date: string;
  theme_no: number;
  change_rate: number | string;
  rise_count: number;
  total_count: number;
  trading_value: number | string;
  news_count: number;
  news?: ThemeNewsItem[] | null;
};

const toDay = (r: DayRow): ThemeDay => ({
  tradeDate: String(r.trade_date),
  themeNo: Number(r.theme_no),
  changeRate: Number(r.change_rate),
  riseCount: Number(r.rise_count),
  totalCount: Number(r.total_count),
  tradingValue: Number(r.trading_value),
  newsCount: Number(r.news_count),
  news: Array.isArray(r.news) ? r.news : [],
});

/**
 * 최근 거래일 기록. 기사 목록(news)은 무거워서 마지막 거래일 것만 따로 붙인다.
 * themeNos를 주면 그 테마만 (보유 연결 카드).
 */
export async function loadThemeDays(supabase: any, opts: { sinceDate: string; themeNos?: number[] }): Promise<ThemeDay[]> {
  const cols = "trade_date, theme_no, change_rate, rise_count, total_count, trading_value, news_count";
  const rows = await readAll<DayRow>((a, b) => {
    let q = supabase.from("theme_daily").select(cols).gte("trade_date", opts.sinceDate);
    if (opts.themeNos) q = q.in("theme_no", opts.themeNos);
    return q.order("trade_date").order("theme_no").range(a, b);
  });
  const days = rows.map(toDay);
  const last = days.reduce((m, d) => (d.tradeDate > m ? d.tradeDate : m), "");
  if (!last) return days;
  const newsRows = await readAll<{ theme_no: number; news: ThemeNewsItem[] | null }>((a, b) => {
    let q = supabase.from("theme_daily").select("theme_no, news").eq("trade_date", last);
    if (opts.themeNos) q = q.in("theme_no", opts.themeNos);
    return q.order("theme_no").range(a, b);
  });
  const newsBy = new Map(newsRows.map((r) => [Number(r.theme_no), Array.isArray(r.news) ? r.news : []]));
  for (const d of days) if (d.tradeDate === last) d.news = newsBy.get(d.themeNo) ?? [];
  return days;
}

export type EtfTopHoldings = {
  /** 네이버 ETF 분류 (예: "혁신기술 · 로봇") */
  category: string | null;
  weights: HoldingWeight[];
};

/** 네이버 etfAnalysis 상위 10 구성. ETF가 아니거나 실패하면 null */
export async function fetchEtfTopHoldings(code: string, timeoutMs = 6_000): Promise<EtfTopHoldings | null> {
  try {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${code}/etfAnalysis`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return parseEtfTopHoldings(await res.json());
  } catch {
    return null;
  }
}

export function parseEtfTopHoldings(body: unknown): EtfTopHoldings | null {
  const b = (body ?? {}) as { etfTop10MajorConstituentAssets?: unknown[]; themeReturns?: Record<string, unknown> };
  const list = Array.isArray(b.etfTop10MajorConstituentAssets) ? b.etfTop10MajorConstituentAssets : null;
  if (!list) return null;
  const weights: HoldingWeight[] = [];
  for (const x of list as Array<Record<string, unknown>>) {
    const code = String(x.itemCode ?? "").trim();
    const w = Number(String(x.etfWeight ?? "").replace(/[%,\s]/g, ""));
    if (!/^[0-9A-Z]{6}$/.test(code) || !Number.isFinite(w) || w <= 0) continue;
    weights.push({ code, name: String(x.itemName ?? "").trim(), weight: w / 100 });
  }
  const t = b.themeReturns ?? {};
  const parts = [t.themeLargeCodeDesc, t.themeMiddleCodeDesc].map((v) => String(v ?? "").trim()).filter(Boolean);
  return { category: parts.length ? parts.join(" · ") : null, weights };
}
