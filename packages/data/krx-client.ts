// packages/data/krx-client.ts (전체: Cheerio any + Sector 타입 정의)
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

// Sector 타입 정의 (TS2677 해결: 가드 호환 명시)
interface Sector {
  name: string;
  category?: string | undefined;
}

export class KRXClient {
  private baseUrl = "http://data.krx.co.kr";
  private naverFchart = "https://fchart.stock.naver.com";
  private naverSise = "https://finance.naver.com";

  private getToday(): string {
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  }

  private async krxRequest(
    form: URLSearchParams,
    options: { backoffTries: number; backoffStartMs: number },
    init?: RequestInit
  ): Promise<any> {
    const url = `${
      this.baseUrl
    }/comm/bldAttendant/getJsonData.cmd?${form.toString()}`;
    console.log(`KRX request: ${url.slice(0, 100)}...`);
    let lastError: Error | null = null;
    let delay = options.backoffStartMs;

    for (let i = 0; i <= options.backoffTries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            ...init?.headers,
          },
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const data: any = await res.json();
        console.log(
          `KRX success (try ${i + 1}): ${Object.keys(data).length} blocks`
        );
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
    throw lastError || new Error("KRX all tries failed");
  }

  private mapDaily(ticker: string, output: any): StockOHLCV[] {
    if (!output?.outBlock_1) return [];
    const blockData = output.outBlock_1 as any[];
    const data: StockOHLCV[] = blockData
      .map((r: any) => {
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
      .filter((d): d is StockOHLCV => d !== null);

    return data.sort((a, b) => a.date.localeCompare(b.date));
  }

  async getStockList(
    market: "KOSPI" | "KOSDAQ" | "ALL" = "ALL"
  ): Promise<{ code: string; name: string; market: string }[]> {
    try {
      console.log(`Parsing KRX stock list for ${market}...`);
      let form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01501",
        trdDd: this.getToday(),
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
        backoffTries: 2,
        backoffStartMs: 250,
      });
      const outBlock = (data.outBlock_1 as any[]) || [];
      const out: { code: string; name: string; market: string }[] = outBlock
        .map((r: any) => {
          const code = String(r.ISU_CD).padStart(6, "0");
          const mkt = r.MKT_TP_NM || "";
          return {
            code,
            name: r.ISU_ABBRV || r.SEC_NM || "",
            market: mkt.includes("KOSPI") ? "KOSPI" : "KOSDAQ",
          };
        })
        .filter(
          (s): s is { code: string; name: string; market: string } =>
            !!s.code && !!s.name && !!s.market
        );
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
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      if (!res.ok) throw new Error(`Naver HTTP ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);
      const out: { code: string; name: string; market: string }[] = [];
      $("table.type_2 tbody tr").each((_, el: any) => {
        // el: any (TS2305 해결: 타입 export 피함)
        const tds = $(el).find("td");
        if (tds.length > 1) {
          const link = $(tds[1]).find("a").attr("href") || "";
          const codeMatch = link.match(/code=(\d{6})/);
          const code = codeMatch ? codeMatch[1] : "";
          const name = $(tds[1]).text().trim();
          if (code && name && name !== "N") {
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
      return [];
    }
  }

  async getSectorList(): Promise<Sector[]> {
    // Sector 반환 타입 명시
    try {
      const form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01901",
        trdDd: this.getToday(),
        money: "1",
        csvxls_isNo: "false",
      });
      const data = await this.krxRequest(form, {
        backoffTries: 1,
        backoffStartMs: 100,
      });
      const outBlock = (data.outBlock_1 as any[]) || [];
      const sectors: Sector[] = outBlock
        .map(
          (r: any): Sector => ({
            // as Sector (명시 캐스팅, TS2677 해결)
            name: r.SECTOR_NM || r.INDSTRY_NM || "",
            category: (r.GROUP_NM as string) ?? undefined, // 타입 단언 + undefined
          })
        )
        .filter(
          (s): s is Sector => s.name.trim() !== "" // 가드: Sector와 정확 호환
        );

      console.log(`Parsed ${sectors.length} sectors from KRX`);
      return sectors.slice(0, 50);
    } catch (e: any) {
      console.error("KRX sector failed, fallback hardcoded:", e);
      // 하드코드: Sector[] 타입
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
      ];
    }
  }

  async getTopVolumeStocks(
    market: "KOSPI" | "KOSDAQ" | "ALL" = "ALL",
    limit = 100
  ): Promise<{ code: string; name: string; volume: number }[]> {
    try {
      let form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01701",
        trdDd: this.getToday(),
        money: "1",
        csvxls_isNo: "false",
        sortType: "1",
        pageIndex: "1",
        pageSize: String(limit),
      });
      if (market !== "ALL") {
        const mktCd = market === "KOSPI" ? "001" : "101";
        form.append("mktId", mktCd);
      }
      const data = await this.krxRequest(form, {
        backoffTries: 2,
        backoffStartMs: 250,
      });
      const outBlock = (data.outBlock_1 as any[]) || [];
      const out = outBlock
        .map((r: any) => ({
          code: String(r.ISU_CD).padStart(6, "0"),
          name: r.ISU_ABBRV || r.SEC_NM || "",
          volume: parseFloat(r.TRDVAL || r.VOL_TOT || "0") || 0,
        }))
        .filter(
          (s): s is { code: string; name: string; volume: number } =>
            !!s.code && s.volume > 0
        )
        .sort((a, b) => b.volume - a.volume)
        .slice(0, limit);

      console.log(
        `Top ${out.length} volume from KRX: ${out[0]?.name || "N/A"}`
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
      bld: "dbms/MDC/STAT/standard/MDCSTAT01701",
      locale: "ko_KR",
      isuCd: `KR7${ticker}0`,
      isuCd2: ticker,
      strtDd: s,
      endDd: e,
      share: "1",
      money: "1",
      csvxls_isNo: "false",
    });

    try {
      const primary = await this.krxRequest(form, {
        backoffTries: 2,
        backoffStartMs: 250,
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
        count: "500",
        requestType: "0",
      });
      const url = `https://fchart.stock.naver.com/sise.nhn?${params.toString()}`;
      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      if (!resp.ok) {
        console.warn(`Naver fchart HTTP ${resp.status} for ${ticker}`);
        return [];
      }
      const text = await resp.text();
      const items = text.match(/<item\s+data="[^"]+"\s*\/>/g) || [];
      const data: StockOHLCV[] = items
        .map((tag): StockOHLCV | null => {
          const m = tag.match(/data="([^"]+)"/);
          if (!m) return null;
          const parts = m[1].split("|");
          if (parts.length < 6) return null;
          const [d, o, h, l, c, v] = parts;
          const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
          if (date < startDate || date > endDate) return null;
          return {
            date,
            code: ticker,
            open: parseFloat(o) || 0,
            high: parseFloat(h) || 0,
            low: parseFloat(l) || 0,
            close: parseFloat(c) || 0,
            volume: parseFloat(v) || 0,
            amount: (parseFloat(c) || 0) * (parseFloat(v) || 0),
          };
        })
        .filter((d): d is StockOHLCV => d !== null);

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
      const form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT02601",
        trdDd: this.getToday(),
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
        volume: parseFloat(block.TDD_HGPRC || "0") || 0,
        date: block.TRD_DD || this.getToday(),
      };
    } catch (e: any) {
      console.error("Daily price failed for " + code + ":", e);
      return null;
    }
  }
}

export default KRXClient;
