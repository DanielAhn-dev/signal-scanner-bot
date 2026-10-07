/**
 * 목표 트래커 — "시드를 넣고 스윙으로 월 평균 수익을 내며, 수익은 전부 재투자해 시드를 키운다"는 목표의 진행 상황.
 * 매매 로직은 건드리지 않는다. 웹 홈(/api/ui/goal-tracker)과 금요일 텔레그램 보고가 같은 계산을 쓴다.
 *
 *   - 계획선: 시작 평가액에서 연 planAnnualPct(기본 8%) 복리 + 월 추가 입금
 *   - 필요 시드: 원금을 지키며 매년 꺼내 쓸 수 있는 인출률(기본 4%)로 계산 (예: 월 50만원 × 12 ÷ 4% = 1.5억)
 *     성장 가정(8%)으로 나누면 안 된다 — 코스피 1997~2026에서 연 8%(물가 반영)씩 20년 인출하면 대부분 원금이 줄었다.
 *     50일선 규칙 기준 20년 원금 유지 비율: 4% 87% · 5% 68% · 6% 50% (보유 1배는 4% 97%). 고배당 ETF 배당률도 4~5%대.
 *   - 이번 달 수익률: 날짜별 평가액을 이어 붙이되, 입금·출금이 있던 날은 수익 0으로 본다(isCapitalFlow)
 *   - 정상 범위: 코스피 50일선 규칙의 과거 월별 수익 분포 — 마이너스 달이 "흔한 달"인지 알려 준다
 */

type SupabaseClientAny = any;

const BUCKET = "market-snapshots";
export const GOAL_TRACKER_DIR = "goal-tracker";

export type GoalSettings = {
  /** 목표 추적 시작일 (YYYY-MM-DD) */
  startDate: string;
  /** 시작일 평가액 */
  startEquity: number;
  /** 계획 연 수익률 % (보수적 기본 8) — 1차(시드 모으기) 성장 가정 */
  planAnnualPct: number;
  /** 2차에 원금을 지키며 매년 꺼내 쓸 비율 % (기본 4) — 필요 시드 계산에 쓴다. 없던 파일은 기본값 */
  withdrawalPct?: number;
  /** 목표 월 평균 수익 (원) */
  targetMonthlyProfit: number;
  /** 매달 추가 입금 (원, 없으면 0) */
  monthlyContribution: number;
  /** 필요 시드에 닿고 싶은 시점 (YYYY-MM, 없으면 1·2·3·5년만 보여 준다) */
  targetDate?: string;
};

export type EquityPoint = {
  date: string;
  seed: number;
  total: number;
  /** 그날 기록 시점의 누적 확정 손익(virtual_realized_pnl) — 시드 재계산과 입금을 구분하는 데 쓴다 */
  realized?: number;
};

/**
 * 두 기록 사이에 외부 자금 이동(입금·출금·시드 수동 변경)이 있었는지.
 * 봇의 주간 시드 재계산은 "새 시드 = 이전 시드 + 이전 누적 확정 손익"이라 자금 이동이 아니다 — 그날 수익은 그대로 센다.
 */
export function isCapitalFlow(prev: EquityPoint, cur: EquityPoint): boolean {
  if (prev.seed === cur.seed) return false;
  if (prev.realized != null && cur.realized != null) {
    const tolerance = Math.max(10_000, cur.seed * 0.002);
    if (Math.abs(cur.seed - (prev.seed + prev.realized)) <= tolerance) return false;
  }
  return true;
}

export type GoalTrackerFile = { settings: GoalSettings; history: EquityPoint[] };

export const DEFAULT_PLAN_ANNUAL_PCT = 8;
export const DEFAULT_WITHDRAWAL_PCT = 4;
export const DEFAULT_TARGET_MONTHLY_PROFIT = 1_000_000;

/**
 * 코스피 계속 보유(배당 연 1.7% 포함, 봇 지수 스윕·지수 보유 모드와 같은 방식)의 과거 월별 수익 분포 — 1997~2026-09.
 * (2016년 이후만 보면 플러스 60%, 하위 10% -5.3%, 최악 -22.0%)
 * 2026-09-29까지는 50일선 규칙 분포(하위 10% -4.0%, 최악 -15.5%)였다 — 스윕을 계속 보유로 바꾸며 교체.
 * "이 정도 마이너스는 흔한 달인가"를 가늠하는 기준으로만 쓴다.
 */
export const NORMAL_MONTHLY_RANGE = {
  plusMonthsPct: 56,
  p10: -8.0,
  p25: -2.7,
  median: 0.9,
  p90: 9.8,
  worst: -27.1,
  maxLosingStreak: 6,
  source: "코스피 계속 보유 1997~2026 월별",
};

export function monthlyRate(annualPct: number): number {
  return (1 + annualPct / 100) ** (1 / 12) - 1;
}

