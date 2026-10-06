/**
 * 실계좌 리밸런싱 가이드 — 직접 입력한 계좌 보유(virtual_positions의 증권사·계좌명 행)를 바구니로 나누고,
 * "모으기 → 전환 → 인컴" 단계별 목표 비중과 비교해 무엇을 얼마나 옮길지 안내한다. DB·API 없이 계산만 한다.
 * 봇 매매와는 무관하다 — 안내만 하고 주문하지 않는다.
 *
 * 근거 (2026-10-01 검증, 블로그 3편 "코스피냐 미국이냐, 성장이냐 분배금이냐"):
 *   - 코스피·S&P500(원화) 2003~2026 연수익은 같았고(12.0%), 50:50 매년 리밸런싱이 5년 최악 1.11배로 둘 다(0.83·0.94)보다 나았다.
 *   - 리밸런싱은 수익보다 낙폭을 줄였다(−41.7% → −36.4%). 10년 방치하면 50:50이 22:78~62:38로 벌어졌다.
 *   - 국내 고배당은 같은 생활비를 10년 꺼내 쓸 때 다중 시작점 대부분에서 지수와 비슷하거나 원금을 더 남겼다(세후 포함, H12
 *     validate_income_withdrawal_multistart.py — 10/06 이전 "랠리에서 크게 뒤졌다"는 단일 시작점 결과). 지수가 강한 창에서만 뒤졌다.
 *     커버드콜은 이와 별개로 장기 열위 → 분배형 비중 상한(MAX_INCOME_PCT)은 유지한다.
 *   - 커버드콜은 장기 연 4~11%p 뒤처짐, 리츠는 2022 금리 상승기 −34~−54%, 레버리지는 세후 이득 없음.
 *   - 필요 인출률(생활비 ÷ 자산)이 갈림길: 50:50에서 4%까지는 15년 뒤 실질 원금 100% 유지, 8%면 15%.
 */
import { isExchangeTradedProduct } from "./securitiesTax";

export type AssetBucket =
  | "kr_index"
  | "global_index"
  | "dividend"
  | "covered_call"
  | "reit_infra"
  | "bond_cash"
  | "leveraged"
  | "stock"
  | "other_etf";

export type BucketGroup = "growth" | "income" | "satellite" | "cash";

export const BUCKET_GROUP: Record<AssetBucket, BucketGroup> = {
  kr_index: "growth",
  global_index: "growth",
  dividend: "income",
  covered_call: "income",
  reit_infra: "income",
  bond_cash: "cash",
  leveraged: "satellite",
  stock: "satellite",
  other_etf: "satellite",
};

export const BUCKET_LABEL: Record<AssetBucket, string> = {
  kr_index: "국내 지수",
  global_index: "해외 지수",
  dividend: "배당",
  covered_call: "커버드콜",
  reit_infra: "리츠·인프라",
  bond_cash: "채권·현금성",
  leveraged: "레버리지·인버스",
  stock: "개별주",
  other_etf: "테마·기타 ETF",
};

export const GROUP_LABEL: Record<BucketGroup, string> = {
  growth: "성장 (지수)",
  income: "인컴 (분배형)",
  satellite: "위성 (개별주·테마)",
  cash: "현금성",
};

/** 국내 고배당 ETF 2019~2025 분배율 4~6% — 인컴 단계 목표 비중 계산에 쓰는 보수적 가정 */
export const DISTRIBUTION_YIELD_PCT = 4.5;
/** 목표 비중에서 이만큼(%p) 벗어나면 정기 점검을 기다리지 않고 옮긴다 */
export const REBALANCE_BAND_PP = 10;
/** 인컴 시작 몇 년 전부터 분배형으로 옮기기 시작하는지 */
export const TRANSITION_YEARS = 5;
/** 모으는 동안 분배형 비중 — 분배금이 실제로 어떻게 들어오는지 경험·기록하는 정도 */
export const ACCUMULATE_INCOME_PCT = 10;
/** 인컴 단계에서 분배형이 차지할 수 있는 최대 비중 — 나머지는 물가 대응·위기 완충용 성장형 */
export const MAX_INCOME_PCT = 70;

/**
 * 나이대별 현금성(채권·CD·예금) 최소 비중 — "100 − 나이" 계열 관례를 구간 중앙값으로 옮긴 값이다(검증된 정답이 아니다).
 * 근거는 2026-10-01 검증: 주식 100%는 10년 월 적립에서 최대 평가손실이 중앙 −29%·최악 −46%, 80:20은 −21%·−37%, 60:40은 −13%·−28%.
 * 리밸런싱은 수익을 2~4% 내주고 낙폭·최악을 줄이는 도구이므로, 몇 대 몇인지는 "이번 7월(−39%)을 겪어도 안 팔 수 있는 비중"으로 정한다.
 * 생년월일 대신 나이대만 받는다(개인정보 최소화). 인컴 단계는 생활비 기준 비중이 따로 있어 적용하지 않는다.
 */
export type AgeBand = "20s" | "30s" | "40s" | "50s" | "60s";
export const AGE_BANDS: Record<AgeBand, { label: string; safePct: number; note: string }> = {
  "20s": { label: "20대", safePct: 10, note: "시간이 길어 지수 위주로 모읍니다. 평가손실 −40%대가 와도 적립을 거르지 않는 것이 핵심입니다." },
  "30s": { label: "30대", safePct: 25, note: "주식 70~80%. 목돈 지출(주택·결혼 등)이 5년 안에 있으면 그 몫은 현금성으로 따로 빼 두세요." },
  "40s": { label: "40대", safePct: 35, note: "주식 60~70%. 자녀 교육·노후 준비가 겹치는 시기라 낙폭을 줄이는 쪽에 무게를 둡니다." },
  "50s": { label: "50대", safePct: 45, note: "주식 50~60%. 인컴 시작 5년 전부터 분배형·현금성으로 옮기는 단계 전환을 같이 쓰세요." },
  "60s": { label: "60대 이상", safePct: 60, note: "주식 30~40%. 최악의 해를 만나도 생활비 몇 년치가 남도록 현금성을 두텁게 둡니다." },
};
export const AGE_BAND_KEYS = Object.keys(AGE_BANDS) as AgeBand[];

/** 필요 인출률별 15년 뒤 물가를 뺀 원금 유지 비율 (2003~2011 월말 시작 93개, 첫해 인출액 매년 2.5% 증액) */
export const WITHDRAWAL_EVIDENCE: Array<{ ratePct: number; mixKeepPct: number; mixWorstPct: number; krOnlyKeepPct: number }> = [
  { ratePct: 3, mixKeepPct: 100, mixWorstPct: 126, krOnlyKeepPct: 71 },
  { ratePct: 4, mixKeepPct: 100, mixWorstPct: 102, krOnlyKeepPct: 48 },
  { ratePct: 5, mixKeepPct: 89, mixWorstPct: 78, krOnlyKeepPct: 30 },
  { ratePct: 6, mixKeepPct: 71, mixWorstPct: 54, krOnlyKeepPct: 18 },
  { ratePct: 8, mixKeepPct: 15, mixWorstPct: 3, krOnlyKeepPct: 1 },
  { ratePct: 10, mixKeepPct: 0, mixWorstPct: 0, krOnlyKeepPct: 0 },
];

