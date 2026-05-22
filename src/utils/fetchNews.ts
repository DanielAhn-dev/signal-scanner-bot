// src/utils/fetchNews.ts
// 네이버 뉴스 조회 (모바일 API + HTML 스크래핑)

import * as cheerio from "cheerio";
import iconv from "iconv-lite";

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
  arrayBuffer(): Promise<ArrayBuffer>;
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
    const items: NewsItem[] = [];
    const seen = new Set<string>();
    const maxPages = Math.min(30, Math.max(2, Math.ceil(limit / 20) + 2));

    const pushIfValid = (titleRaw: string, hrefRaw: string, sourceRaw?: string, dateRaw?: string) => {
      const title = String(titleRaw || "").trim();
      const href = String(hrefRaw || "").trim();
      if (!title || title.length < 5 || !href) return;

      const fullLink = href.startsWith("http")
        ? href
        : `https://finance.naver.com${href}`;
      const key = `${title}|${fullLink}`;
      if (seen.has(key)) return;
      seen.add(key);

      const source = String(sourceRaw || "").trim();
      const date = String(dateRaw || "").trim();
      items.push({
        title,
        link: fullLink,
        source: source || undefined,
        date: date || undefined,
      });
    };

    for (let page = 1; page <= maxPages && items.length < limit; page += 1) {
      const url = `https://finance.naver.com/news/mainnews.naver?page=${page}`;
      const res = (await fetch(url, {
        headers: { "User-Agent": UA },
      })) as FetchLikeResponse;
      if (!res.ok) break;

      const ab = await res.arrayBuffer();
      let html: string;
      try {
        html = iconv.decode(Buffer.from(ab), "euc-kr");
      } catch {
        html = new TextDecoder("utf-8").decode(ab);
      }

      const $ = cheerio.load(html);
      const beforeCount = items.length;

      // 1) li 단위 파싱
      $(".mainNewsList .newsList li").each((_, li) => {
        if (items.length >= limit) return;
        const $li = $(li);
        const $titleAnchor = $li.find(".articleSubject a").first();
        const title = $titleAnchor.text().trim();
        const href = $titleAnchor.attr("href") || "";
        const source = $li.find(".articleSummary .press").first().text().trim();
        const date = $li.find(".articleSummary .wdate").first().text().trim();
        pushIfValid(title, href, source, date);
      });

      // 2) 폴백
      if (items.length < limit) {
        $(".articleSubject a").each((_, el) => {
          if (items.length >= limit) return;
          const $a = $(el);
          const title = $a.text().trim();
          const href = $a.attr("href") || "";
          const $li = $a.closest("li");
          const source = $li.find(".articleSummary .press").text().trim()
            || $li.find(".press").text().trim()
            || "";
          const date = $li.find(".articleSummary .wdate").text().trim()
            || $li.find(".wdate").text().trim()
            || "";
          pushIfValid(title, href, source, date);
        });
      }

      // 3) 구버전 구조 폴백
      if (items.length < limit) {
        $("dl dt a").each((_, el) => {
          if (items.length >= limit) return;
          const $a = $(el);
          const title = $a.text().trim();
          const href = $a.attr("href") || "";
          pushIfValid(title, href);
        });
      }

      // 해당 페이지에서 신규 뉴스가 전혀 없으면 순회 종료
      if (items.length === beforeCount) break;
    }

    return items.slice(0, limit);
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