/**
 * 복리가 월 입금을 추월하는 시점 — 초반 몇 년은 입금이 불어나는 돈보다 커서 효과가 안 보인다.
 * 지금 평가액의 계획 월 수익이 월 입금의 몇 %인지, 계획대로면 몇 달 뒤 넘는지. 입금이 없으면 null.
 */
export function compoundingCrossover(input: {
  equity: number;
  planAnnualPct: number;
  monthlyContribution: number;
}): { monthlyExpected: number; ratioPct: number; months: number | null } | null {
  const c = input.monthlyContribution;
  if (!(c > 0)) return null;
  const mr = monthlyRate(input.planAnnualPct);
  let v = Math.max(0, input.equity);
  const monthlyExpected = v * mr;
  let months: number | null = null;
  for (let k = 0; k <= 600; k += 1) {
    if (v * mr >= c) {
      months = k;
      break;
    }
    v = v * (1 + mr) + c;
  }
  return { monthlyExpected: Math.round(monthlyExpected), ratioPct: (monthlyExpected / c) * 100, months };
}

/** 원금을 지키며 매달 목표 금액을 꺼내 쓰는 데 필요한 시드 (연 인출률 기준) */
export function requiredSeed(targetMonthlyProfit: number, withdrawalPct: number): number {
  return withdrawalPct > 0 ? (targetMonthlyProfit * 12) / (withdrawalPct / 100) : Infinity;
}