const FOREIGN_WORDS = /(미국|중국|일본|인도|베트남|대만|유럽|독일|글로벌|선진|신흥|나스닥|S&P|다우|차이나|홍콩)/i;
const KR_SECTOR_WORDS = /(\bIT\b|금융|에너지|헬스케어|철강|건설|중공업|소비재|커뮤니케이션|산업재|중소형|반도체|2차전지|바이오|자동차|조선|방산)/;

/**
 * 종목명·코드로 바구니를 정한다. stocks 테이블에 상품 유형 컬럼이 없어 이름 규칙으로 판별한다(securitiesTax.ts와 같은 방식).
 * 순서가 중요하다 — "배당커버드콜"은 커버드콜, "채권혼합"은 기타, "AI전력인프라" ETF는 테마로 본다.
 */
export function classifyHolding(code: string, name: string | null | undefined): AssetBucket {
  const n = String(name ?? "").trim();
  const etp = isExchangeTradedProduct(code, n);
  if (/레버리지|인버스|곱버스|\b[23]X\b/i.test(n)) return "leveraged";
  if (/커버드콜|프리미엄/.test(n)) return "covered_call";
  if (/리츠|부동산/.test(n)) return "reit_infra";
  if (!etp && /인프라/.test(n)) return "reit_infra"; // 맥쿼리인프라·KB발해인프라 같은 상장 인프라 펀드
  if (!etp) return "stock";
  if (/혼합/.test(n)) return "other_etf";
  if (/채권|국채|국고채|단기채|회사채|금리|\bCD\b|KOFR|SOFR|머니마켓|MMF|단기자금|달러예금/i.test(n)) return "bond_cash";
  if (/배당/.test(n)) return "dividend";
  if (/(S&P\s?500|나스닥\s?100|NASDAQ\s?100|미국대형|다우존스|MSCI\s?(World|ACWI|선진)|선진국|전세계|ACWI|토탈월드|미국S&P)/i.test(n)) {
    return "global_index";
  }
  if (/(코스피|KOSPI|200|KRX\s?300|코스닥\s?150|MSCI\s?KOREA|밸류업)/i.test(n) && !FOREIGN_WORDS.test(n) && !KR_SECTOR_WORDS.test(n)) {
    return "kr_index";
  }
  return "other_etf";
}

/** ISA·연금·IRP처럼 분배금·해외 ETF 과세가 미뤄지거나 줄어드는 계좌인지 (계좌 이름으로 판별) */
export function isTaxAdvantagedAccount(label: string | null | undefined): boolean {
  return /ISA|연금|IRP|퇴직/i.test(String(label ?? ""));
}

export type IncomeGuideSettings = {
  /** 인컴 단계에서 매달 필요한 생활비 (원, 세후) */
  monthlyNeed: number;
  /** 인컴을 받기 시작할 달 (YYYY-MM). 없으면 계속 모으는 단계로 본다 */
  incomeStart?: string;
  /** 위성(개별주·테마·레버리지) 상한 % — 넘으면 줄이라고 안내 */
  satelliteCapPct: number;
  /** 성장 바구니 안에서 해외 지수 목표 비중 % */
  overseasPct: number;
  /**
   * 직접 정한 목표 비중 % — 엑셀로 관리하던 비중을 그대로 쓰고 싶을 때. 넣은 바구니만 단계 기본값 대신 쓰고,
   * 성장은 나머지로 채운다(위성은 상한으로만 다룬다). 비우면 단계 기본값.
   */
  customTargets?: { income?: number; cash?: number };
  /**
   * 일반 계좌에서 받을 과세 금융소득(이자·분배금) 연 상한 (원). 기본 1천만 — 건강보험 지역가입자는 금융소득이 연 1천만원을
   * 넘으면 전액이 보험료 소득에 잡히고, 연 2천만원을 넘으면 종합과세·피부양자 탈락 기준이 된다(기준은 해마다 확인 필요).
   * ISA·연금 계좌 안의 분배금은 여기에 넣지 않는다.
   */
  financialIncomeCap: number;
  /** 나이대(선택). 있으면 모으기·전환 단계의 현금성 목표 비중에 나이대별 하한을 둔다 */
  ageBand?: AgeBand;
};

export const DEFAULT_INCOME_GUIDE_SETTINGS: IncomeGuideSettings = {
  monthlyNeed: 500_000,
  satelliteCapPct: 10,
  overseasPct: 50,
  financialIncomeCap: 10_000_000,
};

/**
 * 바구니별 연 분배율 가정 % — 과세 금융소득 추정용. 2022~2025 실제 분배 기록 기준:
 * 국내 고배당 4~6%, 커버드콜ATM 8~9%, 맥쿼리인프라 6~7%, KODEX 200 약 2%, S&P500 ETF 약 1%, 채권·CD금리 3% 안팎.
 */
export const BUCKET_YIELD_PCT: Record<AssetBucket, number> = {
  kr_index: 2,
  global_index: 1.2,
  dividend: 4.5,
  covered_call: 8.5,
  reit_infra: 6.5,
  bond_cash: 3,
  leveraged: 0,
  stock: 2,
  other_etf: 1,
};

/** 분배금 과세율(배당소득세, 지방세 포함) */
const DISTRIBUTION_TAX = 0.154;

/** 바구니별 평가금에 분배율 가정을 곱한 연 세전 분배금과 월 세후 추정 */
export function estimateDistribution(byBucket: Map<AssetBucket, number>): IncomeGuideView["distribution"] {
  let annualGross = 0;
  for (const [bucket, value] of byBucket) annualGross += value * (BUCKET_YIELD_PCT[bucket] / 100);
  return {
    annualGross: Math.round(annualGross),
    monthlyNet: Math.round((annualGross * (1 - DISTRIBUTION_TAX)) / 12),
    taxRate: DISTRIBUTION_TAX,
    isEstimate: true,
  };
}

export function sanitizeIncomeGuideSettings(input: Partial<IncomeGuideSettings>, current: IncomeGuideSettings): IncomeGuideSettings {
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return v != null && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  // 목표 비중: 빈 값("")·null은 그 바구니를 단계 기본값으로 되돌린다
  const customIn = (input.customTargets ?? undefined) as Record<string, unknown> | undefined;
  const customCur = current.customTargets ?? {};
  const pick = (key: "income" | "cash"): number | undefined => {
    if (!customIn || !(key in customIn)) return customCur[key];
    const v = customIn[key];
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(90, Math.max(0, n)) : customCur[key];
  };
  const income = pick("income");
  let cash = pick("cash");
  if (income != null && cash != null && income + cash > 100) cash = 100 - income;
  const customTargets = income != null || cash != null ? { ...(income != null ? { income } : {}), ...(cash != null ? { cash } : {}) } : undefined;
  return {
    customTargets,
    monthlyNeed: num(input.monthlyNeed, current.monthlyNeed, 0, 1e9),
    incomeStart:
      input.incomeStart === ""
        ? undefined
        : /^\d{4}-\d{2}$/.test(String(input.incomeStart ?? ""))
          ? String(input.incomeStart)
          : current.incomeStart,
    satelliteCapPct: num(input.satelliteCapPct, current.satelliteCapPct, 0, 50),
    overseasPct: num(input.overseasPct, current.overseasPct, 0, 100),
    financialIncomeCap: num(input.financialIncomeCap, current.financialIncomeCap ?? DEFAULT_INCOME_GUIDE_SETTINGS.financialIncomeCap, 0, 1e10),
    ageBand:
      input.ageBand === ("" as unknown)
        ? undefined
        : AGE_BAND_KEYS.includes(input.ageBand as AgeBand)
          ? (input.ageBand as AgeBand)
          : current.ageBand,
  };
}

