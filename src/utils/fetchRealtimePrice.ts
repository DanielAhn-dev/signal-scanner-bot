// src/utils/fetchRealtimePrice.ts
// Enhanced real-time stock data fetching with batch support

interface NaverStockBasic {
  stockName?: string;
  closePrice?: string;
  compareToPreviousClosePrice?: string;
  fluctuationsRatio?: string;
  marketStatus?: string;
  accumulatedTradingVolume?: string;
  accumulatedTradingValue?: string;
  high52wPrice?: string;
  low52wPrice?: string;
  per?: string;
  pbr?: string;
  foreignerHoldingRatio?: string;
}

export type RealtimePriceSource = "naver";

export interface RealtimeStockData {
  price: number;
  change: number;
  changeRate: number;
  name?: string;
  volume?: number;
  tradingValue?: number;
  marketStatus?: string;
  high52w?: number;
  low52w?: number;
  per?: number;
  pbr?: number;
  foreignRatio?: number;
  source: RealtimePriceSource;
  fetchedAt: string;
}

type RealtimeCoverageMetricInput = {
  context: string;
  requestedCodes: string[];
  realtimeMap: Record<string, RealtimeStockData>;
  fallbackToCloseCount?: number;
  extra?: Record<string, string | number | boolean | null | undefined>;
};

const parseNum = (s?: string): number | undefined => {
  if (!s) return undefined;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const parseInt2 = (s?: string): number | undefined => {
  if (!s) return undefined;
  const n = parseInt(s.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : undefined;
};

const FETCH_TIMEOUT_MS = 2500;

/** 하위 호환: 실시간 가격만 반환 */
export async function fetchRealtimePrice(code: string): Promise<number | null> {
  const data = await fetchRealtimeStockData(code);
  return data?.price ?? null;
}

/** 실시간 종합 데이터 반환 */
export async function fetchRealtimeStockData(
  code: string
): Promise<RealtimeStockData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetch(
      `https://m.stock.naver.com/api/stock/${code}/basic`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: controller.signal,
      }
    );
    if (!response.ok) return null;

    const data = (await response.json()) as NaverStockBasic;
    if (!data?.closePrice) return null;

    const price = parseInt(data.closePrice.replace(/,/g, ""), 10);
    if (!Number.isFinite(price)) return null;

    return {
      price,
      change: parseInt2(data.compareToPreviousClosePrice) ?? 0,
      changeRate: parseNum(data.fluctuationsRatio) ?? 0,
      name: data.stockName,
      volume: parseInt2(data.accumulatedTradingVolume),
      tradingValue: parseInt2(data.accumulatedTradingValue),
      marketStatus: data.marketStatus,
      high52w: parseInt2(data.high52wPrice),
      low52w: parseInt2(data.low52wPrice),
      per: parseNum(data.per),
      pbr: parseNum(data.pbr),
      foreignRatio: parseNum(data.foreignerHoldingRatio),
      source: "naver",
      fetchedAt,
    };
  } catch (e) {
    console.error(`실시간 데이터 조회 실패 (${code}):`, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 여러 종목 병렬 조회 (재시도 로직 포함) */
export async function fetchRealtimePriceBatch(
  codes: string[],
  options: { retries?: number; chunkSize?: number } = {}
): Promise<Record<string, RealtimeStockData>> {
  const result: Record<string, RealtimeStockData> = {};
  const uniqueCodes = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
  const chunkSize = options.chunkSize ?? 20;
  const maxRetries = options.retries ?? 2;

  // 첫 번째 시도
  const failedCodes = new Set<string>();
  
  for (let i = 0; i < uniqueCodes.length; i += chunkSize) {
    const chunk = uniqueCodes.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(
      chunk.map(async (code) => {
        const data = await fetchRealtimeStockData(code);
        if (data) {
          result[code] = data;
        } else {
          failedCodes.add(code);
        }
      })
    );

    for (const item of settled) {
      if (item.status === "rejected") {
        console.error("실시간 배치 조회 실패:", item.reason);
      }
    }
  }

  // 재시도: 실패한 종목들만 다시 시도
  let retryCount = 0;
  while (failedCodes.size > 0 && retryCount < maxRetries) {
    retryCount++;
    console.warn(`[fetchRealtimePriceBatch] 재시도 ${retryCount}/${maxRetries}: ${failedCodes.size}개 종목`);
    
    const codesForRetry = Array.from(failedCodes);
    failedCodes.clear();

    for (let i = 0; i < codesForRetry.length; i += chunkSize) {
      const chunk = codesForRetry.slice(i, i + chunkSize);
      
      // 재시도 전 짧은 지연
      await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
      
      const settled = await Promise.allSettled(
        chunk.map(async (code) => {
          const data = await fetchRealtimeStockData(code);
          if (data) {
            result[code] = data;
          } else {
            failedCodes.add(code); // 재시도에서도 실패
          }
        })
      );

      for (const item of settled) {
        if (item.status === "rejected") {
          console.error("실시간 배치 재시도 실패:", item.reason);
        }
      }
    }
  }

  // 최종 실패 로깅
  if (failedCodes.size > 0) {
    console.warn(
      `[fetchRealtimePriceBatch] 최종 실패: ${failedCodes.size}/${uniqueCodes.length}개 종목`,
      Array.from(failedCodes).slice(0, 5)
    );
  }

  const coverage = ((uniqueCodes.length - failedCodes.size) / uniqueCodes.length) * 100;
  console.info(`[fetchRealtimePriceBatch] 커버리지: ${coverage.toFixed(1)}% (${uniqueCodes.length - failedCodes.size}/${uniqueCodes.length})`);

  return result;
}

/** 운영 관측용: 실시간 가격 조회 커버리지 메트릭 로깅 */
export function logRealtimeCoverageMetric(input: RealtimeCoverageMetricInput): void {
  if (String(process.env.UI_REALTIME_METRICS_ENABLED || "0") !== "1") return;

  const requested = [...new Set(input.requestedCodes.map((code) => code.trim()).filter(Boolean))];
  const requestedCount = requested.length;
  if (requestedCount <= 0) return;

  const realtimeHitCount = requested.reduce((acc, code) => {
    const price = Number(input.realtimeMap[code]?.price);
    return acc + (Number.isFinite(price) && price > 0 ? 1 : 0);
  }, 0);
  const fallbackToCloseCount = Math.max(0, Number(input.fallbackToCloseCount || 0));
  const realtimeCoveragePct = Math.round((realtimeHitCount / requestedCount) * 10000) / 100;

  console.info(
    "[realtime-price-metric]",
    JSON.stringify({
      context: input.context,
      requestedCount,
      realtimeHitCount,
      fallbackToCloseCount,
      realtimeCoveragePct,
      ...input.extra,
    })
  );
}