export function monthsBetween(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate.slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${toDate.slice(0, 10)}T00:00:00Z`);
  const whole = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  const dayFrac = (b.getUTCDate() - a.getUTCDate()) / 30;
  return Math.max(0, whole + dayFrac);
}

/** 계획선: n개월 뒤 평가액 */
export function planValueAt(settings: GoalSettings, months: number): number {
  const m = monthlyRate(settings.planAnnualPct);
  const g = (1 + m) ** months;
  const contrib = settings.monthlyContribution > 0 ? (settings.monthlyContribution * (g - 1)) / m : 0;
  return settings.startEquity * g + contrib;
}

/** 지금 평가액에서 목표 금액까지 걸리는 개월 수 (계획 수익률 + 월 입금). 50년 넘으면 null */
export function monthsToReach(input: {
  fromEquity: number;
  target: number;
  planAnnualPct: number;
  monthlyContribution: number;
}): number | null {
  if (input.fromEquity >= input.target) return 0;
  const m = monthlyRate(input.planAnnualPct);
  let v = input.fromEquity;
  for (let n = 1; n <= 600; n += 1) {
    v = v * (1 + m) + Math.max(0, input.monthlyContribution);
    if (v >= input.target) return n;
  }
  return null;
}

/** 두 날짜 사이의 개월 수 (월 단위) — "2026-09-29" → "2028-09"는 24 */
export function monthsUntil(today: string, targetMonth: string): number {
  const [y1, m1] = today.slice(0, 7).split("-").map(Number);
  const [y2, m2] = targetMonth.slice(0, 7).split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

function addMonths(today: string, months: number): string {
  const d = new Date(`${today.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
}

/**
 * n개월 뒤 필요 시드에 닿으려면 매달 넣어야 하는 금액 (계획 수익률로 재투자, 월말 입금).
 * planValueAt과 같은 식을 입금액에 대해 푼 것. 입금 없이도 닿으면 0.
 */
export function requiredMonthlyContribution(input: {
  fromEquity: number;
  target: number;
  planAnnualPct: number;
  months: number;
}): number {
  if (!(input.months > 0) || !Number.isFinite(input.target)) return 0;
  const m = monthlyRate(input.planAnnualPct);
  const g = (1 + m) ** input.months;
  const grown = input.fromEquity * g;
  if (grown >= input.target) return 0;
  const factor = m > 0 ? (g - 1) / m : input.months;
  return (input.target - grown) / factor;
}

/**
 * 나이·은퇴 시점 — 목표를 "언젠가"가 아니라 사용자가 정한 은퇴 나이에 맞춘다.
 * 은퇴 시점과 지금 나이가 정해지면 "그때까지 매달 얼마를 모으면 된다"가 나온다.
 * 그 금액을 어떻게 만드는지(급여 − 생활비, 부업·N잡, 지출 줄이기)는 사용자의 몫이고, 화면은 기준만 보여 준다.
 * 출생은 연월(YYYY-MM)만 받는다. 일(日)은 계산에 영향이 없고, 개인정보는 최소로 둔다(자녀 증여 계좌와 같은 원칙).
 * users.prefs.life_birth_month / life_retire_age 에 저장한다. 표시용이며 매매 규칙은 바꾸지 않는다.
 */
export type LifeProfile = { birthMonth: string; retireAge: number };

export const DEFAULT_RETIRE_AGE = 60;
export const RETIRE_AGE_MIN = 45;
export const RETIRE_AGE_MAX = 75;
/** 통계청 2023 생명표 기대수명 83.5세 — "그때까지 살아 있을까"를 가늠하는 참고선으로만 쓴다 */
export const LIFE_EXPECTANCY = 83.5;
/** 비교해 보여 줄 은퇴 나이 — 사용자가 고른 나이는 따로 더한다 */
export const COMPARE_RETIRE_AGES = [55, 60, 65];

const BIRTH_MONTH_RE = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

/** prefs에서 나이 정보를 읽는다. 출생 연월이 없거나 형식이 틀리면 null */
export function readLifeProfile(prefs: Record<string, unknown> | null | undefined): LifeProfile | null {
  const birth = String(prefs?.life_birth_month ?? "");
  if (!BIRTH_MONTH_RE.test(birth)) return null;
  const age = Number(prefs?.life_retire_age);
  const retireAge = Number.isFinite(age) && age > 0 ? Math.min(RETIRE_AGE_MAX, Math.max(RETIRE_AGE_MIN, Math.round(age))) : DEFAULT_RETIRE_AGE;
  return { birthMonth: birth, retireAge };
}

/** 입력을 prefs에 넣을 값으로 고른다. 출생 연월 ""는 삭제(null 반환). 형식 오류·미래 날짜는 error */
export function sanitizeLifeInput(
  input: { birthMonth?: unknown; retireAge?: unknown },
  today: string
): { ok: true; value: LifeProfile | null } | { ok: false; error: string } {
  const birth = String(input.birthMonth ?? "").trim();
  if (birth === "") return { ok: true, value: null };
  if (!BIRTH_MONTH_RE.test(birth)) return { ok: false, error: "출생 연월은 YYYY-MM 형식으로 입력하세요" };
  if (birth > today.slice(0, 7)) return { ok: false, error: "출생 연월이 오늘보다 뒤입니다" };
  const age = input.retireAge == null || input.retireAge === "" ? DEFAULT_RETIRE_AGE : Number(input.retireAge);
  if (!Number.isFinite(age) || age < RETIRE_AGE_MIN || age > RETIRE_AGE_MAX) {
    return { ok: false, error: `은퇴 나이는 ${RETIRE_AGE_MIN}~${RETIRE_AGE_MAX}세로 입력하세요` };
  }
  return { ok: true, value: { birthMonth: birth, retireAge: Math.round(age) } };
}

/** 만 나이 (월 단위 정밀도 — 생일이 든 달에 한 살 올린다) */
export function ageAt(birthMonth: string, date: string): number {
  const [by, bm] = birthMonth.split("-").map(Number);
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  return y - by - (m < bm ? 1 : 0);
}

/** 그 나이가 되는 달 (출생 연월 + 나이) */
export function monthAtAge(birthMonth: string, age: number): string {
  const [by, bm] = birthMonth.split("-").map(Number);
  return `${by + age}-${String(bm).padStart(2, "0")}`;
}

export type LifeStage = "20s" | "30s" | "40s" | "50s" | "60plus";

export function lifeStageOf(age: number): LifeStage {
  if (age < 30) return "20s";
  if (age < 40) return "30s";
  if (age < 50) return "40s";
  if (age < 60) return "50s";
  return "60plus";
}

/**
 * 나이대별로 무엇이 결과를 정하는지 — 남은 시간이 다르니 같은 목표라도 필요한 월 적립과 쓸 수 있는 손잡이가 다르다.
 * 근거: 기간이 짧을수록 필요 월 적립이 빠르게 커지고(requiredMonthlyContribution),
 * 계획 수익률을 올려 메우는 것은 위험만 키운다(지수 장기 평균 연 8% 안팎).
 */
export const LIFE_STAGE_GUIDE: Record<LifeStage, { label: string; text: string }> = {
  "20s": {
    label: "20대",
    text: "시간이 가장 큰 자산이라 필요한 월 적립이 가장 작은 시기입니다. 금액보다 매달 빠짐없이 모으는 습관이 결과를 정합니다.",
  },
  "30s": {
    label: "30대",
    text: "아직 복리가 일할 시간이 충분합니다. 소득이 오를 때마다 월 적립을 같이 올리는 것이 가장 효과적입니다. 지출이 커지는 시기라 적립을 멈추지 않는 것이 핵심입니다.",
  },
  "40s": {
    label: "40대",
    text: "남은 기간이 20년 안팎이라 수익률보다 매달 모으는 금액이 결과를 정합니다. 모자라면 수익률을 올리려 하지 말고, 남는 돈 늘리기·은퇴 몇 년 늦추기·목표 낮추기 중에서 고르세요.",
  },
  "50s": {
    label: "50대",
    text: "남은 기간이 짧아 큰 손실 한 번이 회복되지 않을 수 있습니다. 부족분을 공격적인 투자로 메우지 마세요. 국민연금 예상액을 더해 생활비를 다시 보고, 은퇴 직전 몇 년치 생활비는 현금성으로 옮겨 두세요.",
  },
  "60plus": {
    label: "60대 이상",
    text: "모으기보다 꺼내 쓰기 단계입니다. 지금 자산에서 원금을 지키며 꺼낼 수 있는 금액에 생활비를 맞추고, 2~3년치 생활비는 현금성으로 두어 하락장에 주식을 팔지 않게 하세요.",
  },
};

export type RetireAgeOption = {
  retireAge: number;
  retireMonth: string;
  months: number;
  /** 그 나이에 필요 시드에 닿으려면 매달 모을 금액 (이미 충분하면 0) */
  contribution: number;
  /** 지금 계획(수익률·월 적립)대로면 그 나이에 모이는 금액과, 거기서 매달 꺼낼 수 있는 금액 */
  projected: number;
  monthlyWithdrawal: number;
  isChosen: boolean;
};

export type LifePlan = {
  birthMonth: string;
  currentAge: number;
  retireAge: number;
  retireMonth: string;
  /** 은퇴까지 남은 개월 (지났으면 0) */
  monthsToRetire: number;
  /** 예상 도달 시점의 나이 (50년 안에 못 닿으면 null) */
  etaAge: number | null;
  /** 지금 계획대로면 은퇴 때 모이는 금액과 매달 꺼낼 수 있는 금액 */
  projectedAtRetire: number;
  monthlyAtRetire: number;
  /** 고른 은퇴 나이에 맞추려면 매달 모을 금액 — 화면의 기준 숫자 */
  contributionForTarget: number;
  /** 지금 월 적립과의 차이 (양수면 더 모아야 함) */
  contributionGap: number;
  /** on-track: 은퇴 전 도달 / late: 은퇴 뒤 도달 / beyond-life: 기대수명 뒤이거나 50년 이상 / retired: 이미 은퇴 나이 */
  status: "on-track" | "late" | "beyond-life" | "retired";
  /** 은퇴 나이별 비교 (지난 나이는 뺀다) */
  options: RetireAgeOption[];
  stage: LifeStage;
  stageGuide: { label: string; text: string };
  lifeExpectancy: number;
};

export function buildLifePlan(input: {
  life: LifeProfile;
  today: string;
  equity: number;
  requiredSeed: number;
  planAnnualPct: number;
  monthlyContribution: number;
  withdrawalPct: number;
  etaMonth: string | null;
}): LifePlan {
  const { life, today } = input;
  const currentAge = ageAt(life.birthMonth, today);
  const optionFor = (retireAge: number): RetireAgeOption => {
    const retireMonth = monthAtAge(life.birthMonth, retireAge);
    const months = Math.max(0, monthsUntil(today, retireMonth));
    const projected = planValueAt(
      { startDate: today, startEquity: input.equity, planAnnualPct: input.planAnnualPct, targetMonthlyProfit: 0, monthlyContribution: input.monthlyContribution },
      months
    );
    return {
      retireAge,
      retireMonth,
      months,
      contribution: Math.round(
        requiredMonthlyContribution({ fromEquity: input.equity, target: input.requiredSeed, planAnnualPct: input.planAnnualPct, months })
      ),
      projected: Math.round(projected),
      monthlyWithdrawal: Math.round((projected * input.withdrawalPct) / 100 / 12),
      isChosen: retireAge === life.retireAge,
    };
  };
  const chosen = optionFor(life.retireAge);
  const ages = [...new Set([...COMPARE_RETIRE_AGES, life.retireAge])].sort((a, b) => a - b);
  const options = ages.map(optionFor).filter((o) => o.months > 0 || o.isChosen);
  const etaAge = input.etaMonth ? ageAt(life.birthMonth, input.etaMonth) : null;
  const etaYears = input.etaMonth ? monthsUntil(`${life.birthMonth}-01`, input.etaMonth) / 12 : null;
  const status: LifePlan["status"] =
    chosen.months === 0
      ? "retired"
      : etaYears == null || etaYears >= LIFE_EXPECTANCY
        ? "beyond-life"
        : (input.etaMonth as string) <= chosen.retireMonth
          ? "on-track"
          : "late";
  const stage = lifeStageOf(currentAge);
  return {
    birthMonth: life.birthMonth,
    currentAge,
    retireAge: life.retireAge,
    retireMonth: chosen.retireMonth,
    monthsToRetire: chosen.months,
    etaAge,
    projectedAtRetire: chosen.projected,
    monthlyAtRetire: chosen.monthlyWithdrawal,
    contributionForTarget: chosen.contribution,
    contributionGap: Math.round(chosen.contribution - Math.max(0, input.monthlyContribution)),
    status,
    options,
    stage,
    stageGuide: LIFE_STAGE_GUIDE[stage],
    lifeExpectancy: LIFE_EXPECTANCY,
  };
}

/** 기간 수익률: 날짜별 평가액을 이어 붙이고, 입금·출금이 있던 날은 수익 0으로 본다 */
export function chainedReturn(points: EquityPoint[]): number | null {
  const pts = [...points].filter((p) => p.total > 0 && p.seed > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  let g = 1;
  for (let i = 1; i < pts.length; i += 1) {
    if (!isCapitalFlow(pts[i - 1], pts[i])) g *= pts[i].total / pts[i - 1].total;
  }
  return g - 1;
}

/** 이번 달 수익률 = 지난달 마지막 기록부터 오늘까지 */
export function monthToDateReturn(history: EquityPoint[], today: string): number | null {
  const month = today.slice(0, 7);
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const before = sorted.filter((p) => p.date.slice(0, 7) < month).pop();
  const inMonth = sorted.filter((p) => p.date.slice(0, 7) === month);
  return chainedReturn(before ? [before, ...inMonth] : inMonth);
}

export type MonthAssessment = { level: "good" | "normal" | "weak" | "rare"; text: string };

export function assessMonth(returnPct: number | null): MonthAssessment | null {
  if (returnPct == null || !Number.isFinite(returnPct)) return null;
  const r = NORMAL_MONTHLY_RANGE;
  if (returnPct >= 0) return { level: "good", text: `플러스 달 — 과거 ${r.plusMonthsPct}%의 달이 플러스였습니다.` };
  if (returnPct >= r.p25) return { level: "normal", text: "흔한 마이너스 달 — 과거 4달 중 1달은 이보다 나빴습니다." };
  if (returnPct >= r.p10) return { level: "weak", text: "약한 달 — 과거 10달 중 1~2달 수준입니다. 규칙을 바꿀 이유는 아닙니다." };
  return {
    level: "rare",
    text: `드문 약세 달 — 과거 10달 중 1달 미만 수준입니다(최악 ${r.worst}%). 코스피 50일선 아래(신규 매수 중단)인지 확인하세요.`,
  };
}

/** 계좌 평가액 = 현금 + 보유 종목(유휴현금 스윕 포함) 종가 평가 */
export async function fetchAccountEquity(
  supabase: SupabaseClientAny,
  chatId: number,
  date: string
): Promise<(EquityPoint & { cash: number; holdings: number; monthlyDeposit: number | null; principal: number | null; life: LifeProfile | null }) | null> {
  const { data: user } = await supabase.from("users").select("prefs").eq("tg_id", chatId).maybeSingle();
  const prefs = ((user as any)?.prefs ?? {}) as Record<string, unknown>;
  const seed = Number(prefs.virtual_seed_capital ?? prefs.capital_krw);
  const cash = Number(prefs.virtual_cash);
  const realized = Number(prefs.virtual_realized_pnl ?? 0);
  if (!(seed > 0) || !Number.isFinite(cash)) return null;
  const { data: positions } = await supabase
    .from("virtual_positions")
    .select("code, quantity, buy_price, status, stock:stocks(close)")
    .eq("chat_id", chatId)
    .is("broker_name", null)
    .is("account_name", null);
  let holdings = 0;
  for (const row of (positions ?? []) as any[]) {
    if (String(row.status ?? "holding") === "closed") continue;
    const stock = Array.isArray(row.stock) ? row.stock[0] : row.stock;
    const price = Number(stock?.close) > 0 ? Number(stock.close) : Number(row.buy_price ?? 0);
    holdings += Math.max(0, Math.floor(Number(row.quantity ?? 0))) * Math.max(0, price);
  }
  return {
    date,
    seed,
    total: Math.round(cash + holdings),
    realized: Number.isFinite(realized) ? Math.round(realized) : undefined,
    cash: Math.round(cash),
    holdings: Math.round(holdings),
    // 계정에 월 자동 입금을 설정했으면 그 값 (설정한 적 없으면 null — 거치식 계정은 목표 트래커 값 그대로)
    monthlyDeposit: prefs.virtual_monthly_deposit != null && Number.isFinite(Number(prefs.virtual_monthly_deposit))
      ? Math.max(0, Math.round(Number(prefs.virtual_monthly_deposit)))
      : null,
    // 시작 시드 + 월 입금 누적 (monthlyDeposit.ts). 기록이 없는 거치식 계정은 null → 목표 트래커 시작 금액을 쓴다
    principal: Number(prefs.virtual_total_deposited) > 0 ? Math.round(Number(prefs.virtual_total_deposited)) : null,
    // 프로필의 출생 연월·은퇴 나이 (없으면 null — 나이 없이 예전처럼 보여 준다)
    life: readLifeProfile(prefs),
  };
}

/** 이번 달 확정 손익: 스윙(개별 종목) / 유휴현금 스윕 */
export async function fetchMonthRealized(
  supabase: SupabaseClientAny,
  chatId: number,
  today: string
): Promise<{ swing: number; sweep: number; sells: number; wins: number }> {
  const monthStart = `${today.slice(0, 7)}-01T00:00:00+09:00`;
  const { data } = await supabase
    .from("virtual_trades")
    .select("pnl_amount, memo")
    .eq("chat_id", chatId)
    .eq("side", "SELL")
    .is("broker_name", null)
    .is("account_name", null)
    .gte("traded_at", monthStart)
    .limit(2000);
  let swing = 0;
  let sweep = 0;
  let sells = 0;
  let wins = 0;
  for (const row of (data ?? []) as Array<{ pnl_amount: number | null; memo: string | null }>) {
    const pnl = Number(row.pnl_amount ?? 0);
    if (String(row.memo ?? "").includes("cash-sweep")) sweep += pnl;
    else {
      swing += pnl;
      sells += 1;
      if (pnl > 0) wins += 1;
    }
  }
  return { swing: Math.round(swing), sweep: Math.round(sweep), sells, wins };
}

// Storage CDN이 덮어쓴 파일의 옛 내용을 돌려주면 저장 직후 읽기가 옛 설정을 다시 올려 덮어쓴다 — 매번 캐시를 우회한다
async function downloadJson<T>(supabase: SupabaseClientAny, path: string): Promise<T | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path, { cacheNonce: String(Date.now()) });
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

async function uploadJson(supabase: SupabaseClientAny, path: string, value: unknown): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, JSON.stringify(value), {
    upsert: true,
    contentType: "application/json",
    cacheControl: "0",
  });
  if (error) throw new Error(`목표 파일 저장 실패: ${error.message}`);
}

