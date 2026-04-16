// src/lib/newsSentiment.ts
// 뉴스 제목 감성 분석 — 키워드 매칭 기반 (외부 API 불필요)

export interface SentimentResult {
  /** -10 ~ +10 (긍정 키워드 매칭당 +2, 부정 키워드 매칭당 -2) */
  score: number;
  positiveMatches: string[];
  negativeMatches: string[];
}

/** 긍정 키워드 — 수급·실적 개선 관련 */
const POSITIVE_KEYWORDS: readonly string[] = [
  "수주",
  "수주계약",
  "공급계약",
  "수출계약",
  "계약 체결",
  "MOU",
  "업무협약",
  "흑자",
  "흑자전환",
  "영업이익 증가",
  "어닝서프라이즈",
  "실적 호조",
  "매출 성장",
  "이익 개선",
  "상향",
  "목표가 상향",
  "투자의견 상향",
  "매수 추천",
  "신제품",
  "신사업",
  "신규 진출",
  "자사주 매입",
  "자사주 취득",
  "배당 확대",
  "특허",
  "FDA 승인",
  "임상 성공",
];

/** 부정 키워드 — 리스크·훼손 관련 */
const NEGATIVE_KEYWORDS: readonly string[] = [
  "유상증자",
  "무상감자",
  "감자",
  "횡령",
  "배임",
  "주가조작",
  "영업정지",
  "거래정지",
  "상장폐지",
  "실적 쇼크",
  "영업손실",
  "적자전환",
  "하향",
  "목표가 하향",
  "투자의견 하향",
  "매도 의견",
  "소송",
  "과징금",
  "벌금",
  "행정처분",
  "리콜",
  "결함",
  "대규모 손실",
  "손상차손",
  "불성실공시",
  "회계오류",
  "부도",
  "워크아웃",
];

/**
 * 뉴스 제목 배열로부터 감성 점수를 계산한다.
 * - 긍정/부정 키워드는 동일 키워드 중복 카운트 없음 (첫 매칭만)
 * - score 범위: -10 ~ +10
 */
export function analyzeNewsSentiment(titles: string[]): SentimentResult {
  const positiveMatches: string[] = [];
  const negativeMatches: string[] = [];

  for (const title of titles) {
    for (const kw of POSITIVE_KEYWORDS) {
      if (title.includes(kw) && !positiveMatches.includes(kw)) {
        positiveMatches.push(kw);
      }
    }
    for (const kw of NEGATIVE_KEYWORDS) {
      if (title.includes(kw) && !negativeMatches.includes(kw)) {
        negativeMatches.push(kw);
      }
    }
  }

  const raw = positiveMatches.length * 2 - negativeMatches.length * 2;
  const score = Math.max(-10, Math.min(10, raw));

  return { score, positiveMatches, negativeMatches };
}

/**
 * 감성 점수에 대응하는 이모지 반환.
 * 중립(−1 ~ +1) 구간은 빈 문자열 반환.
 */
export function sentimentEmoji(score: number): string {
  if (score >= 4) return "🔥";
  if (score >= 2) return "🟢";
  if (score <= -4) return "🚨";
  if (score <= -2) return "⚠️";
  return "";
}

/**
 * 감성 결과를 한 줄 요약 문자열로 포맷.
 * 예: "🟢 긍정 신호 (수주, 흑자전환)"
 * 중립이면 빈 문자열 반환.
 */
export function formatSentimentLine(result: SentimentResult): string {
  const emoji = sentimentEmoji(result.score);
  if (!emoji) return "";

  const isPositive = result.score > 0;
  const matches = isPositive ? result.positiveMatches : result.negativeMatches;
  const label = isPositive ? "긍정 신호" : "부정 신호";
  const keywordsStr = matches.slice(0, 3).join(", ");

  return `${emoji} ${label} (${keywordsStr})`;
}