export type GuideHolding = {
  code: string;
  name: string;
  quantity: number;
  price: number;
  accountKey: string;
  accountLabel: string;
  /** 평균 매수가 — 팔 때 확정되는 손익 계산용 (없으면 손익을 보여 주지 않는다) */
  avgPrice?: number | null;
};

export type GuideOrder = {
  side: "sell" | "buy";
  code: string;
  name: string;
  accountLabel: string;
  group: BucketGroup;
  price: number;
  shares: number;
  amount: number;
  /** 매도로 확정되는 손익 (평균 매수가를 알 때만) */
  realizedGain: number | null;
};

/** 보유 종목이 없는 바구니라 새 상품을 골라 사야 하는 금액 */
export type UnfilledBuy = { group: BucketGroup; bucket?: AssetBucket; amount: number };

export type GuideStage = "accumulate" | "transition" | "income";

export type GroupRow = {
  group: BucketGroup;
  label: string;
  value: number;
  actualPct: number;
  targetPct: number;
  diffPct: number;
  /** 목표까지 옮길 금액 (+ 사야 함 / − 줄여야 함) */
  diffAmount: number;
};

export type GuideWarning = { level: "info" | "warn" | "alert"; title: string; text: string };

export type IncomeGuideView = {
  today: string;
  settings: IncomeGuideSettings;
  total: number;
  holdingCount: number;
  stage: { key: GuideStage; title: string; text: string; yearsToIncome: number | null };
  need: {
    annual: number;
    /** 지금 자산 대비 필요 인출률 % */
    ratePct: number;
    /** 분배형만으로 생활비를 만들 때 필요한 원금 */
    capitalByDistribution: number;
    /** 지수에서 연 4%씩 꺼내 쓸 때 필요한 원금 */
    capitalByWithdrawal4: number;
    evidence: (typeof WITHDRAWAL_EVIDENCE)[number] | null;
  };
  groups: GroupRow[];
  growthSplit: { krValue: number; globalValue: number; globalPct: number; targetGlobalPct: number };
  buckets: Array<{ bucket: AssetBucket; label: string; value: number; pct: number }>;
  /** 보유 바구니별 분배율 가정(BUCKET_YIELD_PCT)으로 낸 추정 — 실제 입금액이 아니다. 실제 기록이 있으면 그것을 우선한다 */
  distribution: { annualGross: number; monthlyNet: number; taxRate: number; isEstimate: true };
  rebalance: {
    needed: boolean;
    reason: string;
    moves: Array<{ from: BucketGroup; to: BucketGroup; amount: number }>;
    /** 성장 바구니 안 국내↔해외 조정 (목표 성장 금액 기준, 1만원 미만이면 null) */
    growthShift: { to: "global_index" | "kr_index"; amount: number } | null;
    trims: Array<{ group: BucketGroup; holdings: Array<{ code: string; name: string; accountLabel: string; value: number }> }>;
    /** 종목별 주문안 (엑셀로 하던 "몇 주 팔고 몇 주 살지") — 매도가 먼저, 매도 대금으로 매수 */
    orders: GuideOrder[];
    unfilled: UnfilledBuy[];
    /** 매도로 확정되는 손익 합계 (평균 매수가를 아는 종목만) */
    realizedGainTotal: number;
  };
  /** 새로 넣을 돈을 모자란 바구니부터 채우는 안 (팔지 않고 맞추기). 넣을 돈이 없으면 null */
  contribution: {
    amount: number;
    allocations: Array<{ group: BucketGroup; amount: number }>;
    orders: GuideOrder[];
    unfilled: UnfilledBuy[];
    /** 넣은 뒤에도 ±밴드를 넘는 바구니가 남는지 */
    stillOutOfBand: boolean;
  } | null;
  /** 목표 비중이 단계 기본값인지, 직접 정한 값인지 */
  targetSource: "stage" | "custom";
  /** 나이대 설정이 있을 때: 현금성 하한과 매매 방법 안내. 설정 없으면 null */
  age: { band: AgeBand; label: string; safePct: number; applied: boolean; lines: string[] } | null;
  /**
   * 예상 분배금 (바구니별 분배율 가정). 과세 = 일반 계좌, 절세 = ISA·연금 계좌.
   * 여유 = 상한 − 과세 분배금, 여유를 고배당(4.5%)으로 채우려면 필요한 금액.
   */
  distributions: {
    taxableAnnual: number;
    shelteredAnnual: number;
    cap: number;
    headroom: number;
    headroomAsDividendCapital: number;
    /** 일반 계좌 과세 분배금 중 커버드콜 몫 */
    taxableFromCoveredCall: number;
  };
  warnings: GuideWarning[];
  accounts: Array<{
    key: string;
    label: string;
    taxAdvantaged: boolean;
    total: number;
    byGroup: Record<BucketGroup, number>;
  }>;
  holdings: Array<GuideHolding & { value: number; bucket: AssetBucket; group: BucketGroup; pct: number }>;
};