export async function loadGoalFile(supabase: SupabaseClientAny, chatId: number): Promise<GoalTrackerFile | null> {
  return downloadJson<GoalTrackerFile>(supabase, `${GOAL_TRACKER_DIR}/${chatId}.json`);
}

/**
 * 오늘 평가액을 기록한다(같은 날은 덮어씀). 설정이 없으면 오늘 평가액으로 기본 목표를 만든다.
 * settingsPatch가 있으면 같은 읽기·쓰기 한 번에 설정도 바꾼다 — 따로 저장하면 뒤따르는 기록이 옛 설정으로 덮어쓸 수 있다.
 */
export async function recordGoalEquity(
  supabase: SupabaseClientAny,
  chatId: number,
  point: EquityPoint,
  settingsPatch?: Partial<GoalSettings>
): Promise<GoalTrackerFile> {
  const file = (await loadGoalFile(supabase, chatId)) ?? {
    settings: {
      startDate: point.date,
      startEquity: point.total,
      planAnnualPct: DEFAULT_PLAN_ANNUAL_PCT,
      targetMonthlyProfit: DEFAULT_TARGET_MONTHLY_PROFIT,
      monthlyContribution: 0,
    },
    history: [],
  };
  if (settingsPatch) file.settings = sanitizeGoalSettings(settingsPatch, file.settings);
  file.history = [...file.history.filter((p) => p.date !== point.date), point].sort((a, b) => a.date.localeCompare(b.date));
  await uploadJson(supabase, `${GOAL_TRACKER_DIR}/${chatId}.json`, file);
  return file;
}

