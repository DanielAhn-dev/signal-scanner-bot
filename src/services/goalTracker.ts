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
): Promise<(EquityPoint & { cash: number; holdings: number }) | null> {
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
  schedule: Array<{ month: string; months: number; contribution: number; isTarget: boolean }>;
  normalRange: typeof NORMAL_MONTHLY_RANGE;
};

export function buildGoalTrackerView(input: {
  file: GoalTrackerFile;
  now: EquityPoint & { cash: number; holdings: number };
  realized: { swing: number; sweep: number; sells: number; wins: number };
}): GoalTrackerView {
  const { file, now, realized } = input;
  const s = file.settings;
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
        title: "2차 — 월 수익 받기",
        text: `필요 시드에 도달했습니다. 원금은 두고 연 ${withdrawalPct}% 이내로 꺼내 쓰세요(좋은 달 수익은 CMA·파킹통장에 두었다가 나눠 쓰기). 마이너스 달이 이어져도 버틸 3~6개월치 현금을 따로 두세요.`,
      }
    : {
        stage: 1,
        title: "1차 — 시드 모으기",
        text: "수익은 전부 재투자합니다. 도달 시점을 앞당기는 가장 큰 방법은 매매 수익률보다 추가 입금입니다.",
      };
  const horizons = [12, 24, 36, 60].map((months) => ({ months, isTarget: false }));
  const targetMonths = s.targetDate ? monthsUntil(now.date, s.targetDate) : 0;
  if (targetMonths > 0) {
    const i = horizons.findIndex((h) => h.months === targetMonths);
    if (i >= 0) horizons[i].isTarget = true;
    else horizons.push({ months: targetMonths, isTarget: true });
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
    normalRange: NORMAL_MONTHLY_RANGE,
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
  ].join("\n");
}
