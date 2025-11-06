// api/sync.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { KRXClient, type StockOHLCV } from "../../packages/data/krx-client"; // StockOHLCV 타입 임포트
import { getCachedOHLCV, setCachedOHLCV } from "../../packages/data/cache"; // 캐시 헬퍼

/**
 * Mock 데이터 생성 (개발/테스트용: 실제-like OHLCV, 주말 제외)
 */
function generateMockData(
  ticker: string,
  startDate: string,
  endDate: string
): StockOHLCV[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const data: StockOHLCV[] = [];

  // 종목별 기준가 확장 (실제 가격 근사, 10개 주요 종목)
  const basePrices: Record<string, number> = {
    "005930": 75000, // 삼성전자
    "000660": 150000, // SK하이닉스
    "373220": 350000, // LG에너지솔루션
    "207940": 750000, // 삼성바이오로직스
    "005380": 120000, // 현대차
    "035420": 180000, // NAVER
    "068270": 45000, // 셀트리온
    "086790": 80000, // SK-아이이테크놀로지
    "000270": 30000, // 기아
    "055550": 80000, // 신한지주
  };

  let basePrice = basePrices[ticker] || 50000; // 기본 50k

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    // 주말 제외 (영업일 시뮬)
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    // 랜덤 변동: ±1.5% (현실적)
    const changePercent = (Math.random() - 0.5) * 0.03;
    const open = Math.round(basePrice * (1 + (Math.random() - 0.5) * 0.005)); // open ±0.25%
    const close = Math.round(basePrice * (1 + changePercent));
    const high = Math.round(Math.max(open, close) * (1 + Math.random() * 0.01)); // +1%
    const low = Math.round(Math.min(open, close) * (1 - Math.random() * 0.01)); // -1%
    const volume = Math.floor(10000000 + Math.random() * 20000000); // 10M~30M

    data.push({
      date: d.toISOString().slice(0, 10),
      code: ticker,
      open,
      high,
      low,
      close,
      volume,
      amount: close * volume, // 거래대금 계산
    });

    basePrice = close; // 누적 (트렌드 시뮬)
  }

  console.log(`[Mock] Generated ${data.length} records for ${ticker}`);
  return data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const {
    ticker,
    startDate,
    endDate,
    useMock = false,
  }: {
    ticker?: string;
    startDate?: string;
    endDate?: string;
    useMock?: boolean;
  } = req.body;

  if (!ticker || !startDate || !endDate) {
    return res.status(400).json({
      error: "Missing required fields: ticker, startDate, endDate",
    });
  }

  // 기본 검증 (YYYY-MM-DD)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
  ) {
    return res
      .status(400)
      .json({ error: "Invalid date format (use YYYY-MM-DD)" });
  }

  try {
    console.log(
      `[Sync] Fetching ${ticker} from ${startDate} to ${endDate} (mock: ${useMock})`
    );

    // 1. 캐시 확인 (캐시.ts: TTL 24h, 기간 매칭)
    let data = await getCachedOHLCV(ticker, startDate, endDate);

    // 2. 캐시 미스 시 데이터 수집 (체인: KRX → Naver → Mock)
    if (data.length === 0) {
      // 🔥 Mock 데이터 모드 (개발/테스트용, useMock=true)
      if (useMock) {
        console.log(`[Sync] Using mock data (development mode)`);
        data = generateMockData(ticker, startDate, endDate);
      } else {
        // 실제 API 호출 시도 (KRXClient 통합)
        const client = new KRXClient();

        console.log(`[Sync] Trying KRX API...`);
        try {
          data = await client.getMarketOHLCV(ticker, startDate, endDate);
          console.log(`[Sync] KRX returned ${data.length} records`);
        } catch (krxError) {
          console.warn(`[Sync] KRX failed: ${krxError}`);
          console.log(`[Sync] Trying Naver API...`);
          data = await client.getMarketOHLCVFromNaver(
            ticker,
            startDate,
            endDate
          );
          console.log(`[Sync] Naver returned ${data.length} records`);
        }

        // 모든 API 실패 시 Mock 데이터로 폴백 (안전망)
        if (data.length === 0 || data.length < 100) {
          // 최소 100일 요구
          console.warn(
            `[Sync] All APIs failed/short (<100 records), using mock data as fallback`
          );
          data = generateMockData(ticker, startDate, endDate);
        }
      }

      // 캐시 저장 (성공 시, cached_at 추가)
      if (data.length > 0) {
        data.forEach((d) => {
          d.cached_at = new Date().toISOString();
        }); // 타임스탬프
        await setCachedOHLCV(data);
        console.log(`[Sync] ✅ Cached ${data.length} records for ${ticker}`);
      } else {
        throw new Error("No data generated (mock failed)");
      }
    } else {
      console.log(`[Sync] ✅ Cache hit, ${data.length} records found`);
    }

    // 3. 데이터 길이 검증 (최소 100일, 아니면 에러)
    if (data.length < 100) {
      console.error(`[Sync] Insufficient data (${data.length} records)`);
      return res.status(503).json({
        error:
          "Insufficient data (less than 100 records). Try mock mode or check dates.",
      });
    }

    // 4. 응답 (샘플 5개만, 전체는 캐시/DB)
    return res.status(200).json({
      ticker,
      startDate,
      endDate,
      records: data.length,
      cached: !!data[0]?.cached_at, // 캐시 여부
      mock: useMock || (!data[0]?.cached_at && data.length > 0), // mock 플래그
      sample: data.slice(-5), // 최근 5개 (최신 우선)
    });
  } catch (error) {
    console.error("[Sync] Error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      details: error instanceof Error ? error.message : "Unknown error",
      suggest: "Check ticker/date or set useMock=true for testing.",
    });
  }
}