export function sanitizeGoalSettings(input: Partial<GoalSettings>, current: GoalSettings): GoalSettings {
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return v != null && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate ?? "")) ? String(input.startDate) : current.startDate,
    startEquity: num(input.startEquity, current.startEquity, 0, 1e12),
    planAnnualPct: num(input.planAnnualPct, current.planAnnualPct, 1, 15),
    withdrawalPct: num(input.withdrawalPct, current.withdrawalPct ?? DEFAULT_WITHDRAWAL_PCT, 2, 8),
    targetMonthlyProfit: num(input.targetMonthlyProfit, current.targetMonthlyProfit, 10_000, 1e9),
    monthlyContribution: num(input.monthlyContribution, current.monthlyContribution, 0, 1e9),
    // 빈 문자열은 목표 시점 해제
    targetDate:
      input.targetDate === ""
        ? undefined
        : /^\d{4}-\d{2}$/.test(String(input.targetDate ?? ""))
          ? String(input.targetDate)
          : current.targetDate,
  };
}

export type GoalTrackerView = {
  today: string;
  settings: GoalSettings;
  equity: number;
  seed: number;
  cash: number;
  holdings: number;
  plan: { monthsElapsed: number; planValue: number; gapPct: number };
  target: { requiredSeed: number; progressPct: number; monthsToReach: number | null; etaMonth: string | null };
  thisMonth: {
    expectedProfit: number;
    returnPct: number | null;
    realizedSwing: number;
    realizedSweep: number;
    sells: number;
    wins: number;
    assessment: MonthAssessment | null;
  };
  /**
   * 1차: 필요 시드까지 모으기(수익 전부 재투자) / 2차: 필요 시드 도달 후 월 수익 받기.
   * 단계는 표시일 뿐 매매 규칙을 바꾸지 않는다(목표가 매수 기준을 낮추면 안 된다 — e021a69).
   */
  phase: { stage: 1 | 2; title: string; text: string };
  /** 지금 평가액으로 계획 수익률이면 월 평균 얼마 (재투자하는 1차 기준) */
  currentMonthlyProfit: number;
  /** 지금 평가액에서 원금을 지키며 매달 꺼내 쓸 수 있는 금액 (인출률 기준) */
  currentMonthlyWithdrawal: number;
  /** 시점별 필요 월 입금 — 1·2·3·5년과 설정한 목표 시점. 2차면 빈 배열 */
  schedule: Array<{ month: string; months: number; contribution: number; isTarget: boolean; isRetire?: boolean }>;
  /** 프로필에 출생 연월이 있을 때: 은퇴 나이 기준 계획. 없으면 null */
  life: LifePlan | null;
  normalRange: typeof NORMAL_MONTHLY_RANGE;
  /** 월 입금이 계정의 월 자동 입금 설정에서 온 값인지 (그러면 목표 트래커에서 따로 바꾸지 않는다) */
  contributionLinked: boolean;
  /** 눈에 보이는 진행: 넣은 원금 vs 불어난 돈, 복리가 월 입금을 추월하는 시점 */
  progress: {
    principal: number;
    growth: number;
    growthPct: number;
    crossover: { monthlyExpected: number; contribution: number; ratioPct: number; months: number | null; month: string | null } | null;
  };
};

