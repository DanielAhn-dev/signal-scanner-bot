// src/cache/memory.ts (교체)
// 제네릭 + TTL(ms) + Supabase 영속 폴백 캐시
import { createClient } from "@supabase/supabase-js";
import type { StockOHLCV } from "../data/types";

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : (null as any);

type Entry<T> = { value: T; expiresAt: number | null };
const MEM = new Map<string, Entry<any>>();

export async function getCache<T = any>(key: string): Promise<T | null> {
  const hit = MEM.get(key);
  if (hit && (hit.expiresAt === null || Date.now() <= hit.expiresAt)) {
    return hit.value as T;
  }
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("cache")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data?.value) return null;

  const { data: v, expires } = data.value as {
    data: T;
    expires?: number | null;
  };
  if (typeof expires === "number" && Date.now() > expires) return null;

  MEM.set(key, {
    value: v,
    expiresAt: typeof expires === "number" ? expires : null,
  });
  return v as T;
}

export async function setCache<T = any>(
  key: string,
  value: T,
  ttlMs?: number
): Promise<void> {
  const expiresAt =
    typeof ttlMs === "number" && ttlMs > 0 ? Date.now() + ttlMs : null;
  MEM.set(key, { value, expiresAt });
  if (!supabase) return;
  await supabase
    .from("cache")
    .upsert([{ key, value: { data: value, expires: expiresAt } }], {
      onConflict: "key",
    });
}

export async function invalidateCache(key?: string): Promise<void> {
  if (!key) {
    MEM.clear();
    if (supabase) await supabase.from("cache").delete();
    return;
  }
  MEM.delete(key);
  if (supabase) await supabase.from("cache").delete().eq("key", key);
}

// 선택: OHLCV 영속 캐시 유틸 (시그니처 유지)
export async function getCachedOHLCV(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<StockOHLCV[]> {
  const key = `ohlcv:${ticker}:${startDate}:${endDate}`;
  const cached = await getCache<StockOHLCV[]>(key);
  if (cached?.length) return cached;

  if (!supabase) return [];
  const { data: row } = await supabase
    .from("ohlcv_cache")
    .select("data")
    .eq("ticker", ticker)
    .gte("start_date", startDate)
    .lte("end_date", endDate)
    .order("cached_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const list = (row?.data as StockOHLCV[] | undefined) || [];
  const ohlcv = list.filter(
    (d) => d.date >= startDate && d.date <= endDate && Number.isFinite(d.close)
  );
  await setCache(key, ohlcv, 24 * 60 * 60 * 1000);
  return ohlcv;
}

export async function setCachedOHLCV(data: StockOHLCV[]): Promise<void> {
  if (!data?.length || !supabase) return;
  const ticker = data[0].code;
  const startDate = data[0].date;
  const endDate = data[data.length - 1].date;

  const cleaned: StockOHLCV[] = data.map((d) => ({
    ...d,
    cached_at: new Date().toISOString(),
    open: Number.isFinite(d.open) ? d.open : 0,
    high: Number.isFinite(d.high) ? d.high : 0,
    low: Number.isFinite(d.low) ? d.low : 0,
    close: Number.isFinite(d.close) ? d.close : 0,
    volume: Number.isFinite(d.volume) ? d.volume : 0,
    amount: Number.isFinite(d.amount) ? d.amount : 0,
  }));

  const upsert = [
    {
      ticker,
      start_date: startDate,
      end_date: endDate,
      data: cleaned,
    },
  ];

  await supabase
    .from("ohlcv_cache")
    .upsert(upsert, { onConflict: "ohlcv_unique" });

  const key = `ohlcv:${ticker}:${startDate}:${endDate}`;
  await setCache(key, cleaned, 24 * 60 * 60 * 1000);
}
