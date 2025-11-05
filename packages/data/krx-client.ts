import type { StockOHLCV, StockInfo, TopStock } from "./types";

// KRX API 응답 타입 정의
interface KRXResponse {
  output?: any[];
  OutBlock_1?: any[];
  CURRENT_DATETIME?: string;
  [key: string]: any;
}

export class KRXClient {
  private krxURL = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

  /**
   * 전체 상장 종목 리스트 조회
   */
  async getStockList(
    market: "STK" | "KSQ" | "ALL" = "ALL"
  ): Promise<StockInfo[]> {
    const body = new URLSearchParams({
      bld: "dbms/MDC/STAT/standard/MDCSTAT01901",
      locale: "ko_KR",
      mktId: market,
      share: "1",
      csvxls_isNo: "false",
    });

    try {
      const response = await fetch(this.krxURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
          Referer: "http://data.krx.co.kr",
        },
        body: body.toString(),
      });

      const json = (await response.json()) as KRXResponse;
      const data = json.output || json.OutBlock_1 || [];

      return data.map((item: any) => ({
        code: item.ISU_SRT_CD,
        name: item.ISU_ABBRV,
        market:
          item.MKT_NM === "KOSPI"
            ? ("KOSPI" as const)
            : item.MKT_NM === "KOSDAQ"
            ? ("KOSDAQ" as const)
            : ("KONEX" as const),
      }));
    } catch (error) {
      console.error("[KRX] Failed to fetch stock list:", error);
      return [];
    }
  }

  /**
   * 종목별 일봉 OHLCV 조회 (KRX API)
   */
  async getMarketOHLCV(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    // 날짜 포맷 변환: YYYY-MM-DD → YYYYMMDD
    const fromDt = startDate.replace(/-/g, "");
    const toDt = endDate.replace(/-/g, "");

    // KRX는 종목코드 앞에 'KR' + 6자리 코드를 사용
    const isuCd = `KR7${ticker}0`;

    const body = new URLSearchParams({
      bld: "dbms/MDC/STAT/standard/MDCSTAT01701",
      locale: "ko_KR",
      isuCd: isuCd,
      isuCd2: ticker,
      strtDd: fromDt,
      endDd: toDt,
      share: "1",
      money: "1",
      csvxls_isNo: "false",
    });

    try {
      console.log(
        `[KRX] Fetching ${ticker} (${isuCd}) from ${fromDt} to ${toDt}`
      );

      const response = await fetch(this.krxURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
          Referer: "http://data.krx.co.kr",
        },
        body: body.toString(),
      });

      const json = (await response.json()) as KRXResponse;
      console.log(`[KRX] Response:`, JSON.stringify(json).slice(0, 200));

      // output 또는 OutBlock_1 필드에서 데이터 추출
      const rawData = json.output || json.OutBlock_1 || [];

      if (rawData.length === 0) {
        console.warn(`[KRX] No data found for ${ticker}`);
        return [];
      }

      const data: StockOHLCV[] = rawData.map((item: any) => {
        const date = item.TRD_DD; // YYYYMMDD 또는 YYYY/MM/DD
        const formattedDate = date.includes("/")
          ? date.replace(/\//g, "-")
          : `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

        return {
          date: formattedDate,
          code: ticker,
          open: parseFloat(
            (item.TDD_OPNPRC || item.OPNPRC || "0").toString().replace(/,/g, "")
          ),
          high: parseFloat(
            (item.TDD_HGPRC || item.HGPRC || "0").toString().replace(/,/g, "")
          ),
          low: parseFloat(
            (item.TDD_LWPRC || item.LWPRC || "0").toString().replace(/,/g, "")
          ),
          close: parseFloat(
            (item.TDD_CLSPRC || item.CLSPRC || "0").toString().replace(/,/g, "")
          ),
          volume: parseInt(
            (item.ACC_TRDVOL || item.TRDVOL || "0")
              .toString()
              .replace(/,/g, ""),
            10
          ),
          amount: parseInt(
            (item.ACC_TRDVAL || item.TRDVAL || "0")
              .toString()
              .replace(/,/g, ""),
            10
          ),
        };
      });

      console.log(
        `[KRX] Successfully fetched ${data.length} records for ${ticker}`
      );
      return data.reverse(); // 날짜 오름차순 정렬
    } catch (error) {
      console.error(`[KRX] Failed to fetch OHLCV for ${ticker}:`, error);
      return [];
    }
  }

  /**
   * 거래대금 상위 종목 조회
   */
  async getTopVolumeStocks(
    market: "STK" | "KSQ" = "STK",
    limit: number = 20
  ): Promise<TopStock[]> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const body = new URLSearchParams({
      bld: "dbms/MDC/STAT/standard/MDCSTAT01501",
      locale: "ko_KR",
      mktId: market,
      trdDd: today,
      share: "1",
      money: "1",
      csvxls_isNo: "false",
    });

    try {
      const response = await fetch(this.krxURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
          Referer: "http://data.krx.co.kr",
        },
        body: body.toString(),
      });

      const json = (await response.json()) as KRXResponse;
      const rawData = json.output || json.OutBlock_1 || [];

      return rawData.slice(0, limit).map((item: any) => ({
        code: item.ISU_SRT_CD,
        name: item.ISU_ABBRV,
        close: parseFloat(
          (item.TDD_CLSPRC || "0").toString().replace(/,/g, "")
        ),
        change: parseFloat(item.FLUC_RT || "0"),
        volume: parseInt(
          (item.ACC_TRDVOL || "0").toString().replace(/,/g, ""),
          10
        ),
        amount: parseInt(
          (item.ACC_TRDVAL || "0").toString().replace(/,/g, ""),
          10
        ),
      }));
    } catch (error) {
      console.error("[KRX] Failed to fetch top volume stocks:", error);
      return [];
    }
  }

  /**
   * 네이버 금융 API 사용 (대안)
   */
  async getMarketOHLCVFromNaver(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    try {
      // 네이버 금융 차트 API
      const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${ticker}&timeframe=day&count=100&requestType=0`;

      const response = await fetch(url);
      const text = await response.text();

      console.log("[Naver] Response:", text.slice(0, 200));

      // XML 파싱 (간단한 정규식 사용)
      const items = text.match(/<item data="([^"]+)"\/>/g) || [];

      const data: StockOHLCV[] = items
        .map((item) => {
          const match = item.match(/data="([^"]+)"/);
          if (!match) return null;

          const [dateStr, open, high, low, close, volume] = match[1].split("|");
          const date = `${dateStr.slice(0, 4)}-${dateStr.slice(
            4,
            6
          )}-${dateStr.slice(6, 8)}`;

          return {
            date,
            code: ticker,
            open: parseInt(open),
            high: parseInt(high),
            low: parseInt(low),
            close: parseInt(close),
            volume: parseInt(volume),
            amount: parseInt(close) * parseInt(volume),
          };
        })
        .filter((item): item is StockOHLCV => item !== null);

      // 날짜 범위 필터링
      return data.filter((d) => d.date >= startDate && d.date <= endDate);
    } catch (error) {
      console.error("[Naver] Failed to fetch OHLCV:", error);
      return [];
    }
  }
}
