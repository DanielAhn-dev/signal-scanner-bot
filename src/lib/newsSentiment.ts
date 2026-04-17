// src/lib/newsSentiment.ts
// 뉴스 제목 감성 분석 — 키워드 매칭 기반 (외부 API 불필요)

/** 매칭된 키워드와 출처 기사 인덱스 (0 = 최신) */
export interface MatchDetail {
  keyword: string;
  titleIndex: number;
}

export interface SentimentResult {
  /** -10 ~ +10 */
  score: number;
  /** 하위호환 — 매칭된 긍정 키워드 목록 */
  positiveMatches: string[];
  /** 하위호환 — 매칭된 부정 키워드 목록 */
  negativeMatches: string[];
  /** 긍정 키워드별 출처 기사 인덱스 포함 상세 */
  positiveDetails: MatchDetail[];
  /** 부정 키워드별 출처 기사 인덱스 포함 상세 */
  negativeDetails: MatchDetail[];
}

// ─── 긍정 키워드 ──────────────────────────────────────────────────────────────

const POSITIVE_KEYWORDS: readonly string[] = [
  // 계약·수주
  "수주잔고", "수주잔액", "수주계약", "수주",
  "공급계약", "수출계약", "계약 체결",
  "MOU", "업무협약", "전략적 제휴",
  // 실적
  "어닝서프라이즈", "영업이익 증가", "영업이익 개선", "영업이익률 개선",
  "흑자전환", "흑자", "실적 호조",
  "매출 신기록", "역대 최대", "사상 최대", "매출 성장",
  "수익성 개선", "이익 개선",
  // 투자의견·등급
  "신용등급 상향", "투자의견 상향", "목표가 상향",
  "적극매수", "강력매수", "매수 추천", "상향",
  // 주주환원
  "특별배당", "배당 확대", "배당 증가",
  "자사주 매입", "자사주 취득",
  "무상증자",
  // 성장·확장
  "생산능력 확대", "증설", "해외 진출", "사업 확장",
  "신제품", "신사업", "신규 진출",
  // 채권·자금조달
  "초과청약", "수요예측 흥행", "회사채 흥행",
  // 기술·인증
  "기술수출", "FDA 승인", "임상 성공", "특허",
  // 수급
  "기관 순매수", "외국인 순매수",
];

// ─── 부정 키워드 — 구체적 구절 위주, 문맥 없이도 명확한 부정 사건 ─────────────

const NEGATIVE_KEYWORDS: readonly string[] = [
  // 자본 훼손
  "유상증자", "무상감자",
  // 부정행위 (단어 단위 아닌 구체적 구절)
  "횡령 기소", "횡령 적발", "횡령 발생", "횡령 혐의",
  "배임 기소", "배임 발생", "배임 혐의",
  "분식회계", "주가조작",
  // 영업·운영
  "유동성 위기", "자금난",
  "상장폐지", "거래정지", "영업정지",
  // 실적
  "대규모 적자", "매출 급감", "적자전환", "영업손실", "실적 쇼크",
  // 투자의견·등급
  "신용등급 하향", "투자의견 하향", "목표가 하향", "매도 의견", "하향",
  // 법적·행정
  "검찰 수사", "행정처분", "과징금", "벌금", "소송", "결함", "리콜",
  // 손실
  "손상차손", "대규모 손실",
  // 공시
  "감사의견 거절", "감사의견 한정", "회계오류", "불성실공시",
  // 기타
  "경영권 분쟁", "워크아웃", "부도",
  "공매도 과열", "대주주 매도",
];

// ─── 같은 제목 내 완화·극복 표현 — 부정 점수 무효화 ─────────────────────────

const NEGATION_PATTERNS: readonly string[] = [
  "이겨냈다", "극복", "해소", "해결", "일단락",
  "불구하고", "에도 불구",
  "흥행", "성공", "호조", "회복",
  "승소",
];

