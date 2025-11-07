// packages/data/cache.ts (첨부 기반 + 수정)
import { createClient } from "@supabase/supabase-js";
import type { StockOHLCV } from "../data/types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);
const MEMORY_CACHE: Map<string, { data: any; expires: number }> = new Map();
export const TTL_MS = 24 * 60 * 60 * 1000;

export async function getCache(key: string): Promise<any | null> {
  const mem = MEMORY_CACHE.get(key);
  if (mem && Date.now() < mem.expires) return mem.data;

  const { data } = await supabase
    .from("cache")
    .select("value")
    .eq("key", key)
    .single();
  if (data?.value && Date.now() < (data.value.expires || 0)) {
    const cached = data.value;
    MEMORY_CACHE.set(key, { data: cached.data, expires: cached.expires });
    return cached.data;
  }
  return null;
}

export async function setCache(key: string, data: any): Promise<void> {
  const entry = { data, expires: Date.now() + TTL_MS };
  MEMORY_CACHE.set(key, entry);

  await supabase
    .from("cache")
    .upsert([{ key, value: entry }], { onConflict: "key" });
}

export async function invalidateCache(key?: string): Promise<void> {
  if (key) {
    MEMORY_CACHE.delete(key);
    await supabase.from("cache").delete().eq("key", key);
  } else {
    MEMORY_CACHE.clear();
    await supabase.from("cache").delete();
  }
}

export async function getCachedOHLCV(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<StockOHLCV[]> {
  const key = `${ticker}_${startDate}_${endDate}`;
  const cached = await getCache(key);
  if (cached && Array.isArray(cached)) return cached;

  const { data: rows } = await supabase
    .from("ohlcv_cache")
    .select("data")
    .eq("ticker", ticker)
    .gte("start_date", startDate)
    .lte("end_date", endDate)
    .order("cached_at", { ascending: false })
    .limit(1)
    .single();

  if (rows?.data && Array.isArray(rows.data)) {
    const ohlcv: StockOHLCV[] = rows.data.filter(
      (d: any): d is StockOHLCV =>
        d.date >= startDate && d.date <= endDate && typeof d.close === "number"
    );
    await setCache(key, ohlcv);
    return ohlcv;
  }
  return [];
}

export async function setCachedOHLCV(data: StockOHLCV[]): Promise<void> {
  if (data.length === 0) return;

  const ticker = data[0].code;
  const startDate = data[0].date;
  const endDate = data[data.length - 1].date;

  // enrichedData: cached_at 추가 + 숫자/날짜 검증 (JSONB 안전화)
  const enrichedData: StockOHLCV[] = data.map((d: StockOHLCV) => ({
    ...d,
    cached_at: new Date().toISOString(),
    // 안전화: NaN/inf → 0, date 형식 확인
    open: isNaN(d.open) ? 0 : d.open,
    high: isNaN(d.high) ? 0 : d.high,
    low: isNaN(d.low) ? 0 : d.low,
    close: isNaN(d.close) ? 0 : d.close,
    volume: isNaN(d.volume) ? 0 : d.volume,
    amount: isNaN(d.amount) ? 0 : d.amount,
  }));

  const upsertPayload = [
    {
      ticker,
      start_date: startDate,
      end_date: endDate,
      data: enrichedData, // JSONB 배열 (Supabase 자동 직렬화)
    },
  ];

  // TS2769 해결: onConflict를 제약명 string으로 (배열 X, UNIQUE 제약 가정)
  const options = {
    onConflict: "ohlcv_unique", // 복합 키 제약명 (SQL로 생성)
  };

  const { error } = await supabase
    .from("ohlcv_cache")
    .upsert(upsertPayload, options);

  if (error) {
    console.error("OHLCV upsert error:", error.message || error);
    // 제약 위반 시 구체 로그 (Free 플랜 디버그)
    if (error.code === "23505") {
      // unique_violation
      console.warn(
        `Duplicate OHLCV for ${ticker} (${startDate}-${endDate}): Skipping or update manually.`
      );
    }
  } else {
    console.log(
      `Upserted OHLCV for ${ticker}: ${enrichedData.length} candles (${startDate} to ${endDate})`
    );
  }

  // 메모리 캐시 동기화 (기존)
  const key = `${ticker}_${startDate}_${endDate}`;
  await setCache(key, enrichedData);
}