function monthsUntil(today: string, targetMonth: string): number {
  const [y1, m1] = today.slice(0, 7).split("-").map(Number);
  const [y2, m2] = targetMonth.slice(0, 7).split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 단계와 그 단계의 인컴·현금성 목표 비중.
 * 인컴 단계 목표 = 생활비 × 12 ÷ 분배율 4.5% ÷ 자산 (10~70%), 현금성 = 생활비 12개월치 (5~25%).
 * 전환 단계는 인컴 시작 5년 전부터 모으기 비중에서 인컴 단계 비중으로 해마다 고르게 옮긴다.
 */
function resolveBaseStageTargets(input: { settings: IncomeGuideSettings; total: number; today: string }): {
  stage: GuideStage;
  yearsToIncome: number | null;
  incomePct: number;
  cashPct: number;
} {
  const { settings, total, today } = input;
  const annual = settings.monthlyNeed * 12;
  const incomeAtStart = total > 0 ? clamp((annual / (DISTRIBUTION_YIELD_PCT / 100) / total) * 100, ACCUMULATE_INCOME_PCT, MAX_INCOME_PCT) : ACCUMULATE_INCOME_PCT;
  const cashAtStart = total > 0 ? clamp((annual / total) * 100, 5, 25) : 5;
  if (!settings.incomeStart) return { stage: "accumulate", yearsToIncome: null, incomePct: ACCUMULATE_INCOME_PCT, cashPct: 0 };
  const years = monthsUntil(today, settings.incomeStart) / 12;
  if (years <= 0) return { stage: "income", yearsToIncome: years, incomePct: incomeAtStart, cashPct: cashAtStart };
  if (years > TRANSITION_YEARS) return { stage: "accumulate", yearsToIncome: years, incomePct: ACCUMULATE_INCOME_PCT, cashPct: 0 };
  // 남은 햇수 기준으로 매년 한 번씩 계단식으로 옮긴다 (5년 전 0단계 … 0년 전 5단계)
  const step = clamp(TRANSITION_YEARS - Math.ceil(years) + 1, 0, TRANSITION_YEARS) / TRANSITION_YEARS;
  return {
    stage: "transition",
    yearsToIncome: years,
    incomePct: ACCUMULATE_INCOME_PCT + (incomeAtStart - ACCUMULATE_INCOME_PCT) * step,
    cashPct: cashAtStart * step,
  };
}

/** 단계 기본 목표에 나이대별 현금성 하한을 얹는다. 인컴 단계는 생활비 기준을 그대로 쓴다. */
export function resolveStageTargets(input: { settings: IncomeGuideSettings; total: number; today: string }): ReturnType<typeof resolveBaseStageTargets> {
  const base = resolveBaseStageTargets(input);
  const band = input.settings.ageBand;
  if (!band || !AGE_BANDS[band] || base.stage === "income") return base;
  const floor = Math.min(AGE_BANDS[band].safePct, Math.max(0, 100 - base.incomePct));
  return { ...base, cashPct: Math.max(base.cashPct, floor) };
}

function buildAgeGuide(band: AgeBand, stage: GuideStage, cashPct: number, cashCustom: boolean): NonNullable<IncomeGuideView["age"]> {
  const b = AGE_BANDS[band];
  const applied = stage !== "income" && !cashCustom;
  return {
    band,
    label: b.label,
    safePct: b.safePct,
    applied,
    lines: [
      b.note,
      applied
        ? `현금성 목표 ${cashPct.toFixed(0)}% (나이대 하한 ${b.safePct}%). 채권·CD·예금처럼 하락장에서 꺼내 쓸 몫입니다.`
        : stage === "income"
          ? "인컴 단계는 생활비 기준 비중을 쓰므로 나이대 하한은 적용하지 않습니다."
          : "내 목표(현금성)를 직접 넣어 두어 나이대 하한은 적용하지 않습니다.",
      "새 돈은 팔지 않고 가장 모자란 바구니부터 채웁니다. 점검은 1년에 한 번, 목표에서 ±10%p를 넘을 때만 따로 맞춥니다(월 단위로 자주 맞춰도 낙폭 개선은 거의 같고 수익만 줄었습니다). 2012~2026 4자산 검증에서 이 방식은 파는 횟수가 수십 년에 한두 번이었고, 자산이 월 적립액의 5년치를 넘어서면 새 돈만으로 못 맞추는 달이 늘었습니다.",
      "시장을 보고 비중을 바꾸지 않습니다. 비중을 바꾸는 이유는 나이·목표 시점이 바뀔 때뿐입니다.",
    ],
  };
}

const STAGE_TEXT: Record<GuideStage, { title: string; text: string }> = {
  accumulate: {
    title: "모으기",
    text: "성장형(국내·해외 지수) 위주로 모읍니다. 분배형은 경험·기록용으로 10% 안팎만 두고, 나오는 분배금은 성장형에 재투자하세요. 1년에 한 번 목표 비중으로 맞춥니다.",
  },
  transition: {
    title: "전환",
    text: "인컴 시작 5년 전부터 매년 한 번, 정해 둔 만큼만 분배형과 현금성으로 옮깁니다. 시장을 보고 속도를 바꾸지 않는 것이 핵심입니다.",
  },
  income: {
    title: "인컴",
    text: "분배금으로 생활비를 받고, 성장형은 물가 대응과 위기 때 꺼내 쓸 완충으로 남깁니다. 1년치 생활비는 현금성으로 두세요.",
  },
};

/** 점검 기록 한 줄 — "리밸런싱함" 버튼을 누른 날의 비중과 목표 (엑셀 시트의 이력 탭 역할) */
export type GuideHistoryEntry = {
  date: string;
  total: number;
  groups: Array<{ group: BucketGroup; actualPct: number; targetPct: number }>;
  note?: string;
};

export function toHistoryEntry(view: IncomeGuideView, note?: string): GuideHistoryEntry {
  return {
    date: view.today,
    total: view.total,
    groups: view.groups.map((g) => ({ group: g.group, actualPct: Math.round(g.actualPct * 10) / 10, targetPct: Math.round(g.targetPct * 10) / 10 })),
    ...(note ? { note: String(note).slice(0, 200) } : {}),
  };
}

/** 바구니 비중이 모두 0.5%p 안이면 같은 상태로 본다 (가격이 조금 움직인 것만으로 새 기록이 되지 않게) */
function sameMix(a: GuideHistoryEntry["groups"], b: GuideHistoryEntry["groups"]): boolean {
  const pick = (gs: GuideHistoryEntry["groups"], g: BucketGroup) => gs.find((x) => x.group === g)?.actualPct ?? 0;
  return (["growth", "income", "satellite", "cash"] as BucketGroup[]).every((g) => Math.abs(pick(a, g) - pick(b, g)) < 0.5);
}

/**
 * 같은 날이라도 비중이 바뀌었으면 따로 남긴다 — 옮기기 전에 한 번, 옮긴 뒤에 한 번 눌러 전후를 비교할 수 있게.
 * 같은 날 같은 비중이면 덮어쓴다(메모만 고친 경우). 날짜순, 최근 120개만 남긴다.
 */
export function appendHistory(history: GuideHistoryEntry[], entry: GuideHistoryEntry): GuideHistoryEntry[] {
  const kept = history.filter((h) => !(h.date === entry.date && sameMix(h.groups, entry.groups)));
  return [...kept, entry].sort((a, b) => a.date.localeCompare(b.date)).slice(-120);
}

/** 목표와의 거리 — 목표 비중에 맞추려면 전체 평가액의 몇 %를 옮겨야 하는지 (|실제 − 목표| 합의 절반) */
export function distanceFromTarget(groups: Array<{ actualPct: number; targetPct: number }>): number {
  return Math.round((groups.reduce((s, g) => s + Math.abs(g.actualPct - g.targetPct), 0) / 2) * 10) / 10;
}

/** 계좌 건강 한 시점 — 수익률은 넣지 않는다(몇 달 단위 수익은 잡음이고, 그 숫자를 보고 규칙을 흔들게 된다) */
export type HealthPoint = {
  date: string;
  total: number;
  distancePp: number;
  /** 목표 ±10%p를 넘은 바구니 수 */
  outOfBand: number;
  satellitePct: number;
  cashPct: number;
  note?: string;
};

export function toHealthPoint(e: GuideHistoryEntry): HealthPoint {
  const pick = (g: BucketGroup) => e.groups.find((x) => x.group === g)?.actualPct ?? 0;
  return {
    date: e.date,
    total: e.total,
    distancePp: distanceFromTarget(e.groups),
    outOfBand: e.groups.filter((g) => Math.abs(g.actualPct - g.targetPct) > REBALANCE_BAND_PP).length,
    satellitePct: pick("satellite"),
    cashPct: pick("cash"),
    ...(e.note ? { note: e.note } : {}),
  };
}

export type GuideComparison = {
  base: HealthPoint;
  now: HealthPoint;
  groups: Array<{ group: BucketGroup; beforePct: number; nowPct: number; targetPct: number }>;
  verdict: "closer" | "farther" | "same";
  text: string;
};

/**
 * 직전 기록과 지금 비교 — "직전 점검 때 이랬는데 지금은 이렇다". 지금과 비중이 같은 기록(방금 누른 기록)은 건너뛰고
 * 그 앞의 다른 상태와 비교한다. 매매와 시장 움직임이 합쳐진 결과이고, 앞으로 할 일은 늘 지금 상태로만 계산한다.
 */
export function compareWithHistory(view: IncomeGuideView, history: GuideHistoryEntry[]): GuideComparison | null {
  if (view.total <= 0) return null;
  const nowEntry = toHistoryEntry(view);
  const base = [...history].reverse().find((h) => h.groups.length > 0 && !sameMix(h.groups, nowEntry.groups));
  if (!base) return null;
  const b = toHealthPoint(base);
  const n = toHealthPoint(nowEntry);
  const delta = n.distancePp - b.distancePp;
  const verdict = Math.abs(delta) < 2 ? "same" : delta < 0 ? "closer" : "farther";
  const head = `${base.date} 기록 때 목표와의 거리 ${b.distancePp.toFixed(0)}%p → 지금 ${n.distancePp.toFixed(0)}%p`;
  const tail =
    verdict === "closer"
      ? "목표 비중에 가까워졌습니다."
      : verdict === "farther"
        ? "목표에서 더 멀어졌습니다. 시장이 움직였거나 목표와 반대로 사고판 경우입니다."
        : "거의 그대로입니다.";
  return {
    base: b,
    now: n,
    groups: nowEntry.groups.map((g) => ({
      group: g.group,
      beforePct: base.groups.find((x) => x.group === g.group)?.actualPct ?? 0,
      nowPct: g.actualPct,
      targetPct: g.targetPct,
    })),
    verdict,
    text: `${head}. ${tail}`,
  };
}

/**
 * 계좌 건강 흐름 — 처음 기록, 한 달쯤 전 기록, 지금. "내 선택 돌아보기"에서 월 1회 확인용으로 쓴다.
 * 한 달 전 = 오늘보다 28일 이상 앞선 마지막 기록(처음 기록과 같으면 생략).
 */
export function healthTrend(view: IncomeGuideView, history: GuideHistoryEntry[]): { first: HealthPoint | null; monthAgo: HealthPoint | null; now: HealthPoint } | null {
  if (view.total <= 0) return null;
  const now = toHealthPoint(toHistoryEntry(view));
  const valid = history.filter((h) => h.groups.length > 0);
  const cutoff = new Date(`${view.today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 28);
  const cut = cutoff.toISOString().slice(0, 10);
  const firstEntry = valid[0] ?? null;
  const monthEntry = [...valid].reverse().find((h) => h.date <= cut) ?? null;
  return {
    first: firstEntry ? toHealthPoint(firstEntry) : null,
    monthAgo: monthEntry && monthEntry !== firstEntry ? toHealthPoint(monthEntry) : null,
    now,
  };
}

type PlanKey = "kr" | "global" | "income" | "satellite" | "cash";
const PLAN_GROUP: Record<PlanKey, BucketGroup> = { kr: "growth", global: "growth", income: "income", satellite: "satellite", cash: "cash" };
const PLAN_BUCKET: Partial<Record<PlanKey, AssetBucket>> = { kr: "kr_index", global: "global_index", cash: "bond_cash" };
const planKeyOf = (bucket: AssetBucket): PlanKey =>
  bucket === "kr_index" ? "kr" : bucket === "global_index" ? "global" : (BUCKET_GROUP[bucket] as PlanKey);
/** 더 사 넣지 않는 종목 — 커버드콜(장기 연 4~11%p 뒤처짐)과 개별 리츠, 레버리지·개별주·테마 */
const isBuyable = (r: { bucket: AssetBucket; code: string; name: string }) =>
  r.bucket !== "covered_call" && BUCKET_GROUP[r.bucket] !== "satellite" && !(r.bucket === "reit_infra" && /리츠/.test(r.name) && !isExchangeTradedProduct(r.code, r.name));

type PlanRow = GuideHolding & { value: number; bucket: AssetBucket; group: BucketGroup };

/**
 * "인컴" 바구니를 줄일 때 먼저 팔 순서 — 낮을수록 먼저 판다. 2026-10-01 다중 시작점 검증(고배당 3종 vs
 * 커버드콜 2종 실데이터)에서 재투자 기준 고배당은 중앙값이 지수보다 높았고(10년 1.86~2.55배 vs 1.67배,
 * 다만 승률은 41~68%로 꾸준하진 않음) 커버드콜은 5년 승률 0~18%로 졌다. 분배금을 가격에 또 더한 이중 계산
 * 보정 후 수치다(validate_income_multistart.py, 2026-10-02). 예전엔 바구니 안에서 그냥 "금액 큰 것부터" 팔아서, 가장 좋은
 * 보유(고배당)가 금액이 크다는 이유만으로 가장 먼저 팔리고 나쁜 보유(커버드콜)가 남는 역전이 있었다.
 */
const SELL_PRIORITY: Partial<Record<AssetBucket, number>> = { covered_call: 0, reit_infra: 1, dividend: 2 };

/** 바구니별 금액 변화(+ 매수 / − 매도)를 종목별 주수로 바꾼다. 매도는 (인컴 안에서는 커버드콜부터) 큰 종목 순, 매수는 이미 가진 종목에 비중대로 */
function toOrders(rows: PlanRow[], deltas: Record<PlanKey, number>): { orders: GuideOrder[]; unfilled: UnfilledBuy[] } {
  const orders: GuideOrder[] = [];
  const unfilled: UnfilledBuy[] = [];
  for (const key of Object.keys(deltas) as PlanKey[]) {
    const delta = deltas[key];
    if (Math.abs(delta) < 10_000) continue;
    const members = rows.filter((r) => planKeyOf(r.bucket) === key);
    if (delta < 0) {
      let remaining = -delta;
      // 같은 우선순위 안에서는 평단보다 올라 있는(이익·본전) 종목부터 판다 — "인컴은 계속 들어오니 굳이
      // 손실 보며 팔고 싶지 않다"(2026-10-01 사용자). 바꿀 바구니·상품이 같으면 전체 전략에는 큰 차이가
      // 없어서, 심리적 저항이 적은 쪽을 먼저 쓰는 것으로 둔다 — 다만 그 바구니/대상 자체를 줄이기로
      // 한 결정(커버드콜→고배당 등)은 그대로 유지된다(손실만 영구히 피하는 게 아니라 순서 문제).
      const isLoss = (r: PlanRow) => (r.avgPrice && r.avgPrice > 0 ? r.price < r.avgPrice : false);
      const sellOrder = [...members].sort((a, b) => {
        const pa = SELL_PRIORITY[a.bucket] ?? 99;
        const pb = SELL_PRIORITY[b.bucket] ?? 99;
        if (pa !== pb) return pa - pb;
        const la = isLoss(a) ? 1 : 0;
        const lb = isLoss(b) ? 1 : 0;
        return la !== lb ? la - lb : b.value - a.value;
      });
      for (const r of sellOrder) {
        if (remaining <= 0) break;
        const shares = Math.min(r.quantity, Math.ceil(remaining / r.price));
        if (shares <= 0) continue;
        const amount = Math.round(shares * r.price);
        orders.push({
          side: "sell",
          code: r.code,
          name: r.name,
          accountLabel: r.accountLabel,
          group: r.group,
          price: r.price,
          shares,
          amount,
          realizedGain: r.avgPrice && r.avgPrice > 0 ? Math.round((r.price - r.avgPrice) * shares) : null,
        });
        remaining -= amount;
      }
    } else {
      const buyable = members.filter(isBuyable);
      const base = buyable.reduce((s, r) => s + r.value, 0);
      let spent = 0;
      for (const r of buyable) {
        const alloc = base > 0 ? (delta * r.value) / base : 0;
        const shares = Math.floor(alloc / r.price);
        if (shares <= 0) continue;
        const amount = Math.round(shares * r.price);
        spent += amount;
        orders.push({ side: "buy", code: r.code, name: r.name, accountLabel: r.accountLabel, group: r.group, price: r.price, shares, amount, realizedGain: null });
      }
      const left = delta - spent;
      // 가진 종목이 없거나(새 상품 필요) 1주 단위로 남은 돈이 큰 경우
      if (buyable.length === 0 || left >= Math.max(10_000, delta * 0.2)) {
        unfilled.push({ group: PLAN_GROUP[key], ...(PLAN_BUCKET[key] ? { bucket: PLAN_BUCKET[key] } : {}), amount: Math.round(left) });
      }
    }
  }
  orders.sort((a, b) => (a.side === b.side ? b.amount - a.amount : a.side === "sell" ? -1 : 1));
  return { orders, unfilled };
}

export function buildIncomeGuideView(input: {
  holdings: GuideHolding[];
  settings: IncomeGuideSettings;
  today: string;
  /** 이번에 새로 넣을 돈 — 모자란 바구니부터 채우는 안을 만든다 */
  contribution?: number;
}): IncomeGuideView {
  const { settings, today } = input;
  const rows = input.holdings
    .filter((h) => h.quantity > 0 && h.price > 0)
    .map((h) => {
      const bucket = classifyHolding(h.code, h.name);
      return { ...h, value: Math.round(h.quantity * h.price), bucket, group: BUCKET_GROUP[bucket] };
    });
  const total = rows.reduce((s, r) => s + r.value, 0);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  const sumBy = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.value);
    return m;
  };
  const byBucket = sumBy((r) => r.bucket);
  const byGroup = sumBy((r) => r.group);
  const gv = (g: BucketGroup) => byGroup.get(g) ?? 0;

  const stageTargets = resolveStageTargets({ settings, total, today });
  const custom = settings.customTargets;
  const targetSource: IncomeGuideView["targetSource"] = custom && (custom.income != null || custom.cash != null) ? "custom" : "stage";
  const targets = {
    ...stageTargets,
    incomePct: custom?.income ?? stageTargets.incomePct,
    cashPct: custom?.cash ?? stageTargets.cashPct,
  };
  const satelliteActualPct = pct(gv("satellite"));
  // 위성은 상한일 뿐 채워 넣을 목표가 아니다 — 상한 아래면 지금 비중을 그대로 목표로 둔다
  const satelliteTargetPct = Math.min(satelliteActualPct, settings.satelliteCapPct);
  const growthTargetPct = Math.max(0, 100 - targets.incomePct - targets.cashPct - satelliteTargetPct);
  const targetPct: Record<BucketGroup, number> = {
    growth: growthTargetPct,
    income: targets.incomePct,
    satellite: satelliteTargetPct,
    cash: targets.cashPct,
  };
  const groups: GroupRow[] = (["growth", "income", "satellite", "cash"] as BucketGroup[]).map((g) => {
    const actualPct = pct(gv(g));
    return {
      group: g,
      label: GROUP_LABEL[g],
      value: gv(g),
      actualPct,
      targetPct: targetPct[g],
      diffPct: actualPct - targetPct[g],
      diffAmount: Math.round(((targetPct[g] - actualPct) / 100) * total),
    };
  });

  const krValue = byBucket.get("kr_index") ?? 0;
  const globalValue = byBucket.get("global_index") ?? 0;
  const growthValue = krValue + globalValue;
  const globalPct = growthValue > 0 ? (globalValue / growthValue) * 100 : 0;

  // 옮길 금액: 넘친 바구니에서 모자란 바구니로 (큰 것부터 짝짓기)
  const over = groups.filter((g) => g.diffAmount < 0).map((g) => ({ g: g.group, amt: -g.diffAmount })).sort((a, b) => b.amt - a.amt);
  const under = groups.filter((g) => g.diffAmount > 0).map((g) => ({ g: g.group, amt: g.diffAmount })).sort((a, b) => b.amt - a.amt);
  const moves: IncomeGuideView["rebalance"]["moves"] = [];
  for (const o of over) {
    for (const u of under) {
      if (o.amt <= 0) break;
      if (u.amt <= 0) continue;
      const amount = Math.min(o.amt, u.amt);
      if (amount >= 10_000) moves.push({ from: o.g, to: u.g, amount: Math.round(amount) });
      o.amt -= amount;
      u.amt -= amount;
    }
  }
  // 국내↔해외는 리밸런싱 뒤의 성장 금액을 기준으로 나눈다 (성장 바구니가 줄거나 늘어도 같은 비율로)
  const growthAfter = (growthTargetPct / 100) * total;
  const globalGap = (settings.overseasPct / 100) * growthAfter - globalValue;
  const growthShift =
    growthValue > 0 && Math.abs(globalGap) >= 10_000 && Math.abs(globalPct - settings.overseasPct) >= 1
      ? { to: globalGap > 0 ? ("global_index" as const) : ("kr_index" as const), amount: Math.round(Math.abs(globalGap)) }
      : null;
  const outOfBand = groups.filter((g) => Math.abs(g.diffPct) > REBALANCE_BAND_PP);
  const splitOff = growthValue > 0 && Math.abs(globalPct - settings.overseasPct) > REBALANCE_BAND_PP * 2;
  const needed = total > 0 && (outOfBand.length > 0 || splitOff);
  const reason = total === 0
    ? "입력된 계좌 보유가 없습니다."
    : needed
      ? [
          ...outOfBand.map((g) => `${g.label} ${g.actualPct.toFixed(0)}% (목표 ${g.targetPct.toFixed(0)}%)`),
          ...(splitOff ? [`성장 바구니 해외 비중 ${globalPct.toFixed(0)}% (목표 ${settings.overseasPct}%)`] : []),
        ].join(" · ") + ` — ±${REBALANCE_BAND_PP}%p를 넘어 지금 옮기는 것이 좋습니다.`
      : `모든 바구니가 목표 ±${REBALANCE_BAND_PP}%p 안입니다. 1년에 한 번 정기 점검 때 아래 금액만큼 맞추면 됩니다.`;
  const trims = over
    .map((o) => ({
      group: o.g,
      holdings: rows
        .filter((r) => r.group === o.g)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
        .map((r) => ({ code: r.code, name: r.name, accountLabel: r.accountLabel, value: r.value })),
    }))
    .filter((t) => t.holdings.length > 0);

  // 종목별 주문안: 리밸런싱 뒤 목표 금액과 지금 금액의 차이 (성장은 국내·해외로 나눠서)
  const targetValues = (base: number, satelliteValue: number): Record<PlanKey, number> => {
    const satT = Math.min(satelliteValue, (settings.satelliteCapPct / 100) * base);
    const incomeT = (targets.incomePct / 100) * base;
    const cashT = (targets.cashPct / 100) * base;
    const growthT = Math.max(0, base - incomeT - cashT - satT);
    return {
      kr: growthT * (1 - settings.overseasPct / 100),
      global: growthT * (settings.overseasPct / 100),
      income: incomeT,
      satellite: satT,
      cash: cashT,
    };
  };
  const current: Record<PlanKey, number> = { kr: krValue, global: globalValue, income: gv("income"), satellite: gv("satellite"), cash: gv("cash") };
  const tv = targetValues(total, current.satellite);
  const rebalanceDeltas = Object.fromEntries((Object.keys(current) as PlanKey[]).map((k) => [k, tv[k] - current[k]])) as Record<PlanKey, number>;
  const rebalanceOrders = total > 0 ? toOrders(rows, rebalanceDeltas) : { orders: [], unfilled: [] };
  const realizedGainTotal = rebalanceOrders.orders.reduce((s, o) => s + (o.side === "sell" ? o.realizedGain ?? 0 : 0), 0);

  // 새로 넣을 돈: 모자란 곳부터 채우고(팔지 않음), 다 채우고 남으면 성장에 목표 비율로
  const contributionAmount = Math.max(0, Math.round(Number(input.contribution ?? 0)));
  let contribution: IncomeGuideView["contribution"] = null;
  if (contributionAmount >= 10_000) {
    const newTotal = total + contributionAmount;
    const tvNew = targetValues(newTotal, current.satellite);
    const gaps = Object.fromEntries(
      (Object.keys(current) as PlanKey[]).map((k) => [k, k === "satellite" ? 0 : Math.max(0, tvNew[k] - current[k])])
    ) as Record<PlanKey, number>;
    const gapSum = Object.values(gaps).reduce((s, v) => s + v, 0);
    const alloc = Object.fromEntries((Object.keys(gaps) as PlanKey[]).map((k) => [k, 0])) as Record<PlanKey, number>;
    if (gapSum >= contributionAmount) {
      for (const k of Object.keys(gaps) as PlanKey[]) alloc[k] = (contributionAmount * gaps[k]) / gapSum;
    } else {
      for (const k of Object.keys(gaps) as PlanKey[]) alloc[k] = gaps[k];
      const rest = contributionAmount - gapSum;
      alloc.kr += rest * (1 - settings.overseasPct / 100);
      alloc.global += rest * (settings.overseasPct / 100);
    }
    const c = toOrders(rows, alloc);
    const byG = new Map<BucketGroup, number>();
    for (const k of Object.keys(alloc) as PlanKey[]) byG.set(PLAN_GROUP[k], (byG.get(PLAN_GROUP[k]) ?? 0) + alloc[k]);
    const after = (g: BucketGroup) => ((gv(g) + (byG.get(g) ?? 0)) / newTotal) * 100;
    const tgtNew: Record<BucketGroup, number> = {
      growth: ((tvNew.kr + tvNew.global) / newTotal) * 100,
      income: (tvNew.income / newTotal) * 100,
      satellite: (tvNew.satellite / newTotal) * 100,
      cash: (tvNew.cash / newTotal) * 100,
    };
    contribution = {
      amount: contributionAmount,
      allocations: [...byG.entries()].filter(([, v]) => v >= 10_000).map(([group, v]) => ({ group, amount: Math.round(v) })),
      orders: c.orders,
      unfilled: c.unfilled,
      // 리밸런싱 판단과 같은 기준: 바구니 ±10%p, 성장 안 국내·해외 ±20%p
      stillOutOfBand:
        (["growth", "income", "satellite", "cash"] as BucketGroup[]).some((g) => Math.abs(after(g) - tgtNew[g]) > REBALANCE_BAND_PP) ||
        (() => {
          const g = krValue + globalValue + alloc.kr + alloc.global;
          return g > 0 && Math.abs(((globalValue + alloc.global) / g) * 100 - settings.overseasPct) > REBALANCE_BAND_PP * 2;
        })(),
    };
  }

  // 경고
  const warnings: GuideWarning[] = [];
  const annual = settings.monthlyNeed * 12;
  const ratePct = total > 0 ? (annual / total) * 100 : Infinity;
  const evidence = Number.isFinite(ratePct)
    ? WITHDRAWAL_EVIDENCE.find((e) => ratePct <= e.ratePct) ?? WITHDRAWAL_EVIDENCE[WITHDRAWAL_EVIDENCE.length - 1]
    : null;
  if (total > 0 && settings.monthlyNeed > 0 && targets.stage !== "accumulate") {
    const level: GuideWarning["level"] = ratePct <= 4 ? "info" : ratePct <= 6 ? "warn" : "alert";
    warnings.push({
      level,
      title: `필요 인출률 ${ratePct.toFixed(1)}%`,
      text: evidence
        ? `지금 자산에서 월 ${Math.round(settings.monthlyNeed / 10_000)}만원을 꺼내면 연 ${ratePct.toFixed(1)}%입니다. 과거 국내·미국 반반에서 연 ${evidence.ratePct}%${ratePct > evidence.ratePct ? "만 꺼내도" : "를 15년 꺼내 쓴 경우"}${ratePct > evidence.ratePct ? " 15년 뒤" : ""} 물가를 뺀 원금이 남은 비율은 ${evidence.mixKeepPct}%(코스피만은 ${evidence.krOnlyKeepPct}%)였습니다.${ratePct > 6 ? " 분배율이 높은 상품으로 맞추기보다 시작 시점을 늦추거나 생활비를 나눠 받는 쪽이 원금을 지킵니다." : ""}`
        : "",
    });
  }
  if (targets.stage === "income" && total > 0 && (annual / (DISTRIBUTION_YIELD_PCT / 100) / total) * 100 > MAX_INCOME_PCT) {
    warnings.push({
      level: "alert",
      title: "분배금만으로는 생활비가 모자랍니다",
      text: `분배율 ${DISTRIBUTION_YIELD_PCT}% 기준으로 필요한 분배형 원금이 자산의 ${MAX_INCOME_PCT}%를 넘습니다. 남은 성장형까지 분배형으로 옮기면 위기 때 완충이 사라집니다.`,
    });
  }
  for (const r of rows) {
    const p = pct(r.value);
    if (r.bucket === "stock" && p > 20) {
      warnings.push({
        level: "warn",
        title: `${r.name} 한 종목이 ${p.toFixed(0)}%`,
        text: "2014년 대표 고배당·금융주 31종목 중 하나에만 집중했다면 KODEX 200을 넘은 경우는 6개였고, 대부분 −45~−82% 낙폭을 겪었습니다. 성공 사례는 그중 잘된 몇 개입니다.",
      });
    }
    if (r.bucket === "reit_infra" && !isExchangeTradedProduct(r.code, r.name) && p > 10 && /리츠/.test(r.name)) {
      warnings.push({
        level: "warn",
        title: `${r.name} 비중 ${p.toFixed(0)}%`,
        text: "국내 상장 리츠는 2022년 금리 상승기에 −34~−54% 빠졌습니다. 리츠는 한 종목보다 여러 리츠를 담은 상품으로, 소량만 두세요.",
      });
    }
  }
  const ccPct = pct(byBucket.get("covered_call") ?? 0);
  if (ccPct > 10 || (gv("income") > 0 && (byBucket.get("covered_call") ?? 0) / gv("income") > 1 / 3)) {
    warnings.push({
      level: "warn",
      title: `커버드콜 ${ccPct.toFixed(0)}%`,
      text: "커버드콜은 강세 해에 지수 상승의 42~66%만 따라갔고 장기로 연 4~11%p 뒤처졌습니다. 높은 분배율은 원금 일부를 나눠 받는 것일 수 있어, 인컴 바구니의 3분의 1 이하로 두세요.",
    });
  }
  if ((byBucket.get("leveraged") ?? 0) > 0) {
    warnings.push({
      level: "warn",
      title: "레버리지·인버스 보유",
      text: "지수 1.5배 모드는 세후 연 7.9%로 1배(8.2%)보다 낮고 낙폭은 −47%였습니다. 장기 보유용이 아닙니다.",
    });
  }
  if (satelliteActualPct > settings.satelliteCapPct + 0.5) {
    warnings.push({
      level: "warn",
      title: `위성 ${satelliteActualPct.toFixed(0)}% (상한 ${settings.satelliteCapPct}%)`,
      text: "개별주·테마 비중이 상한을 넘었습니다. 규칙 기반 종목 봇도 3년 최악 0.74배로 지수(0.81배)보다 나빴습니다. 손익보다 비중 기준으로 줄이세요.",
    });
  }
  if (growthValue > 0 && (globalPct < 20 || globalPct > 80)) {
    warnings.push({
      level: "info",
      title: globalPct < 20 ? "성장형이 국내에 몰려 있습니다" : "성장형이 해외에 몰려 있습니다",
      text: "2003~2026 코스피와 S&P500(원화)은 연수익이 같았지만 주도권이 몇 년마다 바뀌었습니다. 한국 위기 때 원화도 약해져 달러 자산이 낙폭을 줄였습니다(2008년 코스피 −54%, S&P500 원화 −30%).",
    });
  }
  // 계좌 배치: 일반 계좌의 해외·분배형 ETF
  const accountsMap = new Map<string, { key: string; label: string; taxAdvantaged: boolean; total: number; byGroup: Record<BucketGroup, number> }>();
  for (const r of rows) {
    const a = accountsMap.get(r.accountKey) ?? {
      key: r.accountKey,
      label: r.accountLabel,
      taxAdvantaged: isTaxAdvantagedAccount(r.accountLabel),
      total: 0,
      byGroup: { growth: 0, income: 0, satellite: 0, cash: 0 },
    };
    a.total += r.value;
    a.byGroup[r.group] += r.value;
    accountsMap.set(r.accountKey, a);
  }
  const accounts = [...accountsMap.values()].sort((a, b) => b.total - a.total);
  const taxableTaxedEtf = rows.filter(
    (r) =>
      !isTaxAdvantagedAccount(r.accountLabel) &&
      isExchangeTradedProduct(r.code, r.name) &&
      (r.bucket === "global_index" || r.bucket === "dividend" || r.bucket === "covered_call" || r.bucket === "bond_cash")
  );
  if (taxableTaxedEtf.length > 0) {
    const v = taxableTaxedEtf.reduce((s, r) => s + r.value, 0);
    warnings.push({
      level: "info",
      title: `일반 계좌의 과세 ETF ${Math.round(v / 10_000).toLocaleString("ko-KR")}만원`,
      text: "해외 지수·분배형·채권 ETF는 일반 계좌에서 매매차익과 분배금에 15.4%가 붙습니다. 국내 주식형 ETF(코스피200 등)는 매매차익이 비과세입니다. ISA·연금 계좌가 있다면 과세 ETF를 그쪽에, 국내 지수를 일반 계좌에 두는 편이 유리합니다.",
    });
  }
  // 금융소득 상한: 일반 계좌 분배금만 센다 (ISA·연금 안은 제외)
  let taxableAnnual = 0;
  let shelteredAnnual = 0;
  let taxableFromCoveredCall = 0;
  for (const r of rows) {
    const d = (r.value * BUCKET_YIELD_PCT[r.bucket]) / 100;
    if (isTaxAdvantagedAccount(r.accountLabel)) shelteredAnnual += d;
    else {
      taxableAnnual += d;
      if (r.bucket === "covered_call") taxableFromCoveredCall += d;
    }
  }
  const cap = settings.financialIncomeCap;
  const headroom = cap - taxableAnnual;
  const distributions: IncomeGuideView["distributions"] = {
    taxableAnnual: Math.round(taxableAnnual),
    shelteredAnnual: Math.round(shelteredAnnual),
    cap,
    headroom: Math.round(headroom),
    headroomAsDividendCapital: Math.max(0, Math.round(headroom / (BUCKET_YIELD_PCT.dividend / 100))),
    taxableFromCoveredCall: Math.round(taxableFromCoveredCall),
  };
  if (cap > 0 && taxableAnnual > cap) {
    warnings.push({
      level: taxableAnnual > 20_000_000 ? "alert" : "warn",
      title: `일반 계좌 예상 분배금 연 ${Math.round(taxableAnnual / 10_000).toLocaleString("ko-KR")}만원 — 상한 ${Math.round(cap / 10_000).toLocaleString("ko-KR")}만원 초과`,
      text:
        "금융소득이 연 1천만원을 넘으면 지역가입자 건강보험료에 전액 반영되고, 2천만원을 넘으면 종합과세·피부양자 탈락 기준이 됩니다(기준은 해마다 확인). " +
        "분배율이 높은 상품부터 ISA·연금 계좌로 옮기거나, 일반 계좌는 분배가 적은 지수형(KODEX 200 TR 등)으로 바꾸면 같은 자산으로 과세 소득을 줄일 수 있습니다.",
    });
  }
  if (taxableFromCoveredCall > 0) {
    warnings.push({
      level: "info",
      title: `일반 계좌 커버드콜 분배금 연 ${Math.round(taxableFromCoveredCall / 10_000).toLocaleString("ko-KR")}만원`,
      text: `금융소득 상한이 있으면 과세 분배금 1원이 아깝습니다. 커버드콜은 분배율(약 ${BUCKET_YIELD_PCT.covered_call}%)이 고배당(${BUCKET_YIELD_PCT.dividend}%)의 두 배 가까운데 총수익은 더 낮아, 일반 계좌에서는 상한을 가장 빨리 채웁니다. 쓴다면 ISA·연금 계좌 안에 두세요.`,
    });
  }

  const st = STAGE_TEXT[targets.stage];
  return {
    today,
    settings,
    total,
    holdingCount: rows.length,
    stage: { key: targets.stage, title: st.title, text: st.text, yearsToIncome: targets.yearsToIncome },
    need: {
      annual,
      ratePct: Number.isFinite(ratePct) ? ratePct : 0,
      capitalByDistribution: Math.round(annual / (DISTRIBUTION_YIELD_PCT / 100)),
      capitalByWithdrawal4: Math.round(annual / 0.04),
      evidence,
    },
    groups,
    growthSplit: { krValue, globalValue, globalPct, targetGlobalPct: settings.overseasPct },
    distribution: estimateDistribution(byBucket),
    buckets: [...byBucket.entries()]
      .map(([bucket, value]) => ({ bucket, label: BUCKET_LABEL[bucket], value, pct: pct(value) }))
      .sort((a, b) => b.value - a.value),
    rebalance: {
      needed,
      reason,
      moves,
      growthShift,
      trims,
      orders: rebalanceOrders.orders,
      unfilled: rebalanceOrders.unfilled,
      realizedGainTotal,
    },
    contribution,
    targetSource,
    age: settings.ageBand && AGE_BANDS[settings.ageBand] ? buildAgeGuide(settings.ageBand, targets.stage, targets.cashPct, custom?.cash != null) : null,
    distributions,
    warnings,
    accounts,
    holdings: rows.map((r) => ({ ...r, pct: pct(r.value) })).sort((a, b) => b.value - a.value),
  };
}
