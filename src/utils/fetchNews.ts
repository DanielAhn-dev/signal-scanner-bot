// src/utils/fetchNews.ts
// 네이버 금융 뉴스 스크래핑 (cheerio)

import * as cheerio from "cheerio";

export interface NewsItem {
  title: string;
  link: string;
  source?: string;
  date?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/** 개별 종목 뉴스 */
export async function fetchStockNews(
  code: string,
  limit = 5
): Promise<NewsItem[]> {
  try {
    const url = `https://finance.naver.com/item/news_news.naver?code=${code}&page=1&sm=title_entity_id.basic&clusterId=`;
    const html = await fetch(url, { headers: { "User-Agent": UA } }).then(
      (r) => r.text()
    );
    const $ = cheerio.load(html);
    const items: NewsItem[] = [];

    $("table.type5 tbody tr").each((_, el) => {
      if (items.length >= limit) return;
      const $el = $(el);
      const $a = $el.find("td.title a");
      const title = $a.text().trim();
      const href = $a.attr("href");
      const source = $el.find("td.info").text().trim();
      const date = $el.find("td.date").text().trim();

      if (title && href) {
        const fullLink = href.startsWith("http")
          ? href
          : `https://finance.naver.com${href}`;
        items.push({ title, link: fullLink, source, date });
      }
    });

    return items;
  } catch (e) {
    console.error(`종목 뉴스 조회 실패 (${code}):`, e);
    return [];
  }
}

/** 시장 전체 주요 뉴스 */
export async function fetchMarketNews(limit = 5): Promise<NewsItem[]> {
  try {
    const url = "https://finance.naver.com/news/mainnews.naver";
    const html = await fetch(url, { headers: { "User-Agent": UA } }).then(
      (r) => r.text()
    );
    const $ = cheerio.load(html);
    const items: NewsItem[] = [];

    $(".mainNewsList li, .newsList li").each((_, el) => {
      if (items.length >= limit) return;
      const $a = $(el).find("a").first();
      const title = $a.text().trim();
      const href = $a.attr("href");
      if (title && href) {
        const fullLink = href.startsWith("http")
          ? href
          : `https://finance.naver.com${href}`;
        items.push({ title, link: fullLink });
      }
    });

    return items;
  } catch (e) {
    console.error("시장 뉴스 조회 실패:", e);
    return [];
  }
}
