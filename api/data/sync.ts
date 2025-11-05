import type { VercelRequest, VercelResponse } from "@vercel/node";
import { KRXClient } from "../../packages/data/krx-client";
import { getCachedOHLCV, setCachedOHLCV } from "../../packages/data/cache";
import type { StockOHLCV } from "../../packages/data/types";

/**
 * Mock 데이터 생성 (개발/테스트용)
 */
function generateMockData(
  ticker: string,
  startDate: string,
  endDate: string
): StockOHLCV[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const data: StockOHLCV[] = [];

  // 종목별 기준가
  const basePrices: Record<string, number> = {
    "005930": 70000, // 삼성전자
    "000660": 120000, // SK하이닉스
    "373220": 400000, // LG에너지솔루션
    "207940": 850000, // 삼성바이오로직스
  };

  let basePrice = basePrices[ticker] || 50000;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    // 주말 제외
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    // 랜덤 변동 생성
    const changePercent = (Math.random() - 0.5) * 0.03; // ±1.5%
    const open = Math.round(basePrice);
    const close = Math.round(basePrice * (1 + changePercent));
    const high = Math.round(Math.max(open, close) * (1 + Math.random() * 0.01));
    const low = Math.round(Math.min(open, close) * (1 - Math.random() * 0.01));
    const volume = Math.floor(10000000 + Math.random() * 10000000);

    data.push({
      date: d.toISOString().slice(0, 10),
      code: ticker,
      open,
      high,
      low,
      close,
      volume,
      amount: close * volume,
    });

    basePrice = close; // 다음 날 기준가
  }

  return data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { ticker, startDate, endDate, useMock = false } = req.body;

  if (!ticker || !startDate || !endDate) {
    return res.status(400).json({
      error: "Missing required fields: ticker, startDate, endDate",
    });
  }

  try {
    console.log(`[Sync] Fetching ${ticker} from ${startDate} to ${endDate}`);

    // 1. 캐시 확인
    let data = await getCachedOHLCV(ticker, startDate, endDate);

    // 2. 캐시 미스 시 데이터 수집
    if (data.length === 0) {
      // 🔥 Mock 데이터 모드 (개발/테스트용)
      if (useMock) {
        console.log(`[Sync] Using mock data (development mode)`);
        data = generateMockData(ticker, startDate, endDate);
      } else {
        // 실제 API 호출 시도
        const client = new KRXClient();

        console.log(`[Sync] Trying KRX API...`);
        data = await client.getMarketOHLCV(ticker, startDate, endDate);

        if (data.length === 0) {
          console.log(`[Sync] KRX failed, trying Naver API...`);
          data = await client.getMarketOHLCVFromNaver(
            ticker,
            startDate,
            endDate
          );
        }

        // 모든 API 실패 시 Mock 데이터로 폴백
        if (data.length === 0) {
          console.warn(`[Sync] All APIs failed, using mock data as fallback`);
          data = generateMockData(ticker, startDate, endDate);
        }
      }

      if (data.length > 0) {
        await setCachedOHLCV(data);
        console.log(`[Sync] ✅ Cached ${data.length} records for ${ticker}`);
      }
    } else {
      console.log(`[Sync] ✅ Cache hit, ${data.length} records found`);
    }

    return res.status(200).json({
      ticker,
      startDate,
      endDate,
      records: data.length,
      cached: data[0]?.cached_at ? true : false,
      mock: useMock || (!data[0]?.cached_at && data.length > 0),
      data: data.slice(0, 5), // 최근 5개만 응답 (DB에는 전체 저장)
    });
  } catch (error) {
    console.error("[Sync] Error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
