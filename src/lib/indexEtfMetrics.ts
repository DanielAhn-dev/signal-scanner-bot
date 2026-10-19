/**
 * 모아가기 후보 ETF의 보수·순자산·거래대금 — 웹 고정 스냅샷(accumulateData.ts, 연구 스크립트로 만든 날 기준)이
 * 낡지 않게 서버가 매번 계산해 준다. 보수는 서버의 같은 지수 상품 판정(indexProductChoice)과 같은 출처
 * (네이버 etfKeyIndicator), 순자산은 네이버 ETF 전체 목록(스냅샷을 만든 출처와 같음), 거래대금은 하루치가 아니라 매일 쌓는 일봉의 최근 평균 — 하루치는 장중·이벤트로
 * 몇 배씩 출렁여(2026-10-19 KODEX 200TR 85억→348억) 50억 관문을 넘나들며 추천이 흔들린다.
 */

export type IndexEtfMetric = {
  code: string;
  /** 총보수 % */
  feePct: number | null;
  /** 순자산(시가총액) 억원 */
  marketCapEok: number | null;
  /** 최근 거래일 평균 거래대금 백만원 (accumulateData.tradingValueMil과 같은 단위) */
  tradingValueMil: number | null;
  /** 평균에 쓴 거래일 수 */
  tradingDays: number;
};

/** 평균 거래대금에 쓰는 거래일 수, 이보다 적으면 평균을 내지 않는다 */
export const TRADING_VALUE_WINDOW = 20;
export const MIN_TRADING_DAYS = 10;

export type DailyValueBar = { ticker: string; date: string; value: number | null; volume?: number | null; close?: number | null };

/** marketSumEok = ETF 전체 목록의 순자산(억원) — 종목별 지표의 순자산은 요청마다 빠지기도 해서 이것을 먼저 쓴다 */
export function summarizeIndexEtfMetrics(
  codes: string[],
  indicators: Map<string, { fee: number | null; marketCap: number | null }>,
  bars: DailyValueBar[],
  marketSumEok: Map<string, number> = new Map(),
): { asOf: string | null; items: IndexEtfMetric[] } {
  const byCode = new Map<string, DailyValueBar[]>();
  for (const b of bars) {
    const list = byCode.get(b.ticker) ?? [];
    list.push(b);
    byCode.set(b.ticker, list);
  }
  let asOf: string | null = null;
  const items = codes.map((code) => {
    const recent = (byCode.get(code) ?? [])
      .map((b) => ({ date: String(b.date).slice(0, 10), value: tradedValue(b) }))
      .filter((b): b is { date: string; value: number } => b.value != null)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, TRADING_VALUE_WINDOW);
    if (recent[0] && (!asOf || recent[0].date > asOf)) asOf = recent[0].date;
    const ind = indicators.get(code);
    return {
      code,
      feePct: ind?.fee ?? null,
      marketCapEok: marketSumEok.get(code) ?? (ind?.marketCap != null && ind.marketCap > 0 ? Math.round(ind.marketCap / 1e8) : null),
      tradingValueMil: recent.length >= MIN_TRADING_DAYS ? Math.round(recent.reduce((s, b) => s + b.value, 0) / recent.length / 1e6) : null,
      tradingDays: recent.length,
    };
  });
  return { asOf, items };
}

/** 거래대금(원). 비어 있으면 거래량×종가로 (배치 수집과 같은 대체) */
function tradedValue(b: DailyValueBar): number | null {
  const v = Number(b.value);
  if (Number.isFinite(v) && v > 0) return v;
  const alt = Number(b.volume) * Number(b.close);
  return Number.isFinite(alt) && alt > 0 ? alt : null;
}