export function buildGoalTrackerView(input: {
  file: GoalTrackerFile;
  now: EquityPoint & { cash: number; holdings: number; monthlyDeposit?: number | null; principal?: number | null; life?: LifeProfile | null };
  realized: { swing: number; sweep: number; sells: number; wins: number };
}): GoalTrackerView {
  const { file, now, realized } = input;
  // 월 자동 입금을 설정한 계정은 실제 입금액이 계획의 월 입금이다 (두 곳에 따로 넣지 않게)
  const contributionLinked = now.monthlyDeposit != null;
  const s = contributionLinked ? { ...file.settings, monthlyContribution: now.monthlyDeposit as number } : file.settings;
  const monthsElapsed = monthsBetween(s.startDate, now.date);
  const planValue = planValueAt(s, monthsElapsed);
  const withdrawalPct = s.withdrawalPct ?? DEFAULT_WITHDRAWAL_PCT;
  const need = requiredSeed(s.targetMonthlyProfit, withdrawalPct);
  const months = monthsToReach({
    fromEquity: now.total,
    target: need,
    planAnnualPct: s.planAnnualPct,
    monthlyContribution: s.monthlyContribution,
  });
  const etaMonth = months != null ? addMonths(now.date, months) : null;
  const reached = Number.isFinite(need) && now.total >= need;
  const phase: GoalTrackerView["phase"] = reached
    ? {
        stage: 2,
        title: "2차 · 월 수익 받기",
        text: `필요 시드에 도달했습니다. 원금은 두고 연 ${withdrawalPct}% 이내로 꺼내 쓰세요(좋은 달 수익은 CMA·파킹통장에 두었다가 나눠 쓰기). 마이너스 달이 이어져도 버틸 3~6개월치 현금을 따로 두세요.`,
      }
    : {
        stage: 1,
        title: "1차 · 시드 모으기",
        text: "수익은 전부 재투자합니다. 도달 시점을 앞당기는 가장 큰 방법은 매매 수익률보다 추가 입금입니다.",
      };
  const life = now.life
    ? buildLifePlan({
        life: now.life,
        today: now.date,
        equity: now.total,
        requiredSeed: need,
        planAnnualPct: s.planAnnualPct,
        monthlyContribution: s.monthlyContribution,
        withdrawalPct,
        etaMonth,
      })
    : null;
  const horizons: Array<{ months: number; isTarget: boolean; isRetire: boolean }> = [12, 24, 36, 60].map((months) => ({
    months,
    isTarget: false,
    isRetire: false,
  }));
  const mark = (months: number, key: "isTarget" | "isRetire") => {
    if (!(months > 0)) return;
    const h = horizons.find((x) => x.months === months);
    if (h) h[key] = true;
    else horizons.push({ months, isTarget: key === "isTarget", isRetire: key === "isRetire" });
  };
  mark(s.targetDate ? monthsUntil(now.date, s.targetDate) : 0, "isTarget");
  // 은퇴 시점 행 — 목표 시점을 따로 정하지 않았으면 은퇴 시점이 곧 목표다
  if (life && life.monthsToRetire > 0) {
    mark(life.monthsToRetire, "isRetire");
    if (!s.targetDate) mark(life.monthsToRetire, "isTarget");
  }
  const schedule = reached
    ? []
    : horizons
        .sort((a, b) => a.months - b.months)
        .map((h) => ({
          month: addMonths(now.date, h.months),
          months: h.months,
          contribution: Math.round(
            requiredMonthlyContribution({ fromEquity: now.total, target: need, planAnnualPct: s.planAnnualPct, months: h.months })
          ),
          isTarget: h.isTarget,
          isRetire: h.isRetire,
        }));
  const mtd = monthToDateReturn(file.history, now.date);
  const monthStartEquity =
    [...file.history]
      .filter((p) => p.date.slice(0, 7) < now.date.slice(0, 7))
      .sort((a, b) => a.date.localeCompare(b.date))
      .pop()?.total ?? now.total;
  return {
    today: now.date,
    settings: s,
    equity: now.total,
    seed: now.seed,
    cash: now.cash,
    holdings: now.holdings,
    plan: { monthsElapsed, planValue: Math.round(planValue), gapPct: planValue > 0 ? (now.total / planValue - 1) * 100 : 0 },
    target: {
      requiredSeed: Math.round(need),
      progressPct: Number.isFinite(need) && need > 0 ? (now.total / need) * 100 : 0,
      monthsToReach: months,
      etaMonth,
    },
    thisMonth: {
      expectedProfit: Math.round(monthStartEquity * monthlyRate(s.planAnnualPct)),
      returnPct: mtd == null ? null : mtd * 100,
      realizedSwing: realized.swing,
      realizedSweep: realized.sweep,
      sells: realized.sells,
      wins: realized.wins,
      assessment: assessMonth(mtd == null ? null : mtd * 100),
    },
    phase,
    currentMonthlyProfit: Math.round(now.total * monthlyRate(s.planAnnualPct)),
    currentMonthlyWithdrawal: Math.round((now.total * withdrawalPct) / 100 / 12),
    schedule,
    life,
    normalRange: NORMAL_MONTHLY_RANGE,
    contributionLinked,
    progress: (() => {
      const principal = Math.round(now.principal ?? s.startEquity);
      const cross = compoundingCrossover({ equity: now.total, planAnnualPct: s.planAnnualPct, monthlyContribution: s.monthlyContribution });
      return {
        principal,
        growth: Math.round(now.total - principal),
        growthPct: principal > 0 ? (now.total / principal - 1) * 100 : 0,
        crossover: cross
          ? {
              ...cross,
              contribution: s.monthlyContribution,
              month: cross.months != null ? addMonths(now.date, cross.months) : null,
            }
          : null,
      };
    })(),
  };
}

