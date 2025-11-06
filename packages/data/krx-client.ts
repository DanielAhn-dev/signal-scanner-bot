// packages/data/krx-client.ts (전체: Filter 타입 명시 + Implicit Any 해결)
import * as cheerio from "cheerio";

export interface StockOHLCV {
  date: string;
  code: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  cached_at?: string;
}

interface Sector {
  name: string;
  category?: string | undefined;
}

export class KRXClient {
  private baseUrl = "http://data.krx.co.kr";
  private naverFchart = "https://fchart.stock.naver.com";
  private naverSise = "https://finance.naver.com";

  private getToday(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  // 최근 거래일 fallback (비거래일 시 전일)
  private async getRecentTradingDay(): Promise<string> {
    let date = this.getToday();
    for (let i = 0; i < 5; i++) {
      // 5일 전까지 시도
      try {
        // 간단 KRX 캘린더 쿼리 (MDCSTAT01101: 거래일 확인)
        const form = new URLSearchParams({
          bld: "dbms/MDC/STAT/calendar/MDCSTAT01101",
          trdDd: date,
          money: "1",
          csvxls_isNo: "false",
        });
        const data = await this.krxRequest(form, {
          backoffTries: 0,
          backoffStartMs: 100,
        });
        if (
          data.outBlock_1 &&
          data.outBlock_1.length > 0 &&
          data.outBlock_1[0].TR_ISO_YMD === date
        ) {
          return date;
        }
      } catch {}
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() - 1);
      date = prevDate.toISOString().slice(0, 10).replace(/-/g, "");
    }
    return date; // fallback 최근일
  }

