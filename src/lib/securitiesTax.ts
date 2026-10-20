/**
 * 매도 증권거래세 판정.
 *
 * 국내 상장 ETF·ETN은 매도해도 증권거래세가 없다. 예전엔 가상매매가 모든 매도에 0.18%를 붙여
 * 현금 스윕(KODEX CD금리액티브) 왕복이 손실로 기록됐다 (2026-09-22 전량 현금화 세금 30,970원 → 실제 +8,829원 이익).
 *
 * 판정 순서: stocks.product_type·etf_tax_class(일일 배치가 네이버에서 채움, db/migrations/036)가 있으면 그 값,
 * 없으면(행을 안 읽은 경로·상장 직후) 알려진 코드와 운용사 브랜드 이름으로 대신 판정한다.
 * 그래서 DB 값을 넘기지 않는 예전 호출도 지금처럼 동작한다.
 */

export type ProductType = "stock" | "etf" | "etn" | "other";
export type EtfTaxClass = "domestic_equity" | "other";

/** 판정 입력 — stocks 행의 product_type·etf_tax_class를 함께 넘기면 그 값을 먼저 쓴다 */
export type ProductInfo = {
  code?: string | null;
  name?: string | null;
  productType?: string | null;
  etfTaxClass?: string | null;
};

const KNOWN_ETF_CODES = new Set([
  "459580", // KODEX CD금리액티브(합성) — 현금 스윕
  "357870", // TIGER CD금리투자KIS(합성) — 현금 스윕
  "423160", // KODEX KOFR금리액티브(합성) — 현금 스윕
  "069500", // KODEX 200
  "102110", // TIGER 200
  "229200", // KODEX 코스닥150
  "122630", // KODEX 레버리지 — 예전 지수 1.5배 모드
]);

/**
 * 국내 ETF 운용사 브랜드 — ETF 판별의 단일 출처. 봇 명령·유니버스 제외·웹 매도비용·자녀 계좌가 모두 이것을 쓴다
 * (예전엔 사본 8개가 갈라져 KIWOOM이 빠진 곳이 있었다). 배치의 파이썬 사본(scripts/refresh_universe_membership.py
 * ETF_BRANDS)은 tests/etfBrandSingleSource.test.ts가 같은지 확인한다.
 */
export const ETF_BRANDS = [
  "KODEX", "TIGER", "KBSTAR", "RISE", "ACE", "SOL", "HANARO", "KOSEF", "ARIRANG", "PLUS", "KIWOOM", "TIMEFOLIO",
  "WOORI", "BNK", "UNICORN", "FOCUS", "TREX", "VITA", "마이다스", "에셋플러스", "히어로즈", "파워", "마이티", "KTOP",
  "1Q", "DAISHIN343", "WON",
  // 2026-10-20 네이버 ETF 목록 1,176종 대조로 빠진 브랜드 74종 확인 — 개별주 이름과 겹치지 않음(stocks 전수 확인)
  "TIME", "KoAct", "KCGI", "MIDAS", "DS", "HK", "IBK", "아이엠에셋", "DAISHIN", "TRUSTON", "더제이", "ITF",
] as const;

/** 이름 맨 앞의 브랜드 (같은 지수 상품 묶기에서 떼어 낼 때도 쓴다) */
export const ETF_BRAND_PREFIX = new RegExp(`^(${ETF_BRANDS.join("|")})`, "i");
/**
 * 브랜드 뒤는 공백이나 끝 — 예전 `\b`는 JS에서 한글을 단어 문자로 보지 않아 "BNK금융지주"(은행지주)를 ETF로 잡고
 * (거래세 0·자동매매 후보 제외), "파워 200"·"마이다스 …" 같은 한글 브랜드 ETF는 못 잡았다(2026-10-19 활성 종목 전수 대조).
 * 파이썬 \b는 유니코드 기준이라 결과도 달랐다 — 이 형태는 두 언어에서 같게 동작한다.
 */
const ETF_BRAND_PATTERN = new RegExp(`^(${ETF_BRANDS.join("|")})(?=\\s|$)`, "i");
const ETN_PATTERN = /\bETN\b/i;

/** stocks.product_type 값 정리 — 모르는 값·other는 null(이름 규칙으로 대신 판정) */
function knownProductType(raw: string | null | undefined): Exclude<ProductType, "other"> | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "stock" || v === "etf" || v === "etn" ? v : null;
}

export function isExchangeTradedProduct(code?: string | null, name?: string | null, productType?: string | null): boolean {
  const known = knownProductType(productType);
  if (known) return known !== "stock";
  if (code && KNOWN_ETF_CODES.has(String(code).trim())) return true;
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return false;
  return ETF_BRAND_PATTERN.test(trimmed) || ETN_PATTERN.test(trimmed);
}

/**
 * 주식 매도 증권거래세 (2026-01-01 이후 양도분): 코스피 거래세 0.05% + 농특세 0.15%, 코스닥 0.20% — 둘 다 0.20%.
 * 2024년 0.18%, 2025년 0.15%였다.
 */
export const KRX_SELL_TAX_RATE = 0.002;
/** 예전 코드 기본값이 prefs에 그대로 저장된 값 — 사용자가 고른 게 아니라 당시 법정세율이라 현재 세율로 본다 */
const LEGACY_DEFAULT_TAX_RATES = [0.0018, 0.0015, 0.0023, 0.0025];