function hasMitigatingContext(title: string): boolean {
  return NEGATION_PATTERNS.some((p) => title.includes(p));
}

// ─── 긴 키워드 우선 매칭 (짧은 서브스트링 중복 방지) ─────────────────────────
// 예: "목표가 상향" 매칭 후 "상향" 단독 재매칭 방지

const SORTED_POSITIVE = [...POSITIVE_KEYWORDS].sort((a, b) => b.length - a.length);
const SORTED_NEGATIVE = [...NEGATIVE_KEYWORDS].sort((a, b) => b.length - a.length);

// ─── 분석 함수 ────────────────────────────────────────────────────────────────

/**
 * 뉴스 제목 배열로부터 감성 점수를 계산한다.
 *
 * - titles[0]이 최신 기사 (네이버 금융 API 기준 내림차순)
 * - 최신 기사 (index 0~1): 매칭당 ±2점 / 오래된 기사 (index 2+): ±1점
 * - 긴 키워드 우선 매칭 → 동일 제목에서 서브스트링 중복 방지
 * - 부정 키워드라도 같은 제목에 완화 표현이 있으면 무효화
 * - 동일 키워드 중복 카운트 없음 (기사 전체 기준)
 * - score 범위: -10 ~ +10
 */
export function analyzeNewsSentiment(titles: string[]): SentimentResult {
  const positiveDetails: MatchDetail[] = [];
  const negativeDetails: MatchDetail[] = [];
  const seenPositive = new Set<string>();
  const seenNegative = new Set<string>();
  let rawScore = 0;

  for (let i = 0; i < titles.length; i++) {
    const weight = i <= 1 ? 2 : 1;

    // 소비 추적용 작업 사본 — 긴 키워드 매칭 후 해당 구간을 공백으로 치환
    let workingPositive = titles[i];
    let workingNegative = titles[i];

    for (const kw of SORTED_POSITIVE) {
      if (workingPositive.includes(kw) && !seenPositive.has(kw)) {
        seenPositive.add(kw);
        positiveDetails.push({ keyword: kw, titleIndex: i });
        rawScore += weight;
        workingPositive = workingPositive.split(kw).join(" ".repeat(kw.length));
      }
    }

    for (const kw of SORTED_NEGATIVE) {
      if (workingNegative.includes(kw) && !seenNegative.has(kw)) {
        if (!hasMitigatingContext(titles[i])) {
          seenNegative.add(kw);
          negativeDetails.push({ keyword: kw, titleIndex: i });
          rawScore -= weight;
          workingNegative = workingNegative.split(kw).join(" ".repeat(kw.length));
        }
      }
    }
  }

  const score = Math.max(-10, Math.min(10, rawScore));

  return {
    score,
    positiveMatches: positiveDetails.map((d) => d.keyword),
    negativeMatches: negativeDetails.map((d) => d.keyword),
    positiveDetails,
    negativeDetails,
  };
}

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────────────

export function sentimentEmoji(score: number): string {
  if (score >= 4) return "🔥";
  if (score >= 2) return "🟢";
  if (score <= -4) return "🚨";
  if (score <= -2) return "⚠️";
  return "";
}

/**
 * 감성 결과를 한 줄 요약으로 포맷.
 * 예: "🟢 긍정 신호 (초과청약 #1, 수주 #3)"
 * 중립이면 빈 문자열 반환.
 */
export function formatSentimentLine(result: SentimentResult): string {
  const emoji = sentimentEmoji(result.score);
  if (!emoji) return "";

  const isPositive = result.score > 0;
  const details = isPositive ? result.positiveDetails : result.negativeDetails;
  const label = isPositive ? "긍정 신호" : "부정 신호";

  const keywordsStr = details
    .slice(0, 3)
    .map((d) => `${d.keyword} #${d.titleIndex + 1}`)
    .join(", ");

  return `${emoji} ${label} (${keywordsStr})`;
}
