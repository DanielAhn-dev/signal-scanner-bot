/**
 * 매도 증권거래세 판정.
 *
 * 국내 상장 ETF·ETN은 매도해도 증권거래세가 없다. 예전엔 가상매매가 모든 매도에 0.18%를 붙여
 * 현금 스윕(KODEX CD금리액티브) 왕복이 손실로 기록됐다 (2026-09-22 전량 현금화 세금 30,970원 → 실제 +8,829원 이익).
 * stocks 테이블에 상품 유형 컬럼이 없어 운용사 브랜드명과 알려진 코드로 판별한다.
 */

const KNOWN_ETF_CODES = new Set([
  "459580", // KODEX CD금리액티브(합성) — 현금 스윕
  "069500", // KODEX 200
  "229200", // KODEX 코스닥150
]);

const ETF_BRAND_PATTERN =
  /^(KODEX|TIGER|KBSTAR|RISE|ACE|SOL|HANARO|KOSEF|ARIRANG|PLUS|KIWOOM|TIMEFOLIO|WOORI|BNK|UNICORN|FOCUS|TREX|VITA|마이다스|에셋플러스|히어로즈|파워|마이티|KTOP|1Q|DAISHIN343|WON)\b/i;
const ETN_PATTERN = /\bETN\b/i;

export function isExchangeTradedProduct(code: string, name?: string | null): boolean {
  if (KNOWN_ETF_CODES.has(String(code).trim())) return true;
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return false;
  return ETF_BRAND_PATTERN.test(trimmed) || ETN_PATTERN.test(trimmed);
}

/** 매도 세율: ETF·ETN이면 0, 아니면 기본 세율 */
export function resolveSellTaxRate(input: { code: string; name?: string | null; baseRate: number }): number {
  return isExchangeTradedProduct(input.code, input.name) ? 0 : input.baseRate;
}
