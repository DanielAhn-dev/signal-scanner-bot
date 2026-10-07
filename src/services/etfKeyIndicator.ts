/**
 * ETF 핵심 지표(네이버 종목 API의 etfKeyIndicator) — 보유 카드 "이 종목 대응"이 종목마다 다른 숫자로 말하게 한다.
 * 모든 국내 상장 ETF에 대해 최근 12개월 분배율·총보수·1개월/3개월/1년 수익률을 준다(신규 상장 종목 포함).
 * 하루 안에서는 거의 바뀌지 않아 종목별 6시간 캐시. 실패해도 카드는 이력 데이터·기본 문구로 그려진다.
 */
export type EtfKeyIndicator = {
  /** 최근 12개월 분배율 % */
  yieldTtm: number | null;
  /** 총보수 % */
  fee: number | null;
  return1m: number | null;
  return3m: number | null;
  return1y: number | null;
};

/** 비교 기준(코스피200) — 카드에서 "같은 기간 코스피200"으로 쓴다 */
export const ETF_BENCHMARK_CODE = "069500";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,%+]/g, ""));
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
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  return out;
}
