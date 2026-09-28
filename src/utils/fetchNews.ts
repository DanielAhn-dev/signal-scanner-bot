// src/utils/fetchNews.ts
// 네이버 뉴스 조회 (모바일 주식 API)

export interface NewsItem {
  title: string;
  link: string;
  source?: string;
  date?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// 개별 뉴스 요청이 지연/응답 지연 시 스캔 전체를 막지 않도록 요청별 타임아웃을 둡니다.
const NEWS_FETCH_TIMEOUT_MS = 3000;

type FetchLikeResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

async function fetchWithTimeout(
  url: string,
  timeoutMs = NEWS_FETCH_TIMEOUT_MS
): Promise<FetchLikeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return (await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    })) as FetchLikeResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** 개별 종목 뉴스 — 네이버 모바일 주식 API */
export async function fetchStockNews(
  code: string,
  limit = 5
): Promise<NewsItem[]> {
  try {
    const url = `https://m.stock.naver.com/api/news/stock/${code}?pageSize=${limit}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const items: NewsItem[] = [];
    for (const group of data) {
      for (const item of group.items || []) {
        if (items.length >= limit) break;
        const title = (item.titleFull || item.title || "").trim();
        if (!title) continue;

        // 네이버 뉴스 링크 조립
        const link = item.officeId && item.articleId
          ? `https://n.news.naver.com/mnews/article/${item.officeId}/${item.articleId}`
          : "";

        items.push({
          title,
          link,
          source: item.officeName || "",
          date: formatNewsDate(item.datetime),
        });
      }
    }
    return items;
  } catch (e) {
    console.error(`종목 뉴스 조회 실패 (${code}):`, e);
    return [];
  }
}

/** 네이버 모바일 주요뉴스 API 응답 한 건 */
type MainNewsRow = { oid?: string; aid?: string; ohnm?: string; tit?: string; dt?: string };

/** 주요뉴스 API 응답 → NewsItem (중복·빈 제목 제거) */
export function parseMainNewsRows(rows: unknown, seen = new Set<string>()): NewsItem[] {
  if (!Array.isArray(rows)) return [];
  const items: NewsItem[] = [];
  for (const row of rows as MainNewsRow[]) {
    const title = String(row?.tit ?? "").trim();
    const oid = String(row?.oid ?? "").trim();
    const aid = String(row?.aid ?? "").trim();
    if (title.length < 5 || !oid || !aid) continue;
    const link = `https://n.news.naver.com/mnews/article/${oid}/${aid}`;
    if (seen.has(link)) continue;
    seen.add(link);
    items.push({
      title,
      link,
      source: String(row?.ohnm ?? "").trim() || undefined,
      date: formatNewsDate(String(row?.dt ?? "")) || undefined,
    });
  }
  return items;
}

/**
 * 시장 전체 주요 뉴스 — 네이버 모바일 주식 API.
 * (예전 finance.naver.com/news/mainnews.naver HTML은 2026-09 stock.naver.com 이전으로 302 리다이렉트만 돌려줘
 *  스크래핑 결과가 항상 0건이었다 — 웹 뉴스 피드·/뉴스 명령이 빈 채로 나감)
 */
export async function fetchMarketNews(limit = 7): Promise<NewsItem[]> {
  const pageSize = 20;
  const maxPages = Math.min(16, Math.max(1, Math.ceil(limit / pageSize)));
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  try {
    for (let page = 1; page <= maxPages && items.length < limit; page += 1) {
      const url = `https://m.stock.naver.com/api/news/list?category=mainnews&pageSize=${pageSize}&page=${page}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) break;
      const parsed = parseMainNewsRows(await res.json(), seen);
      if (!parsed.length) break;
      items.push(...parsed);
    }
  } catch (e) {
    console.error("시장 뉴스 조회 실패:", e);
  }
  return items.slice(0, limit);
}

/** yyyyMMddHHmm → MM.dd HH:mm */
function formatNewsDate(raw?: string): string {
  if (!raw || raw.length < 12) return "";
  return `${raw.slice(4, 6)}.${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
}
