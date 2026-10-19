/**
 * 네이버 ETF 전체 목록(finance.naver.com/api/sise/etfItemList.nhn)의 순자산(억원) — 요청 한 번에 국내 ETF 전부.
 * 종목별 etfKeyIndicator.marketValueRaw는 같은 종목도 요청마다 빠졌다 들어왔다 해서(2026-10-19 장중 확인)
 * 순자산 비교에는 이 목록을 먼저 쓴다. 응답은 EUC-KR이지만 코드·숫자만 읽으므로 디코딩은 신경 쓰지 않는다.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache: { expiresAt: number; marketSumEok: Map<string, number> } | null = null;

export function parseEtfItemList(json: unknown): Map<string, number> {
  const list = (json as { result?: { etfItemList?: Array<{ itemcode?: unknown; marketSum?: unknown }> } } | null)?.result?.etfItemList;
  const out = new Map<string, number>();
  if (!Array.isArray(list)) return out;
  for (const row of list) {
    const code = String(row?.itemcode ?? "").trim();
    const sum = Number(row?.marketSum);
    if (/^[0-9A-Z]{6}$/.test(code) && Number.isFinite(sum) && sum > 0) out.set(code, sum);
  }
  return out;
}

/** 코드 → 순자산(억원). 실패하면 빈 Map(호출 측이 종목별 지표로 보충) — 실패는 캐시하지 않는다 */
export async function fetchEtfMarketSums(): Promise<Map<string, number>> {
  if (cache && Date.now() < cache.expiresAt) return cache.marketSumEok;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch("https://finance.naver.com/api/sise/etfItemList.nhn", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!res.ok) return new Map();
    const marketSumEok = parseEtfItemList(JSON.parse(await res.text()));
    if (marketSumEok.size) cache = { expiresAt: Date.now() + CACHE_TTL_MS, marketSumEok };
    return marketSumEok;
  } catch {
    return new Map();
  } finally {
    clearTimeout(timer);
  }
}
