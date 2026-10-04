export type InvestorTrendRow = { date: string; foreignNet: number; instNet: number };

/** 외국인/기관 일별 순매수(주). 예전 finance.naver.com/item/frgn.naver 표는 2026-10 새 증권 사이트로
 * 넘어가면서 사라져(빈 결과) 모바일 API로 바꿨다. 응답은 최신 날짜부터. */
export function parseInvestorTrend(json: unknown): InvestorTrendRow[] {
  if (!Array.isArray(json)) return [];
  const num = (v: unknown) => parseInt(String(v ?? "").replace(/[,+]/g, ""), 10) || 0;
  return json
    .filter((r: any) => /^\d{8}$/.test(String(r?.bizdate ?? "")))
    .map((r: any) => {
      const d = String(r.bizdate);
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        foreignNet: num(r.foreignerPureBuyQuant),
        instNet: num(r.organPureBuyQuant),
      };
    });
}
