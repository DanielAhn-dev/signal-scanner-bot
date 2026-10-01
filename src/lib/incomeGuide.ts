/**
 * 실계좌 리밸런싱 가이드 — 직접 입력한 계좌 보유(virtual_positions의 증권사·계좌명 행)를 바구니로 나누고,
 * "모으기 → 전환 → 인컴" 단계별 목표 비중과 비교해 무엇을 얼마나 옮길지 안내한다. DB·API 없이 계산만 한다.
 * 봇 매매와는 무관하다 — 안내만 하고 주문하지 않는다.
 *
 * 근거 (2026-10-01 검증, 블로그 3편 "코스피냐 미국이냐, 성장이냐 분배금이냐"):
 *   - 코스피·S&P500(원화) 2003~2026 연수익은 같았고(12.0%), 50:50 매년 리밸런싱이 5년 최악 1.11배로 둘 다(0.83·0.94)보다 나았다.
 *   - 리밸런싱은 수익보다 낙폭을 줄였다(−41.7% → −36.4%). 10년 방치하면 50:50이 22:78~62:38로 벌어졌다.
 *   - 분배형(고배당·커버드콜)은 횡보장에서 같은 생활비에 원금을 더 남겼지만 랠리 구간에서 크게 뒤졌다 → 지금 쓸 만큼만.
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
};

export const DEFAULT_INCOME_GUIDE_SETTINGS: IncomeGuideSettings = {
  monthlyNeed: 500_000,
  satelliteCapPct: 10,
  overseasPct: 50,
};

export function sanitizeIncomeGuideSettings(input: Partial<IncomeGuideSettings>, current: IncomeGuideSettings): IncomeGuideSettings {
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return v != null && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    monthlyNeed: num(input.monthlyNeed, current.monthlyNeed, 0, 1e9),
    incomeStart:
      input.incomeStart === ""
        ? undefined
        : /^\d{4}-\d{2}$/.test(String(input.incomeStart ?? ""))
          ? String(input.incomeStart)
          : current.incomeStart,
    satelliteCapPct: num(input.satelliteCapPct, current.satelliteCapPct, 0, 50),
    overseasPct: num(input.overseasPct, current.overseasPct, 0, 100),
  };
}

export type GuideHolding = {
  code: string;
  name: string;
  quantity: number;
  price: number;
  accountKey: string;
  accountLabel: string;
};

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
  rebalance: {
    needed: boolean;
    reason: string;
    moves: Array<{ from: BucketGroup; to: BucketGroup; amount: number }>;
    /** 성장 바구니 안 국내↔해외 조정 (목표 성장 금액 기준, 1만원 미만이면 null) */
    growthShift: { to: "global_index" | "kr_index"; amount: number } | null;
    trims: Array<{ group: BucketGroup; holdings: Array<{ code: string; name: string; accountLabel: string; value: number }> }>;
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
export function resolveStageTargets(input: { settings: IncomeGuideSettings; total: number; today: string }): {
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

export function buildIncomeGuideView(input: {
  holdings: GuideHolding[];
  settings: IncomeGuideSettings;
  today: string;
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

  const targets = resolveStageTargets({ settings, total, today });
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
        ? `지금 자산에서 월 ${Math.round(settings.monthlyNeed / 10_000)}만원을 꺼내면 연 ${ratePct.toFixed(1)}%입니다. 과거 국내·미국 반반에서 연 ${evidence.ratePct}%를 15년 꺼내 쓴 경우 물가를 뺀 원금이 남은 비율은 ${evidence.mixKeepPct}%(코스피만은 ${evidence.krOnlyKeepPct}%)였습니다.${ratePct > 6 ? " 분배율이 높은 상품으로 맞추기보다 시작 시점을 늦추거나 생활비를 나눠 받는 쪽이 원금을 지킵니다." : ""}`
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
  const taxableIncomeValue = rows
    .filter((r) => !isTaxAdvantagedAccount(r.accountLabel) && (r.group === "income" || r.bucket === "bond_cash"))
    .reduce((s, r) => s + r.value, 0);
  if (taxableIncomeValue * (DISTRIBUTION_YIELD_PCT / 100) > 20_000_000) {
    warnings.push({
      level: "warn",
      title: "금융소득 종합과세 가능성",
      text: `일반 계좌 분배형 예상 분배금이 연 2천만원을 넘습니다(분배율 ${DISTRIBUTION_YIELD_PCT}% 가정). 넘는 부분은 종합과세됩니다.`,
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
    buckets: [...byBucket.entries()]
      .map(([bucket, value]) => ({ bucket, label: BUCKET_LABEL[bucket], value, pct: pct(value) }))
      .sort((a, b) => b.value - a.value),
    rebalance: { needed, reason, moves, growthShift, trims },
    warnings,
    accounts,
    holdings: rows.map((r) => ({ ...r, pct: pct(r.value) })).sort((a, b) => b.value - a.value),
  };
}