/** prefs.virtual_tax_rate → 적용할 기본 세율 (미설정·예전 기본값이면 현재 법정세율) */
export function resolveBaseSellTaxRate(stored: unknown): number {
  const n = Number(stored);
  if (stored == null || stored === "" || !Number.isFinite(n) || n < 0) return KRX_SELL_TAX_RATE;
  if (LEGACY_DEFAULT_TAX_RATES.some((r) => Math.abs(r - n) < 1e-9)) return KRX_SELL_TAX_RATE;
  return n;
}

/** 매도 세율: ETF·ETN이면 0, 아니면 기본 세율 */
export function resolveSellTaxRate(input: { code: string; name?: string | null; productType?: string | null; baseRate: number }): number {
  return isExchangeTradedProduct(input.code, input.name, input.productType) ? 0 : input.baseRate;
}

/**
 * 기타 ETF(국내주식형이 아닌 ETF) 매매차익 과세: 배당소득세 15.4%.
 * KODEX 200 같은 국내주식형 ETF는 매매차익 비과세지만, 해외주식·채권·금·레버리지(선물)·CD금리·KOFR(합성) ETF는
 * 팔 때 이익에 15.4%가 원천징수되고 손실은 다른 매매와 상계되지 않는다 (일반 계좌 기준, ISA·연금계좌는 다름).
 * 과세표준은 원래 min(매매차익, 과표기준가 증가분)이지만 이 상품들은 수익 대부분이 과세 대상이라 매매차익으로 근사한다.
 * 이 세금을 빼지 않으면 가상 계좌가 실제로 따라 할 때보다 좋아 보인다 — 2010~2026 실제 ETF 가격으로
 * 50일선 1.5배 모드는 세전 연 10.4% → 세후 7.9% (50일선 1배 8.2%보다 낮음).
 */
export const OTHER_ETF_GAIN_TAX_RATE = 0.154;

const OTHER_ETF_CODES = new Set([
  "459580", // KODEX CD금리액티브(합성)
  "357870", // TIGER CD금리투자KIS(합성)
  "423160", // KODEX KOFR금리액티브(합성)
  "122630", // KODEX 레버리지
]);

/**
 * 네이버 분류(etfTabCode)와 운용사 공시 과세 유형이 다른 상품의 덮어쓰기 — DB 값보다 먼저 본다.
 * 국내 커버드콜은 같은 성격인데 네이버 분류가 2(국내업종)·3(국내파생)으로 갈려 공시 확인 뒤 여기에 넣는다
 * (docs/plan-etf-product-type-and-tax-2026-10-19.md "정하지 못한 것" 1).
 */
const ETF_TAX_CLASS_OVERRIDES: Record<string, EtfTaxClass> = {};

/**
 * DB 분류가 없을 때의 이름 규칙 — 해외 지역·채권·금리·원자재·파생·합성·혼합이면 기타 ETF.
 * "금"만으로는 "금융"과 겹쳐 금현물·골드·금선물처럼 쓴다. 이 규칙은 대체 판정이라 애매하면 기타(과세) 쪽으로 둔다 —
 * 가상 계좌가 실제보다 좋아 보이지 않게.
 */
const OTHER_ETF_NAME =
  /(미국|나스닥|S&P|다우|글로벌|선진|신흥|아시아|중국|차이나|홍콩|일본|인도|베트남|대만|싱가포르|유럽|유로|독일|국제|채권|국채|국고채|회사채|금융채|은행채|특수채|국공채|통안채|물가채|전단채|단기자금|금리|머니마켓|금현물|골드|금선물|금액티브|은선물|은액티브|원유|WTI|구리|원자재|선물|레버리지|인버스|합성|혼합|멀티에셋|TRF|TDF|TIF|리츠)/i;

/**
 * ETF 매매차익 과세 분류. ETF가 아니거나(개별주·ETN) 판정할 근거가 없으면 null.
 * 순서: 덮어쓰기 → DB etf_tax_class → 알려진 기타 ETF 코드 → 이름 규칙
 */
export function resolveEtfTaxClass(input: ProductInfo): EtfTaxClass | null {
  const code = String(input.code ?? "").trim();
  if (code && ETF_TAX_CLASS_OVERRIDES[code]) return ETF_TAX_CLASS_OVERRIDES[code];
  const known = knownProductType(input.productType);
  // ETN 매매차익 과세(국내주식 지수형만 비과세)는 아직 다루지 않는다
  if (known === "stock" || known === "etn") return null;
  const stored = String(input.etfTaxClass ?? "").trim();
  if (stored === "domestic_equity" || stored === "other") return stored;
  if (code && OTHER_ETF_CODES.has(code)) return "other";
  if (!isExchangeTradedProduct(code, input.name, input.productType)) return null;
  const name = String(input.name ?? "").trim();
  if (!name) return code && KNOWN_ETF_CODES.has(code) ? "domestic_equity" : null;
  if (!known && ETN_PATTERN.test(name)) return null;
  return OTHER_ETF_NAME.test(name) ? "other" : "domestic_equity";
}

/** 매도 이익에 붙는 기타 ETF 매매차익 세금 (해당 없으면 0) */
export function resolveOtherEtfGainTax(input: ProductInfo & { code: string; gain: number }): number {
  if (resolveEtfTaxClass(input) !== "other") return 0;
  return input.gain > 0 ? Math.round(input.gain * OTHER_ETF_GAIN_TAX_RATE) : 0;
}
