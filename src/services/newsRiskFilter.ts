import { fetchStockNews } from "../utils/fetchNews";

export type NewsRiskFilterResult = {
  blockedByCode: Map<string, string>;
};

const EXCLUSION_PATTERNS: Array<{ reason: string; re: RegExp }> = [
  { reason: "자진상장폐지 이슈", re: /자진\s*상장\s*폐지|자진상폐/i },
  { reason: "공개매수 이슈", re: /공개\s*매수|TOB/i },
  { reason: "상장폐지 이슈", re: /상장\s*폐지/i },
  { reason: "매매거래정지 이슈", re: /매매\s*거래\s*정지|거래\s*정지/i },
  { reason: "관리종목/실질심사 이슈", re: /관리\s*종목|상장\s*적격성\s*실질\s*심사|개선\s*기간/i },
  { reason: "감사의견 리스크", re: /감사\s*의견\s*(거절|부적정|한정)/i },
  { reason: "회생/파산 리스크", re: /회생\s*절차|파산\s*신청|법정\s*관리/i },
  { reason: "횡령/배임 리스크", re: /횡령|배임/i },
];

function detectRiskReasonFromTitles(titles: string[]): string | null {
  for (const rawTitle of titles) {
    const title = String(rawTitle ?? "").trim();
    if (!title) continue;
    for (const pattern of EXCLUSION_PATTERNS) {
      if (pattern.re.test(title)) {
        return `${pattern.reason}: ${title}`;
      }
    }
  }
  return null;
}

export async function filterCodesByCriticalNewsRisk(
  codes: string[],
  options?: { maxNewsPerCode?: number; checkLimit?: number }
): Promise<NewsRiskFilterResult> {
  const maxNewsPerCode = Math.max(1, options?.maxNewsPerCode ?? 6);
  const checkLimit = Math.max(1, options?.checkLimit ?? 40);

  const uniqueCodes = [...new Set(codes.map((code) => String(code ?? "").trim()).filter(Boolean))]
    .slice(0, checkLimit);
  const blockedByCode = new Map<string, string>();

  await Promise.all(
    uniqueCodes.map(async (code) => {
      try {
        const news = await fetchStockNews(code, maxNewsPerCode);
        const reason = detectRiskReasonFromTitles(news.map((item) => item.title));
        if (reason) {
          blockedByCode.set(code, reason);
        }
      } catch {
        // 뉴스 조회 오류는 추천 차단으로 보지 않음
      }
    })
  );

  return { blockedByCode };
}