/** 금요일 텔레그램 보고용 요약 */
export function formatGoalLine(v: GoalTrackerView): string {
  const target = v.schedule.find((r) => r.isTarget);
  const man = (x: number) => `${Math.round(x / 10_000).toLocaleString("ko-KR")}만`;
  const mtd = v.thisMonth.returnPct == null ? "-" : `${v.thisMonth.returnPct >= 0 ? "+" : ""}${v.thisMonth.returnPct.toFixed(1)}%`;
  return [
    `[목표] 월 ${man(v.settings.targetMonthlyProfit)}원 인출(연 ${v.settings.withdrawalPct ?? DEFAULT_WITHDRAWAL_PCT}%) → 필요 시드 ${man(v.target.requiredSeed)}원 · 현재 ${man(v.equity)}원 (${v.target.progressPct.toFixed(0)}%)`,
    `  이번 달 ${mtd} · 스윙 확정 ${man(v.thisMonth.realizedSwing)}원 · 계획 월 평균 ${man(v.thisMonth.expectedProfit)}원 · 계획선 대비 ${v.plan.gapPct >= 0 ? "+" : ""}${v.plan.gapPct.toFixed(1)}%`,
    `  예상 도달 ${v.target.etaMonth ?? "50년 이상"} (연 ${v.settings.planAnnualPct}% 재투자${v.settings.monthlyContribution > 0 ? ` + 월 ${man(v.settings.monthlyContribution)}원 입금` : ""})`,
    target ? `  ${v.phase.title} · ${target.month}까지 닿으려면 월 ${man(target.contribution)}원 입금 필요` : `  ${v.phase.title}`,
    ...(v.life ? [`  [나이] 만 ${v.life.currentAge}세 · ${lifeVerdict(v.life)}`] : []),
  ].join("\n");
}

