/**
 * 종목별 뉴스 헤드라인 일일 보관 (검증용 데이터 축적).
 *
 * 뉴스를 매매 신호로 쓰려면 "이런 뉴스 뒤 N일 수익률"을 검증해야 하는데 과거 뉴스가 없었다.
 * 매일 유니버스 종목의 최근 헤드라인을 Storage(market-snapshots/news/YYYY/YYYY-MM-DD.json.gz)에 쌓고,
 * 2~3개월 뒤 키워드별 사후 수익률을 검증해 효과가 있을 때만 필터로 쓴다. 지금은 매매에 쓰지 않는다.
 */

export type ArchivedNews = {
  code: string;
  /** officeId+articleId — 날짜를 넘어 중복 제거용 */
  id: string;
  /** yyyyMMddHHmm (KST) */
  datetime: string;
  office: string;
  title: string;
};

type StockNewsGroup = {
  items?: Array<{
    officeId?: string;
    articleId?: string;
    officeName?: string;
    datetime?: string;
    title?: string;
    titleFull?: string;
  }>;
};

/** m.stock.naver.com/api/news/stock/{code} 응답 → 보관 행. sinceKey(yyyyMMddHHmm) 이후 기사만 */
export function parseStockNewsForArchive(code: string, body: unknown, sinceKey: string): ArchivedNews[] {
  if (!Array.isArray(body)) return [];
  const out: ArchivedNews[] = [];
  const seen = new Set<string>();
  for (const group of body as StockNewsGroup[]) {
    for (const item of group?.items ?? []) {
      const officeId = String(item.officeId ?? "").trim();
      const articleId = String(item.articleId ?? "").trim();
      const datetime = String(item.datetime ?? "").trim();
      const title = String(item.titleFull || item.title || "").trim();
      if (!officeId || !articleId || !/^\d{12}$/.test(datetime) || !title) continue;
      if (datetime <= sinceKey) continue;
      const id = `${officeId}-${articleId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ code, id, datetime, office: String(item.officeName ?? "").trim(), title });
    }
  }
  return out;
}
