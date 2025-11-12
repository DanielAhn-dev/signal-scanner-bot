import * as cheerio from "cheerio";

type StockMeta = { name: string | null; market: string | null };

export interface StockOHLCV {
  date: string;
  code: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}
interface Sector {
  name: string;
  category?: string;
}
interface StockItem {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "KONEX" | "K-OTC" | string;
}
interface VolumeItem {
  code: string;
  name: string;
  volume: number;
}

export default class KRXClient {
  private baseUrl = "http://data.krx.co.kr";
  private naverFchart = "https://fchart.stock.naver.com";
  private naverSise = "https://finance.naver.com";

  private todayYYYYMMDD(): string {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}${String(d.getDate()).padStart(2, "0")}`;
  }

  private buildISIN(code6: string) {
    return `KR7${code6.padStart(6, "0")}0003`;
  }

  private yyyymmdd(d: Date) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}${String(d.getDate()).padStart(2, "0")}`;
  }

  private splitPeriods(
    startYYYYMMDD: string,
    endYYYYMMDD: string,
    yearsPerChunk = 3
  ) {
    const out: Array<{ from: string; to: string }> = [];
    const s = new Date(
      `${startYYYYMMDD.slice(0, 4)}-${startYYYYMMDD.slice(
        4,
        6
      )}-${startYYYYMMDD.slice(6, 8)}`
    );
    const e = new Date(
      `${endYYYYMMDD.slice(0, 4)}-${endYYYYMMDD.slice(
        4,
        6
      )}-${endYYYYMMDD.slice(6, 8)}`
    );
    let cur = new Date(s);
    while (cur <= e) {
      const to = new Date(cur);
      to.setFullYear(to.getFullYear() + yearsPerChunk);
      if (to > e) to.setTime(e.getTime());
      out.push({ from: this.yyyymmdd(cur), to: this.yyyymmdd(to) });
      to.setDate(to.getDate() + 1);
      cur = new Date(to);
    }
    return out;
  }

  private getRecentTradingDays(): string[] {
    const days = [this.todayYYYYMMDD()];
    for (let i = 1; i <= 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(this.yyyymmdd(d));
    }
    return days;
  }

  private async krxRequest(
    form: URLSearchParams,
    options: { backoffTries: number; backoffStartMs: number },
    init?: RequestInit
  ): Promise<any> {
    const url = `${this.baseUrl}/comm/bldAttendant/getJsonData.cmd`;
    let lastErr: any = null;
    let delay = options.backoffStartMs;
    for (let i = 0; i <= options.backoffTries; i++) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 15000);
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
        clearTimeout(t);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
        }
        const data: any = await res.json();
        return data;
      } catch (e: any) {
        lastErr = e;
        if (i < options.backoffTries) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
        throw lastErr;
      }
    }
    throw lastErr ?? new Error("Unknown KRX error");
  }

  private mapDaily(ticker: string, output: any): StockOHLCV[] {
    const block = output?.outBlock_1 ?? output?.output ?? [];
    const arr = Array.isArray(block) ? block : block ? [block] : [];
    const out: StockOHLCV[] = arr
      .map((r: any) => {
        const d = r.TRDT || r.TRD_DD || r.STCK_BSOP_DATE || "";
        if (!/^\d{8}$/.test(d)) return null;
        const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        const open =
          parseFloat(r.OPEN_PRC ?? r.TDD_OPNPRC ?? r.STCK_OPRC ?? "0") || 0;
        const high =
          parseFloat(r.HIGH_PRC ?? r.TDD_HGPRC ?? r.STCK_HGPRC ?? "0") || 0;
        const low =
          parseFloat(r.LOW_PRC ?? r.TDD_LWPRC ?? r.STCK_LWPRC ?? "0") || 0;
        const close =
          parseFloat(r.CLOSE_PRC ?? r.TDD_CLSPRC ?? r.STCK_PRPR ?? "0") || 0;
        const volume =
          parseFloat(r.TDD_VOL ?? r.ACC_TRDVOL ?? r.VOL_TOT ?? "0") || 0;
        return {
          date,
          code: ticker,
          open,
          high,
          low,
          close,
          volume,
          amount: close * volume,
        };
      })
      .filter(Boolean) as StockOHLCV[];
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  private async getFullISUCode(code6: string): Promise<string> {
    try {
      const form = new URLSearchParams({
        bld: "dbms/comm/finder/finder_stkisu",
        mktsel: "ALL",
        searchText: code6.padStart(6, "0"),
      });
      const data = await this.krxRequest(form, {
        backoffTries: 1,
        backoffStartMs: 150,
      });
      const block = Array.isArray(data?.outBlock_1)
        ? data.outBlock_1[0]
        : data?.outBlock_1;
      const full = block?.FULL_ISU_CD as string | undefined;
      return full && full.startsWith("KR") ? full : this.buildISIN(code6);
    } catch {
      return this.buildISIN(code6);
    }
  }

  async getStockList(
    market: "KOSPI" | "KOSDAQ" | "ALL" = "ALL"
  ): Promise<StockItem[]> {
    try {
      const form = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01501",
        money: "1",
        csvxls_isNo: "false",
        pageIndex: "1",
        pageSize: market === "ALL" ? "5000" : "2000",
      });
      if (market !== "ALL")
        form.append("mktId", market === "KOSPI" ? "001" : "101");

      let data: any = null;
      for (const day of this.getRecentTradingDays()) {
        form.set("trdDd", day);
        try {
          data = await this.krxRequest(form, {
            backoffTries: 2,
            backoffStartMs: 250,
          });
          if (
            data?.outBlock_1 &&
            (Array.isArray(data.outBlock_1) ? data.outBlock_1.length : 1) > 0
          )
            break;
        } catch {}
      }
      if (!data?.outBlock_1) return await this._scrapeNaverStockList(market);

      const rows = Array.isArray(data.outBlock_1)
        ? data.outBlock_1
        : [data.outBlock_1];
      const out: StockItem[] = rows
        .map((r: any) => {
          const code = String(r.ISU_CD ?? r.PRD_CODE ?? "").padStart(6, "0");
          const name = (r.ISU_ABBRV ?? r.SEC_NM ?? "").trim();
          const mktNm = (r.MKT_TP_NM ?? r.MKT_NM ?? "").trim();
          if (!code || !name) return null;
          const marketTag = /KOSDAQ/.test(mktNm)
            ? "KOSDAQ"
            : /KOSPI/.test(mktNm)
            ? "KOSPI"
            : "KOSPI";
          return { code, name, market: marketTag };
        })
        .filter(Boolean) as StockItem[];
      return out.slice(0, 2500);
    } catch {
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
          : market === "KOSDAQ"
          ? "&exchangeCode=4"
          : "&exchangeCode=1";
      const url = `https://finance.naver.com/sise/sise_market.sise?tableType=DEFAULT${mktParam}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) return [];
      const html = await res.text();
      const $ = cheerio.load(html);
      const out: StockItem[] = [];
      const rows = $("table.type_2 tbody tr").toArray();
      rows.forEach((el) => {
        const tds = $(el).find("td");
        if (tds.length <= 1) return;
        const a = $(tds[1]).find("a");
        const name = a.text().trim();
        const codeMatch = a.attr("href")?.match(/code=(\d{6})/);
        const code = codeMatch?.[1] ?? "";
        if (code && name)
          out.push({
            code,
            name,
            market: market === "KOSDAQ" ? "KOSDAQ" : "KOSPI",
          });
      });
      return out.slice(0, 2000);
    } catch {
      return [];
    }
  }

  async getMarketOHLCV(
    code6: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    const s = startDate.replace(/-/g, "");
    const e = endDate.replace(/-/g, "");
    try {
      const full = await this.getFullISUCode(code6);
      const baseForm = {
        bld: "dbms/MDC/STAT/standard/MDCSTAT01701",
        locale: "ko_KR",
        isuCd: full,
        isuCd2: "",
        share: "1",
        money: "1",
        csvxls_isNo: "false",
      };
      const form = new URLSearchParams({
        ...(baseForm as any),
        strtDd: s,
        endDd: e,
      } as any);

      let data: any;
      try {
        data = await this.krxRequest(form, {
          backoffTries: 3,
          backoffStartMs: 400,
        });
      } catch (err: any) {
        const msg = String(err?.message ?? "");
        if (!/INVALIDPERIOD/i.test(msg)) throw err;
      }

      let ohlcv = this.mapDaily(code6, data ?? {});
      if (ohlcv.length === 0) {
        const parts = this.splitPeriods(s, e, 3);
        const chunks = await Promise.all(
          parts.map((p) =>
            this.krxRequest(
              new URLSearchParams({
                ...(baseForm as any),
                strtDd: p.from,
                endDd: p.to,
              } as any),
              { backoffTries: 2, backoffStartMs: 250 }
            ).catch(() => ({}))
          )
        );
        ohlcv = chunks.flatMap((c) => this.mapDaily(code6, c));
      }

      if (ohlcv.length < 50) {
        const fb = await this.getMarketOHLCVFromNaver(
          code6,
          startDate,
          endDate
        );
        if (fb.length > ohlcv.length) ohlcv = fb;
      }

      return ohlcv
        .filter((d) => d.date >= startDate && d.date <= endDate)
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return await this.getMarketOHLCVFromNaver(code6, startDate, endDate);
    }
  }

  async getMarketOHLCVFromNaver(
    code6: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    try {
      const params = new URLSearchParams({
        symbol: code6,
        timeframe: "day",
        count: "500",
        requestType: "0",
      });
      const url = `${this.naverFchart}/sise.nhn?${params.toString()}`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!resp.ok) return [];
      const text = await resp.text();
      const tags = text.match(/<item data="[^"]+" \/>/g) ?? [];
      const out: StockOHLCV[] = tags
        .map((tag) => {
          const m = tag.match(/data="([^"]+)"/);
          if (!m) return null;
          const [d, o, h, l, c, v] = m[1].split("|");
          if (!/^\d{8}$/.test(d)) return null;
          const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
          if (date < startDate || date > endDate) return null;
          const close = parseFloat(c) || 0;
          const volume = parseFloat(v) || 0;
          return {
            date,
            code: code6,
            open: parseFloat(o) || close,
            high: parseFloat(h) || close,
            low: parseFloat(l) || close,
            close,
            volume,
            amount: close * volume,
          };
        })
        .filter(Boolean) as StockOHLCV[];
      return out.sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  }

  async getDailyPrice(
    code6: string
  ): Promise<{ close: number; volume: number; date: string } | null> {
    try {
      const full = await this.getFullISUCode(code6);
      let block: any = null;
      for (const day of this.getRecentTradingDays()) {
        const form = new URLSearchParams({
          bld: "dbms/MDC/STAT/standard/MDCSTAT02601",
          trdDd: day,
          isuCd: full,
          money: "1",
          csvxls_isNo: "false",
        });
        const data = await this.krxRequest(form, {
          backoffTries: 1,
          backoffStartMs: 150,
        });
        block = Array.isArray(data?.outBlock_1)
          ? data.outBlock_1[0]
          : data?.outBlock_1;
        if (parseFloat(block?.TDD_CLSPRC ?? "0") > 0) break;
      }
      if (!block) return null;
      return {
        close: parseFloat(block.TDD_CLSPRC ?? "0") || 0,
        volume: parseFloat(block.TDD_VOL ?? block.VOL_TOT ?? "0") || 0,
        date: block.TRD_DD ?? this.todayYYYYMMDD(),
      };
    } catch {
      return null;
    }
  }
}

// 하단의 전역 loadMetaFromAdapters / loadIndustryLabel 중복 정의는 제거했습니다.