/** 나이 기준 판단 한 줄 — 텔레그램 보고와 화면이 같은 문구를 쓴다 */
export function lifeVerdict(l: LifePlan): string {
  const man = (x: number) => `${Math.round(x / 10_000).toLocaleString("ko-KR")}만원`;
  switch (l.status) {
    case "retired":
      return `이미 은퇴 나이(${l.retireAge}세)입니다. 지금 자산에서 원금을 지키며 꺼낼 수 있는 금액을 기준으로 보세요.`;
    case "on-track":
      return `${l.retireAge}세 은퇴(${l.retireMonth}) 전인 ${l.etaAge}세에 필요 시드에 닿는 계획입니다. 지금 적립을 유지하면 됩니다.`;
    case "late":
      return `${l.retireAge}세(${l.retireMonth})에 맞추려면 매달 ${man(l.contributionForTarget)}을 모으면 됩니다. 지금 적립대로면 ${l.etaAge}세에 닿고, ${l.retireAge}세 때는 월 ${man(l.monthlyAtRetire)}을 꺼내 쓸 수 있습니다.`;
    case "beyond-life":
      return `${l.retireAge}세(${l.retireMonth})에 맞추려면 매달 ${man(l.contributionForTarget)}을 모으면 됩니다. 지금 적립대로면 ${l.etaAge != null ? `${l.etaAge}세` : "50년 넘게 걸려"}에야 닿아, ${l.retireAge}세 때는 월 ${man(l.monthlyAtRetire)}만 꺼내 쓸 수 있습니다.`;
  }
}
