// packages/data/krx-client.ts
import type { StockOHLCV, StockInfo, TopStock } from "./types";

// 내부 유틸
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toNum = (v: any) =>
  v === null || v === undefined
    ? 0
    : parseFloat(String(v).replace(/,/g, "")) || 0;

type KRXResponse = {
  output?: any[];
  OutBlock_1?: any[];
  CURRENT_DATETIME?: string;
  [k: string]: any;
};

type RequestOpts = {
  backoffTries?: number; // 재시도 횟수
  backoffStartMs?: number; // 최초 백오프
  timeoutMs?: number; // 요청 타임아웃
};

function withTimeout<T>(p: Promise<T>, ms: number, label = "op"): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("timeout:" + label)), ms)
    ),
  ]) as Promise<T>;
}

export class KRXClient {
  private krxURL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

  private commonHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "*/*",
      Referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader",
      "X-Requested-With": "XMLHttpRequest",
    };
  }

  // fetch + 타임아웃 (네이티브 fetch 사용, node-fetch 제거)
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 10000
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 네이티브 fetch: body를 string으로 명시 (FormData/ArrayBuffer 충돌 방지)
      const body = init.body ? (init.body as string) : undefined;
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        body,
        // undici 호환: keepalive 등 생략, 기본 Web API RequestInit 사용
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // content-type 무관 안전 파싱 + output 표준화
  private async tryParse(
    resp: Response
  ): Promise<{ json: KRXResponse | null; output: any[]; raw: string }> {
    const raw = await resp.text();
    // JSON 시도 1
    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // BOM/공백 제거 후 2차 시도
      try {
        const trimmed = raw.trim().replace(/^\ufeff/, "");
        json = JSON.parse(trimmed);
      } catch {
        json = null;
      }
    }
    const output = Array.isArray(json?.output)
      ? json!.output
      : Array.isArray(json?.OutBlock_1)
      ? json!.OutBlock_1
      : [];
    return { json, output, raw };
  }

  // KRX 요청 + 지수백오프 재시도
  private async krxRequest(
    form: URLSearchParams,
    opts: RequestOpts = {}
  ): Promise<{ output: any[]; json: KRXResponse | null; raw: string }> {
    const backoffTries = opts.backoffTries ?? 2;
    const backoffStartMs = opts.backoffStartMs ?? 250;
    const timeoutMs = opts.timeoutMs ?? 10000;

    let best: any[] = [];
    let bestJson: KRXResponse | null = null;
    let bestRaw = "";

    for (let i = 0; i <= backoffTries; i++) {
      if (i > 0) await sleep(backoffStartMs * 2 ** (i - 1));
      const resp = await this.fetchWithTimeout(
        this.krxURL,
        {
          method: "POST",
          headers: this.commonHeaders(),
          body: form.toString(), // string body 명시 (RequestInit 호환)
        },
        timeoutMs
      ).catch(() => null as unknown as Response);
      if (!resp || !resp.ok) continue;

      const { json, output, raw } = await this.tryParse(resp);
      if (output.length > best.length) {
        best = output;
        bestJson = json;
        bestRaw = raw;
      }
      // 충분한 데이터면 조기 종료
      if (best.length >= 200) break;
    }
    return { output: best, json: bestJson, raw: bestRaw };
  }

  // 공통: 일봉 맵핑
  private mapDaily(ticker: string, arr: any[]): StockOHLCV[] {
    const out = arr
      .map((it) => {
        // 날짜 필드 다양성 대응
        const d = String(it.TRD_DD ?? it.TDD_DT ?? it.STCK_BSOP_DATE ?? "");
        if (!d) return null;
        const formatted = d.includes("/")
          ? d.replace(/\//g, "-")
          : d.length === 8
          ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
          : d;
        return {
          date: formatted,
          code: ticker,
          open: toNum(it.TDD_OPNPRC ?? it.OPNPRC ?? it.STCK_OPRC),
          high: toNum(it.TDD_HGPRC ?? it.HGPRC ?? it.STCK_HGPR),
          low: toNum(it.TDD_LWPRC ?? it.LWPRC ?? it.STCK_LWPR),
          close: toNum(it.TDD_CLSPRC ?? it.CLSPRC ?? it.STCK_CLPR),
          volume: Math.trunc(toNum(it.ACC_TRDVOL ?? it.TRDVOL ?? it.CNTG_VOL)),
          amount: Math.trunc(
            toNum(it.ACC_TRDVAL ?? it.TRDVAL ?? it.TOTL_TR_PRC)
          ),
        } as StockOHLCV;
      })
      .filter(Boolean) as StockOHLCV[];
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  // 종목 리스트
  async getStockList(
    market: "STK" | "KSQ" | "ALL" = "ALL"
  ): Promise<StockInfo[]> {
    const form = new URLSearchParams({
      bld: "dbms/MDC/STAT/standard/MDCSTAT01901",
      locale: "ko_KR",
      mktId: market,
      share: "1",
      csvxls_isNo: "false",
    });

    try {
      const { output } = await this.krxRequest(form);
      const arr = output;
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
    } catch {
      return [];
    }
  }

  // 일봉 OHLCV
  async getMarketOHLCV(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    const s = startDate.replace(/-/g, "");
    const e = endDate.replace(/-/g, "");
    // KRX 표준 ISIN 유사 포맷이 아닌 경우가 있으므로 KRX는 단축코드 그대로도 동작하는 경우가 많다.
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

    // 1) KRX 시도 + 재시도
    const primary = await this.krxRequest(form, {
      backoffTries: 2,
      backoffStartMs: 250,
    });

    let data = this.mapDaily(ticker, primary.output);

    // 2) 폴백(Naver)과 비교해 더 긴 것을 채택
    if (data.length < 200) {
      const fb = await this.getMarketOHLCVFromNaver(ticker, startDate, endDate);
      if (fb.length > data.length) data = fb;
    }

    // 3) 최종 반환
    return data;
  }

  // 분봉(필요 시 확장: 현재 Naver만 예시)
  async getMinuteOHLCV(
    ticker: string,
    minutes = 1,
    count = 400
  ): Promise<StockOHLCV[]> {
    // Naver 분봉은 비공식이므로 가볍게 폴백만 예시
    try {
      const url = `https://api.finance.naver.com/siseJson.naver?symbol=${ticker}&requestType=1&timeframe=${minutes}m&count=${count}`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!resp.ok) return [];
      const text = await resp.text();
      // Naver 분봉은 JS 배열 문자열 포맷으로 오는 경우가 있어 eval 없이 파싱이 번거롭다.
      // 안전상 여기서는 일봉 우선 전략을 권장하며, 분봉은 프로젝트 필요 시 전용 파서 추가.
      return [];
    } catch {
      return [];
    }
  }

  // 거래대금 상위
  async getTopVolumeStocks(
    market: "STK" | "KSQ" = "STK",
    limit = 20
  ): Promise<TopStock[]> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const form = new URLSearchParams({
      bld: "dbms/MDC/STAT/standard/MDCSTAT01501",
      locale: "ko_KR",
      mktId: market,
      trdDd: today,
      share: "1",
      money: "1",
      csvxls_isNo: "false",
    });

    try {
      const { output } = await this.krxRequest(form);
      return output.slice(0, limit).map((it: any) => ({
        code: it.ISU_SRT_CD,
        name: it.ISU_ABBRV,
        close: toNum(it.TDD_CLSPRC),
        change: parseFloat(String(it.FLUC_RT ?? "0")) || 0,
        volume: Math.trunc(toNum(it.ACC_TRDVOL)),
        amount: Math.trunc(toNum(it.ACC_TRDVAL)),
      }));
    } catch {
      return [];
    }
  }

  // Naver 일봉 폴백 (네이티브 fetch)
  async getMarketOHLCVFromNaver(
    ticker: string,
    startDate: string,
    endDate: string
  ): Promise<StockOHLCV[]> {
    try {
      const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${ticker}&timeframe=day&count=500&requestType=0`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!resp.ok) return [];
      const text = await resp.text();
      const items = text.match(/<item\s+data="[^"]+"\s*\/>/g) || [];
      const data: StockOHLCV[] = items
        .map((tag) => {
          const m = tag.match(/data="([^"]+)"/);
          if (!m) return null;
          const [d, o, h, l, c, v] = m[1].split("|");
          const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
          const open = parseInt(o, 10) || 0;
          const high = parseInt(h, 10) || 0;
          const low = parseInt(l, 10) || 0;
          const close = parseInt(c, 10) || 0;
          const volume = parseInt(v, 10) || 0;
          return {
            date,
            code: ticker,
            open,
            high,
            low,
            close,
            volume,
            amount: close * volume,
          } as StockOHLCV;
        })
        .filter(Boolean) as StockOHLCV[];

      return data
        .filter((d) => d.date >= startDate && d.date <= endDate)
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  }

  // 섹터별 상위 종목 코드 + 이름/거래대금 수집 (일 100개)
  async getTopSectorsData(topN = 8): Promise<
    {
      sector: string;
      codes: { code: string; name: string; volume: number }[];
    }[]
  > {
    const [ks, kq] = await Promise.all([
      this.getTopVolumeStocks("STK", 100), // KOSPI
      this.getTopVolumeStocks("KSQ", 100), // KOSDAQ
    ]);
    const all = [...ks, ...kq].slice(0, 200); // 상위 200개

    // 섹터 매핑 (키워드 기반 또는 외부 API, 나중 확장: KRX 분류코드)
    const sectorMap: { [code: string]: string } = {}; // 예: {'005930': '반도체', '068270': '바이오'}
    all.forEach((item) => {
      const name = item.name.toLowerCase();
      if (
        name.includes("반도체") ||
        name.includes("hynix") ||
        name.includes("samsung elec")
      )
        sectorMap[item.code] = "반도체";
      else if (name.includes("바이오") || name.includes("celltrion"))
        sectorMap[item.code] = "바이오";
      else if (name.includes("전기차") || name.includes("lg energy"))
        sectorMap[item.code] = "전기차";
      else if (name.includes("ai") || name.includes("ncsoft"))
        sectorMap[item.code] = "인공지능";
      else sectorMap[item.code] = "기타";
    });

    // 섹터별 그룹화 + volume 합산
    const sectors: {
      [sector: string]: { code: string; name: string; volume: number }[];
    } = {};
    all.forEach((item) => {
      const sec = sectorMap[item.code];
      if (!sectors[sec]) sectors[sec] = [];
      sectors[sec].push({
        code: item.code,
        name: item.name,
        volume: item.volume,
      });
    });

    // 상위 N 섹터 (volume 총합 기준 정렬)
    return Object.entries(sectors)
      .map(([sector, items]) => ({
        sector,
        codes: items.sort((a, b) => b.volume - a.volume).slice(0, 10),
      }))
      .sort(
        (a, b) =>
          b.codes.reduce((sum, i) => sum + i.volume, 0) -
          a.codes.reduce((sum, i) => sum + i.volume, 0)
      )
      .slice(0, topN);
  }

  // 종목별 ROI 계산 (1/3/6M 수익률, OHLCV 기반)
  async getROIForCodes(
    codes: string[],
    days: number
  ): Promise<{ code: string; roi: number }[]> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const results = await Promise.all(
      codes.map(async (code) => {
        const ohlcv = await withTimeout(
          this.getMarketOHLCV(
            code,
            start.toISOString().slice(0, 10),
            end.toISOString().slice(0, 10)
          ),
          5000
        );
        if (ohlcv.length < 2) return { code, roi: 0 };
        const roi =
          ((ohlcv.at(-1)!.close - ohlcv[0].close) / ohlcv[0].close) * 100;
        return { code, roi };
      })
    );
    return results;
  }
}
