/**
 * ETF 핵심 지표(네이버 종목 API의 etfKeyIndicator) — 보유 카드 "이 종목 대응"이 종목마다 다른 숫자로 말하게 한다.
 * 모든 국내 상장 ETF에 대해 최근 12개월 분배율·총보수·1개월/3개월/1년 수익률을 준다(신규 상장 종목 포함).
 * 하루 안에서는 거의 바뀌지 않아 종목별 6시간 캐시. 실패해도 카드는 이력 데이터·기본 문구로 그려진다.
 */
import { fetchEtfMarketSums } from "./etfMarketList";

export type EtfKeyIndicator = {
  /** 최근 12개월 분배율 % */
  yieldTtm: number | null;
  /** 총보수 % */
  fee: number | null;
  return1m: number | null;
  return3m: number | null;
  return1y: number | null;
  /** 시가총액 (원) — 같은 지수 상품을 고를 때 규모 비교용 */
  marketCap: number | null;
  /** 괴리율 % (부호 포함, 시장가격이 NAV보다 비싸면 +) */
  deviation: number | null;
};

/** 비교 기준(코스피200) — 카드에서 "같은 기간 코스피200"으로 쓴다 */
export const ETF_BENCHMARK_CODE = "069500";

const num = (v: unknown): number | null => {
  // 빈 값은 null — Number("")가 0이 되어 "보수 0%"처럼 보이면 안 된다
  if (v == null || String(v).trim() === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,%+]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function parseEtfKeyIndicator(json: unknown): EtfKeyIndicator | null {
  const k = (json as { etfKeyIndicator?: Record<string, unknown> } | null)?.etfKeyIndicator;
  if (!k || typeof k !== "object") return null;
  return {
    yieldTtm: num(k.dividendYieldTtm),
    fee: num(k.totalFee),
    return1m: num(k.returnRate1m),
    return3m: num(k.returnRate3m),
    return1y: num(k.returnRate1y),
    marketCap: num(k.marketValueRaw),
    deviation: (() => {
      const r = num(k.deviationRate);
      return r == null ? null : String(k.deviationSign ?? "").includes("-") ? -Math.abs(r) : r;
    })(),
  };
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; result: EtfKeyIndicator | null }>();

async function fetchOne(code: string): Promise<EtfKeyIndicator | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/integration`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    return parseEtfKeyIndicator(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/** ETF 코드만 넘긴다. 결과에 없는 코드는 조회 실패·ETF 아님. 실패는 캐시하지 않는다 */
export async function fetchEtfKeyIndicators(codes: string[]): Promise<Map<string, EtfKeyIndicator>> {
  const out = new Map<string, EtfKeyIndicator>();
  const now = Date.now();
  const todo: string[] = [];
  for (const code of new Set(codes.map((c) => String(c).trim()).filter(Boolean))) {
    const hit = cache.get(code);
    if (hit && now < hit.expiresAt) {
      if (hit.result) out.set(code, hit.result);
    } else todo.push(code);
  }
  const queue = [...todo];
  const worker = async () => {
    for (let code = queue.shift(); code; code = queue.shift()) {
      try {
        const result = await fetchOne(code);
        cache.set(code, { expiresAt: Date.now() + CACHE_TTL_MS, result });
        if (result) out.set(code, result);
      } catch {
        // 일시 실패는 다음 조회 때 다시 시도
      }
    }
  };
  const [, marketSums] = await Promise.all([
    Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker)),
    out.size || todo.length ? fetchEtfMarketSums() : Promise.resolve(new Map<string, number>()),
  ]);
  return withListedMarketCap(out, marketSums);
}

/**
 * 순자산은 ETF 전체 목록 값을 먼저 쓴다 — 종목별 marketValueRaw는 같은 종목도 요청마다 빠졌다 들어왔다 해서
 * (2026-10-19 장중 3번 중 2번 누락) 같은 지수 상품 판정의 규모 비교가 요청마다 달라질 수 있었다. 목록에 없으면 종목별 값 유지.
 */
export function withListedMarketCap(indicators: Map<string, EtfKeyIndicator>, marketSumEok: Map<string, number>): Map<string, EtfKeyIndicator> {
  if (!marketSumEok.size) return indicators;
  const out = new Map<string, EtfKeyIndicator>();
  for (const [code, k] of indicators) {
    const eok = marketSumEok.get(code);
    out.set(code, eok != null ? { ...k, marketCap: eok * 1e8 } : k);
  }
  return out;
}
