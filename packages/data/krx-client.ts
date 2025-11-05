import type { StockOHLCV, StockInfo, TopStock } from "./types";

interface KRXResponse {
  output?: any[];
  OutBlock_1?: any[];
  CURRENT_DATETIME?: string;
  [key: string]: any;
}

function num(v: any): number {
  if (v === null || v === undefined) return 0;
  return parseFloat(String(v).replace(/,/g, "")) || 0;
}

export class KRXClient {
  private krxURL = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

  private commonHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json, text/javascript, */*",
      Referer: "http://data.krx.co.kr/contents/MDC/MDI/mdiLoader",
      "X-Requested-With": "XMLHttpRequest",
    };
  }

  private async safeJson(resp: Response): Promise<any | null> {
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      const text = await resp.text();
      console.error(
        "[KRX] Non-JSON:",
        resp.status,
        resp.statusText,
        text.slice(0, 200)
      );
      return null;
    }
    try {
      return await resp.json();
    } catch (e) {
      console.error("[KRX] JSON parse error:", e);
      return null;
    }
  }

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
        headers: this.commonHeaders(),
        body: body.toString(),
      });
      if (!response.ok) {
        console.error(
          "[KRX] stock list HTTP",
          response.status,
          response.statusText
        );
        return [];
      }
      const json = (await this.safeJson(response)) as KRXResponse | null;
      if (!json) return [];
      const arr = json.output || json.OutBlock_1 || [];
      return arr.map((it: any) => ({
        code: it.ISU_SRT_CD,
        name: it.ISU_ABBRV,
        market:
          it.MKT_NM === "KOSPI"
            ? "KOSPI"
            : it.MKT_NM === "KOSDAQ"
            ? "KOSDAQ"
            : "KONEX",
      }));
    } catch (e) {
      console.error("[KRX] stock list error:", e);
      return [];
    }
  }

  async getMarketOHLCV(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    const fromDt = startDate.replace(/-/g, "");
    const toDt = endDate.replace(/-/g, "");
    const isuCd = `KR7${ticker}0`;

    const body = new URLSearchParams({
      bld: "dbms/MDC/STAT/standard/MDCSTAT01701",
      locale: "ko_KR",
      isuCd,
      isuCd2: ticker,
      strtDd: fromDt,
      endDd: toDt,
      share: "1",
      money: "1",
      csvxls_isNo: "false",
    });

    try {
      const response = await fetch(this.krxURL, {
        method: "POST",
        headers: this.commonHeaders(),
        body: body.toString(),
      });
      if (!response.ok) {
        console.error("[KRX] OHLCV HTTP", response.status, response.statusText);
        return [];
      }
      const json = (await this.safeJson(response)) as KRXResponse | null;
      if (!json) return [];
      const raw = json.output || json.OutBlock_1 || [];
      if (!raw.length) return [];
      const data: StockOHLCV[] = raw.map((it: any) => {
        const date = String(it.TRD_DD || "");
        const formatted = date.includes("/")
          ? date.replace(/\//g, "-")
          : `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
        return {
          date: formatted,
          code: ticker,
          open: num(it.TDD_OPNPRC ?? it.OPNPRC ?? 0),
          high: num(it.TDD_HGPRC ?? it.HGPRC ?? 0),
          low: num(it.TDD_LWPRC ?? it.LWPRC ?? 0),
          close: num(it.TDD_CLSPRC ?? it.CLSPRC ?? 0),
          volume: Math.trunc(num(it.ACC_TRDVOL ?? it.TRDVOL ?? 0)),
          amount: Math.trunc(num(it.ACC_TRDVAL ?? it.TRDVAL ?? 0)),
        };
      });
      return data.sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) {
      console.error("[KRX] OHLCV error:", e);
      return [];
    }
  }

  async getTopVolumeStocks(
    market: "STK" | "KSQ" = "STK",
    limit = 20
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
        headers: this.commonHeaders(),
        body: body.toString(),
      });
      if (!response.ok) {
        console.error(
          "[KRX] top volume HTTP",
          response.status,
          response.statusText
        );
        return [];
      }
      const json = (await this.safeJson(response)) as KRXResponse | null;
      if (!json) return [];
      const raw = json.output || json.OutBlock_1 || [];
      return raw.slice(0, limit).map((it: any) => ({
        code: it.ISU_SRT_CD,
        name: it.ISU_ABBRV,
        close: num(it.TDD_CLSPRC),
        change: parseFloat(String(it.FLUC_RT ?? "0")) || 0,
        volume: Math.trunc(num(it.ACC_TRDVOL)),
        amount: Math.trunc(num(it.ACC_TRDVAL)),
      }));
    } catch (e) {
      console.error("[KRX] top volume error:", e);
      return [];
    }
  }

  async getMarketOHLCVFromNaver(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    try {
      const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${ticker}&timeframe=day&count=400&requestType=0`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!resp.ok) {
        console.error("[Naver] HTTP", resp.status, resp.statusText);
        return [];
      }
      const text = await resp.text();
      const items = text.match(/<item\s+data="[^"]+"\s*\/>/g) || [];
      const data: StockOHLCV[] = items
        .map((tag) => {
          const m = tag.match(/data="([^"]+)"/);
          if (!m) return null;
          const [dateStr, open, high, low, close, volume] = m[1].split("|");
          const date = `${dateStr.slice(0, 4)}-${dateStr.slice(
            4,
            6
          )}-${dateStr.slice(6, 8)}`;
          const o = parseInt(open, 10) || 0;
          const h = parseInt(high, 10) || 0;
          const l = parseInt(low, 10) || 0;
          const c = parseInt(close, 10) || 0;
          const v = parseInt(volume, 10) || 0;
          return {
            date,
            code: ticker,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: v,
            amount: c * v,
          };
        })
        .filter((x): x is StockOHLCV => !!x);
      return data
        .filter((d) => d.date >= startDate && d.date <= endDate)
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) {
      console.error("[Naver] fetch error:", e);
      return [];
    }
  }
}