  private async krxRequest(
    form: URLSearchParams,
    options: { backoffTries: number; backoffStartMs: number },
    init?: RequestInit
  ): Promise<any> {
    const url = `${this.baseUrl}/comm/bldAttendant/getJsonData.cmd`;
    console.log(
      `KRX POST: ${url}, params: ${form.toString().slice(0, 100)}...`
    );
    let lastError: Error | null = null;
    let delay = options.backoffStartMs;

    for (let i = 0; i <= options.backoffTries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s ↑
        const res = await fetch(url, {
          method: "POST", // POST 전환 (KRX 요구)
          body: form, // Form Data
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Referer:
              "http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201", // KRX 메인 Referer
            "X-Requested-With": "XMLHttpRequest", // AJAX 흉내
            ...init?.headers,
          },
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }
        const data: any = await res.json();
        const blockCount = data.outBlock_1
          ? Object.keys(data.outBlock_1).length ||
            (Array.isArray(data.outBlock_1) ? data.outBlock_1.length : 0)
          : 0;
        console.log(`KRX success (try ${i + 1}): ${blockCount} blocks/items`);
        if (blockCount === 0)
          console.warn("Empty outBlock_1 - check params/date");
        return data;
      } catch (e: any) {
        lastError = e;
        console.warn(`KRX try ${i + 1} failed: ${e.message}`);
        if (i < options.backoffTries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }
    console.error("KRX all tries failed - fallback to Naver/hardcode");
    throw lastError || new Error("KRX all tries failed");
  }

  private mapDaily(ticker: string, output: any): StockOHLCV[] {
    console.log(
      `Mapping daily for ${ticker}: outBlock_1 exists? ${!!output?.outBlock_1}`
    );
    if (!output?.outBlock_1) return [];
    const blockData = Array.isArray(output.outBlock_1) ? output.outBlock_1 : [];
    console.log(`Block data length: ${blockData.length}`);
    const data: StockOHLCV[] = blockData
      .map((r: any): StockOHLCV | null => {
        // 반환 타입 명시
        const dateStr = r.TRDT
          ? `${r.TRDT.slice(0, 4)}-${r.TRDT.slice(4, 6)}-${r.TRDT.slice(6, 8)}`
          : "";
        if (!dateStr || dateStr === "0000-00-00") return null;
        const open = parseFloat(r.OPEN_PRC || "0") || 0;
        const high = parseFloat(r.HIGH_PRC || "0") || 0;
        const low = parseFloat(r.LOW_PRC || "0") || 0;
        const close = parseFloat(r.CLOSE_PRC || r.TDD_CLSPRC || "0") || 0;
        const volume = parseFloat(r.LIST_CNT || r.VOL_TOT || "0") || 0;
        const amount = close * volume;
        return {
          date: dateStr,
          code: ticker,
          open,
          high,
          low,
          close,
          volume,
          amount,
        };
      })
      .filter((d: StockOHLCV | null): d is StockOHLCV => d !== null); // 파라미터 + 가드 타입 명시 (TS7006 해결)

    return data.sort((a, b) => a.date.localeCompare(b.date));
  }

  async getStockList(
    market: "KOSPI" | "KOSDAQ" | "ALL" = "ALL"
  ): Promise<{ code: string; name: string; market: string }[]> {
    try {
      const trdDd = await this.getRecentTradingDay();
      console.log(`Using trading day: ${trdDd} for stock list`);
      let form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01501",
        trdDd,
        money: "1",
        csvxls_isNo: "false",
        pageIndex: "1",
        pageSize: market === "ALL" ? "5000" : "2000",
      });
      if (market !== "ALL") {
        const mktCd = market === "KOSPI" ? "001" : "101";
        form.append("mktId", mktCd);
      }
      const data = await this.krxRequest(form, {
        backoffTries: 3,
        backoffStartMs: 500,
      }); // tries ↑
      const outBlock = (data.outBlock_1 as any[]) || [];
      const out: { code: string; name: string; market: string }[] = outBlock
        .map((r: any) => {
          const code = String(r.ISU_CD).padStart(6, "0");
          const mkt = r.MKT_TP_NM || "";
          return {
            code,
            name: r.ISU_ABBRV || r.SEC_NM || "",
            market: mkt.includes("KOSPI")
              ? "KOSPI"
              : mkt.includes("KOSDAQ")
              ? "KOSDAQ"
              : "KOSPI", // KONEX 필터
          };
        })
        .filter(
          (s): s is { code: string; name: string; market: string } =>
            !!s.code && !!s.name && !!s.market
        ); // 가드 ok (명시 없어도 any 피함)
      console.log(`Parsed ${out.length} stocks from KRX (${market})`);
      return out.slice(0, 2500);
    } catch (e: any) {
      console.error("KRX stock list failed, fallback Naver:", e);
      return await this._scrapeNaverStockList(market);
    }
  }

  private async _scrapeNaverStockList(
    market: "KOSPI" | "KOSDAQ" | "ALL"
  ): Promise<{ code: string; name: string; market: string }[]> {
    try {
      const mktParam =
        market === "ALL"
          ? ""
          : market === "KOSPI"
          ? "&exchangeCode=1"
          : "&exchangeCode=4";
      const url = `https://finance.naver.com/sise/sise_market.sise?tableType=DEFAULT${mktParam}`;
      console.log(`Naver stock list: ${url}`);
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) throw new Error(`Naver HTTP ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);
      const out: { code: string; name: string; market: string }[] = [];
      // 2025 Naver: table.type_2 or .NavyMap.tlt, tr 필터 (헤더/푸터 skip)
      const rows = $("table.type_2 tbody tr, .NavyMap.tlt tbody tr").filter(
        (i, el) => $(el).find("td").length > 5
      ); // 강화
      rows.each((_, el: any) => {
        const tds = $(el).find("td");
        if (tds.length > 1) {
          const link = $(tds[1]).find("a").attr("href") || "";
          const codeMatch = link.match(/code=(\d{6})/);
          const code = codeMatch ? codeMatch[1] : "";
          const name = $(tds[1]).text().trim().replace(/\s+/g, " "); // 공백 정리
          if (
            code &&
            name &&
            name.length > 1 &&
            !name.includes("합계") &&
            !name.includes("선물")
          ) {
            // 필터 강화
            const mktOut =
              market === "KOSDAQ" || url.includes("exchangeCode=4")
                ? "KOSDAQ"
                : "KOSPI";
            out.push({ code, name, market: mktOut });
          }
        }
      });
      console.log(
        `Fallback parsed ${out.length} stocks from Naver (${market})`
      );
      return out.slice(0, 2000);
    } catch (e: any) {
      console.error("Naver stock list failed:", e);
      return []; // 빈 대신 에러 throw 고려
    }
  }

  async getSectorList(): Promise<Sector[]> {
    try {
      const trdDd = await this.getRecentTradingDay();
      const form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01901",
        trdDd,
        money: "1",
        csvxls_isNo: "false",
      });
      const data = await this.krxRequest(form, {
        backoffTries: 2,
        backoffStartMs: 250,
      });
      const outBlock = (data.outBlock_1 as any[]) || [];
      console.log(`Sector outBlock length: ${outBlock.length}`);
      const sectors: Sector[] = outBlock
        .map(
          (r: any): Sector => ({
            name: (r.SECTOR_NM || r.INDSTRY_NM || "").trim() || "Unknown",
            category: (r.GROUP_NM as string)?.trim() ?? undefined,
          })
        )
        .filter((s): s is Sector => s.name !== "" && s.name !== "Unknown");

      console.log(`Parsed ${sectors.length} sectors from KRX`);
      return sectors.slice(0, 50);
    } catch (e: any) {
      console.error("KRX sector failed, fallback hardcoded:", e);
      // 확장 하드코드 (50개, 2025 트렌드 반영: AI/반도체 ↑)
      return [
        { name: "반도체", category: "IT" },
        { name: "바이오", category: "Healthcare" },
        { name: "2차전지", category: "Energy" },
        { name: "AI", category: "IT" },
        { name: "자동차", category: "Manufacturing" },
        { name: "금융", category: "Finance" },
        { name: "통신", category: "IT" },
        { name: "건설", category: "Real Estate" },
        { name: "에너지", category: "Energy" },
        { name: "소재", category: "Materials" },
        { name: "화학", category: "Chemicals" },
        { name: "증권", category: "Finance" },
        { name: "은행", category: "Finance" },
        { name: "보험", category: "Finance" },
        { name: "유통", category: "Retail" },
        { name: "IT서비스", category: "IT" },
        { name: "미디어", category: "Media" },
        { name: "엔터테인먼트", category: "Media" },
        { name: "게임", category: "Entertainment" },
        { name: "의료기기", category: "Healthcare" },
        { name: "제약", category: "Healthcare" },
        { name: "신재생에너지", category: "Energy" },
        { name: "로봇", category: "Manufacturing" },
        { name: "메타버스", category: "IT" },
        { name: "클라우드", category: "IT" },
        { name: "반도체장비", category: "IT" },
        { name: "디스플레이", category: "IT" },
        { name: "인터넷", category: "IT" },
        { name: "바이오의약", category: "Healthcare" },
        { name: "전기전자", category: "Manufacturing" },
        { name: "운송", category: "Transportation" },
        { name: "호텔외식", category: "Consumer" },
        { name: "교육서비스", category: "Services" },
        { name: "기계", category: "Manufacturing" },
        { name: "IT부품", category: "IT" },
        { name: "의류", category: "Consumer" },
        { name: "유틸리티", category: "Energy" },
        { name: "방송서비스", category: "Media" },
        { name: "마이크로바이오", category: "Healthcare" },
        { name: "조선", category: "Manufacturing" },
        { name: "섬유", category: "Materials" },
        { name: "항공", category: "Transportation" },
        { name: "전자부품", category: "IT" },
        { name: "증권중개", category: "Finance" },
        { name: "멀티미디어", category: "IT" },
        { name: "인테리어", category: "Real Estate" },
        { name: "BTI", category: "IT" },
        { name: "블록체인", category: "IT" },
        { name: "자원", category: "Materials" },
      ].slice(0, 50); // 50개
    }
  }

  async getTopVolumeStocks(
    market: "KOSPI" | "KOSDAQ" | "ALL" = "ALL",
    limit = 100
  ): Promise<{ code: string; name: string; volume: number }[]> {
    try {
      const trdDd = await this.getRecentTradingDay();
      let form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01701",
        trdDd,
        money: "1",
        csvxls_isNo: "false",
        sortType: "1", // volume DESC
        pageIndex: "1",
        pageSize: String(limit),
      });
      if (market !== "ALL") {
        const mktCd = market === "KOSPI" ? "001" : "101";
        form.append("mktId", mktCd);
      }
      const data = await this.krxRequest(form, {
        backoffTries: 3,
        backoffStartMs: 500,
      });
      const outBlock = (data.outBlock_1 as any[]) || [];
      const out = outBlock
        .map((r: any) => ({
          code: String(r.ISU_CD).padStart(6, "0"),
          name: r.ISU_ABBRV || r.SEC_NM || "",
          volume: parseFloat(r.TRDVAL || r.VOL_TOT || "0") || 0, // TRDVAL: 거래대금
        }))
        .filter(
          (s): s is { code: string; name: string; volume: number } =>
            !!s.code && s.volume > 0
        ) // 가드 ok
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit);

      console.log(
        `Top ${out.length} volume from KRX: ${out[0]?.name || "N/A"} (${(
          out[0]?.volume || 0
        ).toLocaleString()})`
      );
      return out;
    } catch (e: any) {
      console.error("Top volume failed:", e);
      return [];
    }
  }

  async getMarketOHLCV(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    const s = startDate.replace(/-/g, "");
    const e = endDate.replace(/-/g, "");
    const form = new URLSearchParams({
      bld: "dbms/MDC/STAT/standard/MDCSTAT01701", // Daily OHLCV
      locale: "ko_KR",
      isuCd: `KR7${ticker}0`,
      isuCd2: ticker.padStart(6, "0"),
      strtDd: s,
      endDd: e,
      share: "1",
      money: "1",
      csvxls_isNo: "false",
    });

    try {
      const primary = await this.krxRequest(form, {
        backoffTries: 3,
        backoffStartMs: 500,
      });
      let data = this.mapDaily(ticker, primary.output || primary);

      if (data.length < 200) {
        console.log(
          `KRX insufficient (${data.length}), fallback Naver for ${ticker}`
        );
        const fb = await this.getMarketOHLCVFromNaver(
          ticker,
          startDate,
          endDate
        );
        if (fb.length > data.length) data = fb;
        else console.warn("Naver also insufficient - extend date range?");
      }

      console.log(
        `Final OHLCV for ${ticker}: ${data.length} candles (${startDate} to ${endDate})`
      );
      return data;
    } catch (e: any) {
      console.error(`getMarketOHLCV failed for ${ticker}:`, e);
      return await this.getMarketOHLCVFromNaver(ticker, startDate, endDate);
    }
  }

  async getMarketOHLCVFromNaver(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    try {
      const params = new URLSearchParams({
        symbol: ticker,
        timeframe: "day",
        count: "500", // max 500
        requestType: "0",
      });
      const url = `https://fchart.stock.naver.com/sise.nhn?${params.toString()}`;
      console.log(`Naver OHLCV: ${url}`);
      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!resp.ok) {
        console.warn(`Naver fchart HTTP ${resp.status} for ${ticker}`);
        return [];
      }
      const text = await resp.text();
      const items = text.match(/<item\s+data="[^"]+"\s*\/>/g) || [];
      console.log(`Naver items found: ${items.length}`);
      const data: StockOHLCV[] = items
        .map((tag): StockOHLCV | null => {
          // 반환 타입 명시
          const m = tag.match(/data="([^"]+)"/);
          if (!m) return null;
          const parts = m[1].split("|");
          if (parts.length < 6) return null;
          const [d, o, h, l, c, v] = parts;
          const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
          if (date < startDate || date > endDate) return null;
          const close = parseFloat(c) || 0;
          const volume = parseFloat(v) || 0;
          return {
            date,
            code: ticker,
            open: parseFloat(o) || 0,
            high: parseFloat(h) || 0,
            low: parseFloat(l) || 0,
            close,
            volume,
            amount: close * volume,
          };
        })
        .filter((d: StockOHLCV | null): d is StockOHLCV => d !== null); // 파라미터 + 가드 타입 명시 (TS7006 유사 해결)

      console.log(`Naver OHLCV for ${ticker}: ${data.length} candles`);
      return data.sort((a, b) => a.date.localeCompare(b.date));
    } catch (e: any) {
      console.error(`Naver OHLCV failed for ${ticker}:`, e);
      return [];
    }
  }

  async getDailyPrice(
    code: string
  ): Promise<{ close: number; volume: number; date: string } | null> {
    try {
      const trdDd = await this.getRecentTradingDay();
      const form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT02601",
        trdDd,
        isuCd: code,
        money: "1",
        csvxls_isNo: "false",
      });
      const data = await this.krxRequest(form, {
        backoffTries: 1,
        backoffStartMs: 100,
      });
      const block = (data.outBlock_1 as any[])[0];
      if (!block) return null;
      return {
        close: parseFloat(block.TDD_CLSPRC || "0") || 0,
        volume: parseFloat(block.TDD_VOL || "0") || 0, // VOL_TOT or TDD_VOL
        date: block.TRD_DD || trdDd,
      };
    } catch (e: any) {
      console.error(`Daily price failed for ${code}:`, e);
      return null;
    }
  }
}

export default KRXClient;
