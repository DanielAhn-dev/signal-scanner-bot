// packages/data/krx-client.ts (전체: TS7006/TS2552 Fix + All Implicit Any Resolved)
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

interface StockItem {
  code: string;
  name: string;
  market: string;
}

interface VolumeItem {
  code: string;
  name: string;
  volume: number;
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

  // Full ISU_CD 조회 (KR7005930003 형식, empty 방지)
  private async getFullISUCode(ticker: string): Promise<string> {
    try {
      const form = new URLSearchParams({
        bld: "dbms/comm/finder/finder_stkisu", // Stock finder bld (정확)
        mktsel: "ALL",
        searchText: ticker.padStart(6, "0"),
      });
      console.log(`Finder for ${ticker}: ${form.toString().slice(0, 100)}`);
      const data = await this.krxRequest(form, {
        backoffTries: 1,
        backoffStartMs: 100,
      });
      const block = Array.isArray(data.outBlock_1)
        ? data.outBlock_1[0]
        : data.outBlock_1;
      const fullCode =
        block?.FULL_ISU_CD || `KR7${ticker.padStart(6, "0")}0003`; // Fallback 형식 (KR7 + code + 0003)
      console.log(
        `Full code for ${ticker}: ${fullCode} (from ${
          data.outBlock_1?.length || 0
        } items)`
      );
      return fullCode;
    } catch (e: any) {
      console.warn(
        `Full code failed for ${ticker}, fallback: KR7${ticker.padStart(
          6,
          "0"
        )}0003`,
        e
      );
      return `KR7${ticker.padStart(6, "0")}0003`; // 표준 fallback (삼성전자 등 0003)
    }
  }

  // 거래일: 단순 루프 (calendar bld 제거, main 쿼리에서 empty 체크)
  private getRecentTradingDays(): string[] {
    const today = this.getToday();
    const days: string[] = [today];
    for (let i = 1; i <= 3; i++) {
      // 오늘 + 3일 전까지
      const prev = new Date();
      prev.setDate(prev.getDate() - i);
      const prevStr = prev.toISOString().slice(0, 10).replace(/-/g, "");
      days.push(prevStr);
    }
    return days;
  }

