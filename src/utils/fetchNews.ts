// src/utils/fetchNews.ts
// 네이버 뉴스 조회 (모바일 API + HTML 스크래핑)

import * as cheerio from "cheerio";

export interface NewsItem {
  title: string;
  link: string;
  source?: string;
  date?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

type FetchLikeResponse = {
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

/** 개별 종목 뉴스 — 네이버 모바일 주식 API */
export async function fetchStockNews(
  code: string,
  limit = 5
): Promise<NewsItem[]> {
  try {
    const url = `https://m.stock.naver.com/api/news/stock/${code}?pageSize=${limit}`;
    const res = (await fetch(url, {
      headers: { "User-Agent": UA },
    })) as FetchLikeResponse;
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

/** 시장 전체 주요 뉴스 — 네이버 금융 HTML 스크래핑 */
export async function fetchMarketNews(limit = 7): Promise<NewsItem[]> {
  try {
    const url = "https://finance.naver.com/news/mainnews.naver";
    const res = (await fetch(url, {
      headers: { "User-Agent": UA },
    })) as FetchLikeResponse;
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: NewsItem[] = [];
    const seen = new Set<string>();

    // .articleSubject a — 뉴스 제목 링크
    $(".articleSubject a").each((_, el) => {
      if (items.length >= limit) return;
      const $a = $(el);
      const title = $a.text().trim();
      const href = $a.attr("href") || "";
      if (!title || title.length < 5 || seen.has(title)) return;
      seen.add(title);
      const fullLink = href.startsWith("http")
        ? href
        : `https://finance.naver.com${href}`;
      items.push({ title, link: fullLink });
    });

    // fallback: dl dt a
    if (!items.length) {
      $("dl dt a").each((_, el) => {
        if (items.length >= limit) return;
        const $a = $(el);
        const title = $a.text().trim();
        const href = $a.attr("href") || "";
        if (!title || title.length < 5 || seen.has(title)) return;
        seen.add(title);
        const fullLink = href.startsWith("http")
          ? href
          : `https://finance.naver.com${href}`;
        items.push({ title, link: fullLink });
      });
    }

    return items;
  } catch (e) {
    console.error("시장 뉴스 조회 실패:", e);
    return [];
  }
}

/** yyyyMMddHHmm → MM.dd HH:mm */
function formatNewsDate(raw?: string): string {
  if (!raw || raw.length < 12) return "";
  return `${raw.slice(4, 6)}.${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
}
