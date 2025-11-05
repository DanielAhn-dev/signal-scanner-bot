import { createClient } from "@supabase/supabase-js";
import type { StockOHLCV } from "./types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

/**
 * OHLCV 캐시 조회
 */
export async function getCachedOHLCV(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<StockOHLCV[]> {
  const { data, error } = await supabase
    .from("ohlcv_cache")
    .select("*")
    .eq("code", ticker)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (error) {
    console.error("[Cache] Fetch error:", error);
    return [];
  }

  // cached_at 필드를 포함해서 반환
  return (data || []).map((row) => ({
    code: row.code,
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    amount: row.amount,
    cached_at: row.cached_at,
  }));
}

/**
 * OHLCV 캐시 저장
 */
export async function setCachedOHLCV(data: StockOHLCV[]): Promise<boolean> {
  // cached_at이 없으면 현재 시간 추가
  const records = data.map((d) => ({
    code: d.code,
    date: d.date,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
    amount: d.amount,
    cached_at: d.cached_at || new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("ohlcv_cache")
    .upsert(records, { onConflict: "code,date" });

  if (error) {
    console.error("[Cache] Save error:", error);
    return false;
  }

  return true;
}

/**
 * 캐시 만료 확인 (24시간)
 */
export async function isCacheExpired(
  ticker: string,
  date: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("ohlcv_cache")
    .select("cached_at")
    .eq("code", ticker)
    .eq("date", date)
    .single();

  if (error || !data) return true;

  const cachedTime = new Date(data.cached_at).getTime();
  const now = Date.now();
  const hoursSince = (now - cachedTime) / (1000 * 60 * 60);

  return hoursSince > 24;
}