  private async krxRequest(
    form: URLSearchParams,
    options: { backoffTries: number; backoffStartMs: number },
    init?: RequestInit
  ): Promise<any> {
    const url = `${this.baseUrl}/comm/bldAttendant/getJsonData.cmd`;
    console.log(
      `KRX POST: ${url}, bld=${form.get("bld")}, params: ${form
        .toString()
        .slice(0, 100)}...`
    );
    let lastError: Error | null = null;
    let delay = options.backoffStartMs;

    for (let i = 0; i <= options.backoffTries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
          method: "POST",
          body: form,
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Referer:
              "http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201",
            "X-Requested-With": "XMLHttpRequest",
            ...init?.headers,
          },
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }
        const data: any = await res.json();
        const block = data.outBlock_1;
        const blockType = typeof block; // 로그 강화: array/object/undefined
        const blockCount = block
          ? Array.isArray(block)
            ? block.length
            : Object.keys(block).length || 1
          : 0;
        console.log(
          `KRX success (try ${
            i + 1
          }): blockType=${blockType}, count=${blockCount}, keys=${JSON.stringify(
            Object.keys(block || {})
          )}`
        );
        if (blockCount === 0)
          console.warn("Empty outBlock_1 - date/bld/mktId check");
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
    console.error("KRX all tries failed - fallback to Naver");
    throw lastError || new Error("KRX all tries failed");
  }

  private mapDaily(ticker: string, output: any): StockOHLCV[] {
    console.log(
      `Mapping daily for ${ticker}: outBlock_1 exists? ${!!output?.outBlock_1}, type=${typeof output?.outBlock_1}`
    );
    if (!output?.outBlock_1) return [];
    let blockData = output.outBlock_1;
    if (!Array.isArray(blockData)) blockData = [blockData]; // Single object → array 변환
    console.log(`Block data length: ${blockData.length}`);
    const data: StockOHLCV[] = blockData
      .map((r: any): StockOHLCV | null => {
        const dateStr = r.TRDT
          ? `${r.TRDT.slice(0, 4)}-${r.TRDT.slice(4, 6)}-${r.TRDT.slice(6, 8)}`
          : "";
        if (!dateStr || dateStr === "0000-00-00") return null;
        const open = parseFloat(r.OPEN_PRC || "0") || 0;
        const high = parseFloat(r.HIGH_PRC || "0") || 0;
        const low = parseFloat(r.LOW_PRC || "0") || 0;
        const close = parseFloat(r.CLOSE_PRC || r.TDD_CLSPRC || "0") || 0;
        const volume =
          parseFloat(r.LIST_CNT || r.VOL_TOT || r.TDD_VOL || "0") || 0; // TDD_VOL 추가
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
      .filter((d: StockOHLCV | null): d is StockOHLCV => d !== null);

    return data.sort((a: StockOHLCV, b: StockOHLCV) =>
      a.date.localeCompare(b.date)
    ); // 타입 명시
  }

  async getStockList(
    market: "KOSPI" | "KOSDAQ" | "ALL" = "ALL"
  ): Promise<StockItem[]> {
    try {
      let form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01501", // Stock list bld (확인됨)
        money: "1",
        csvxls_isNo: "false",
        pageIndex: "1",
        pageSize: market === "ALL" ? "5000" : "2000",
      });
      if (market !== "ALL")
        form.append("mktId", market === "KOSPI" ? "001" : "101"); // mktId 앞당김
      const days = this.getRecentTradingDays();
      let data: any = null;
      for (const day of days) {
        form.set("trdDd", day);
        try {
          data = await this.krxRequest(form, {
            backoffTries: 2,
            backoffStartMs: 300,
          });
          if (
            data.outBlock_1 &&
            (Array.isArray(data.outBlock_1)
              ? data.outBlock_1.length
              : Object.keys(data.outBlock_1).length) > 0
          ) {
            console.log(
              `Stock list success on day ${day}: ${
                data.outBlock_1?.length || 0
              } items`
            );
            break;
          }
        } catch {}
      }
      if (!data?.outBlock_1) throw new Error("All days empty");
      const outBlock = Array.isArray(data.outBlock_1)
        ? data.outBlock_1
        : Object.values(data.outBlock_1 || []);
      const out: StockItem[] = outBlock
        .map((r: any): StockItem | null => {
          // 반환 타입 명시
          const code = String(r.ISU_CD).padStart(6, "0");
          const mkt = r.MKT_TP_NM || "";
          const name = r.ISU_ABBRV || r.SEC_NM || "";
          if (!code || !name || !mkt) return null;
          return {
            code,
            name,
            market: mkt.includes("KOSPI")
              ? "KOSPI"
              : mkt.includes("KOSDAQ")
              ? "KOSDAQ"
              : "KOSPI",
          };
        })
        .filter((s: StockItem | null): s is StockItem => s !== null); // 타입 + guard (TS7006 fix)

      console.log(`Parsed ${out.length} stocks from KRX (${market})`);
      return out.slice(0, 2500);
    } catch (e: any) {
      console.error("KRX stock list failed, fallback Naver:", e);
      return await this._scrapeNaverStockList(market);
    }
  }

  private async _scrapeNaverStockList(
    market: "KOSPI" | "KOSDAQ" | "ALL"
  ): Promise<StockItem[]> {
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
      const out: StockItem[] = [];
      // 2025 Naver 강화: .type_2 + .NavyMap.tlt, tr >5 td, !합계/!선물
      const rows = $(
        "table.type_2 tbody tr, .NavyMap.tlt tbody tr, table.NaviMap1_01 tbody tr"
      ).filter((i, el) => {
        const tds = $(el).find("td");
        return (
          tds.length > 5 &&
          !$(tds[0]).text().includes("합계") &&
          !$(el).text().includes("선물")
        );
      });
      rows.each((_, el: any) => {
        const tds = $(el).find("td");
        if (tds.length > 1) {
          const link = $(tds[1]).find("a").attr("href") || "";
          const codeMatch = link.match(/code=(\d{6})/);
          const code = codeMatch ? codeMatch[1] : "";
          let name = $(tds[1]).text().trim().replace(/\s+/g, " ");
          name = name.replace(/^\d+\s*/, ""); // 번호 제거
          if (code && name && name.length > 1) {
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
      return out.slice(0, 2000).sort(() => Math.random() - 0.5); // 랜덤 shuffle (중복 피함)
    } catch (e: any) {
      console.error("Naver stock list failed:", e);
      return []; // 빈 배열 대신 에러 throw 고려, but fallback
    }
  }

  async getSectorList(): Promise<Sector[]> {
    try {
      let form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01901", // Industry classification bld
        money: "1",
        csvxls_isNo: "false",
      });
      const days = this.getRecentTradingDays();
      let data: any = null;
      for (const day of days) {
        form.set("trdDd", day);
        try {
          data = await this.krxRequest(form, {
            backoffTries: 2,
            backoffStartMs: 250,
          });
          if (
            data.outBlock_1 &&
            (Array.isArray(data.outBlock_1) ? data.outBlock_1.length : 1) > 0
          )
            break;
        } catch {}
      }
      if (!data?.outBlock_1) throw new Error("All days empty for sectors");
      const outBlock = Array.isArray(data.outBlock_1)
        ? data.outBlock_1
        : [data.outBlock_1];
      console.log(`Sector outBlock length: ${outBlock.length}`);
      const sectors: Sector[] = outBlock
        .map((r: any): Sector | null => {
          // 반환 타입 명시
          const name = (r.SECTOR_NM || r.INDSTRY_NM || r.GRP_NM || "").trim();
          const category = (r.GROUP_NM || r.SECTOR_CTGRY || "").trim();
          if (!name || name === "Unknown" || name.length < 1) return null;
          return {
            name,
            category: category || undefined,
          };
        })
        .filter((s: Sector | null): s is Sector => s !== null); // 타입 + guard (TS7006 fix)

      console.log(`Parsed ${sectors.length} sectors from KRX`);
      return sectors.slice(0, 50);
    } catch (e: any) {
      console.error("KRX sector failed, fallback hardcoded:", e);
      // 2025 트렌드 반영 확장 (AI/반도체/바이오 ↑, 50개)
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
      ];
    }
  }

  async getTopVolumeStocks(
    market: "KOSPI" | "KOSDAQ" | "ALL" = "ALL",
    limit = 100
  ): Promise<VolumeItem[]> {
    try {
      let form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01702", // Volume rank bld (fix: 01701 → 01702 for ranking)
        money: "1",
        csvxls_isNo: "false",
        sortType: "VOLSORT", // Volume DESC
        pageIndex: "1",
        pageSize: String(limit),
      });
      const days = this.getRecentTradingDays();
      let data: any = null;
      for (const day of days) {
        form.set("trdDd", day);
        if (market !== "ALL")
          form.set("mktId", market === "KOSPI" ? "001" : "101");
        try {
          data = await this.krxRequest(form, {
            backoffTries: 2,
            backoffStartMs: 300,
          });
          if (
            data.outBlock_1 &&
            (Array.isArray(data.outBlock_1) ? data.outBlock_1.length : 1) >=
              limit / 10
          )
            break; // Partial ok
        } catch {}
      }
      if (!data?.outBlock_1) throw new Error("All days empty for top volume");
      const outBlock = Array.isArray(data.outBlock_1)
        ? data.outBlock_1
        : [data.outBlock_1];
      const out: VolumeItem[] = outBlock
        .map((r: any): VolumeItem | null => {
          // 반환 타입 명시
          const code = String(r.ISU_CD).padStart(6, "0");
          const name = r.ISU_ABBRV || r.SEC_NM || "";
          const volume =
            parseFloat(r.TDD_VOL || r.VOL_TOT || r.ACC_TRDVOL || "0") || 0;
          if (!code || !name || volume <= 0) return null;
          return { code, name, volume };
        })
        .filter((s: VolumeItem | null): s is VolumeItem => s !== null) // 타입 + guard (TS7006 fix)
        .sort((a: VolumeItem, b: VolumeItem) => b.volume - a.volume) // 파라미터 타입 명시 (TS7006 fix)
        .slice(0, limit);

      console.log(
        `Top ${out.length} volume from KRX: ${out[0]?.name || "N/A"} (${
          out[0]?.volume?.toLocaleString() || 0
        })`
      );
      return out;
    } catch (e: any) {
      console.error("Top volume failed, fallback Naver sise:", e);
      // Naver top volume 스크래핑 (sise_rise/fall 대신 market sum)
      return await this._scrapeNaverTopVolume(market, limit);
    }
  }

  // Naver top volume fallback (2025 강화)
  private async _scrapeNaverTopVolume(
    market: "KOSPI" | "KOSDAQ" | "ALL",
    limit = 100
  ): Promise<VolumeItem[]> {
    try {
      const mkt = market === "KOSDAQ" ? "4" : "1";
      const url = `https://finance.naver.com/sise/sise_rise.naver?sosok=${mkt}&page=1`; // Rise page, but volume sort via JS, scrape first 50
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) return [];
      const html = await res.text();
      const $ = cheerio.load(html);
      const out: VolumeItem[] = [];
      $("table.type_2 tr").each((_, el) => {
        const tds = $(el).find("td");
        if (tds.length > 5) {
          const nameEl = $(tds[1]).find("a");
          const name = nameEl.text().trim();
          const codeMatch = nameEl.attr("href")?.match(/code=(\d{6})/);
          const code = codeMatch ? codeMatch[1] : "";
          const volStr = $(tds[6]).text().trim().replace(/,/g, ""); // Volume col (6th)
          const volume = parseFloat(volStr) || 0;
          if (code && name && volume > 0) out.push({ code, name, volume });
        }
      });
      return out
        .slice(0, limit)
        .sort((a: VolumeItem, b: VolumeItem) => b.volume - a.volume); // 타입 명시
    } catch (e: any) {
      console.error("Naver top volume failed:", e);
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
    try {
      const fullCode = await this.getFullISUCode(ticker); // Key fix
      const form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01701", // OHLCV bld (확인)
        locale: "ko_KR",
        isuCd: fullCode, // Full code 사용
        isuCd2: "", // Empty
        strtDd: s,
        endDd: e,
        share: "1",
        money: "1",
        csvxls_isNo: "false",
      });
      let data = await this.krxRequest(form, {
        backoffTries: 3,
        backoffStartMs: 500,
      });
      let ohlcv = this.mapDaily(ticker, data.output || data);
      // Date fallback if empty (rare)
      if (ohlcv.length < 50) {
        console.log(
          `KRX low data (${ohlcv.length}) for ${ticker}, extend date?`
        );
        const extS = new Date(Date.parse(startDate) - 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, "");
        form.set("strtDd", extS);
        data = await this.krxRequest(form, {
          backoffTries: 2,
          backoffStartMs: 300,
        });
        ohlcv = this.mapDaily(ticker, data.output || data).filter(
          (d: StockOHLCV) => new Date(d.date) >= new Date(startDate)
        );
      }
      if (ohlcv.length < 100) {
        console.log(
          `KRX insufficient (${ohlcv.length}), fallback Naver for ${ticker}`
        );
        const fb = await this.getMarketOHLCVFromNaver(
          ticker,
          startDate,
          endDate
        );
        if (fb.length > ohlcv.length) ohlcv = fb;
        else console.warn("Naver also low - check ticker/date");
      }
      console.log(
        `Final OHLCV for ${ticker}: ${ohlcv.length} candles (${startDate} to ${endDate})`
      );
      return ohlcv;
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
        count: "500", // Max 500
        requestType: "0",
      });
      const url = `${this.naverFchart}/sise.nhn?${params.toString()}`;
      console.log(`Naver OHLCV: ${url.slice(0, 100)}...`);
      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!resp.ok) {
        // 오타 fix: res → resp (TS2552 해결)
        console.warn(`Naver fchart HTTP ${resp.status} for ${ticker}`);
        return [];
      }
      const text = await resp.text();
      const items = text.match(/<item data="[^"]*?"/g) || []; // 2025 regex fix: item data
      console.log(`Naver items found: ${items.length} for ${ticker}`);
      const data: StockOHLCV[] = items
        .map((tag): StockOHLCV | null => {
          const m = tag.match(/data="([^"]+)"/);
          if (!m) return null;
          const parts = m[1].split("|");
          if (parts.length < 6) return null;
          const [dStr, o, h, l, c, v] = parts;
          if (!dStr) return null;
          const date = `${dStr.slice(0, 4)}-${dStr.slice(4, 6)}-${dStr.slice(
            6,
            8
          )}`;
          if (date < startDate || date > endDate) return null;
          const close = parseFloat(c) || 0;
          const volume = parseFloat(v) || 0;
          return {
            date,
            code: ticker,
            open: parseFloat(o) || close,
            high: parseFloat(h) || close,
            low: parseFloat(l) || close,
            close,
            volume,
            amount: close * volume,
          };
        })
        .filter((d: StockOHLCV | null): d is StockOHLCV => d !== null);

      console.log(`Naver OHLCV for ${ticker}: ${data.length} candles`);
      return data.sort((a: StockOHLCV, b: StockOHLCV) =>
        a.date.localeCompare(b.date)
      ); // 타입 명시
    } catch (e: any) {
      console.error(`Naver OHLCV failed for ${ticker}:`, e);
      return [];
    }
  }

  async getDailyPrice(
    code: string
  ): Promise<{ close: number; volume: number; date: string } | null> {
    try {
      const fullCode = await this.getFullISUCode(code);
      const days = this.getRecentTradingDays();
      let block: any = null;
      for (const day of days) {
        const form = new URLSearchParams({
          bld: "dbms/MDC/STAT/standard/MDCSTAT02601", // Daily price bld
          trdDd: day,
          isuCd: fullCode,
          money: "1",
          csvxls_isNo: "false",
        });
        const data = await this.krxRequest(form, {
          backoffTries: 1,
          backoffStartMs: 100,
        });
        block = Array.isArray(data.outBlock_1)
          ? data.outBlock_1[0]
          : data.outBlock_1;
        if (block && parseFloat(block.TDD_CLSPRC || "0") > 0) break;
      }
      if (!block) return null;
      return {
        close: parseFloat(block.TDD_CLSPRC || "0") || 0,
        volume: parseFloat(block.TDD_VOL || block.VOL_TOT || "0") || 0,
        date: block.TRD_DD || days[0],
      };
    } catch (e: any) {
      console.error(`Daily price failed for ${code}:`, e);
      return null;
    }
  }
}

export default KRXClient;
