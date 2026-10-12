/**
 * 큰 하락일·급등일 안내 카드의 실시간 부분 — 오늘 등락, 최근 고점 대비, 연속 하락 일수, 올해 같은 크기 하락 횟수,
 * 외국인 순매수와 최근 1년 위치. 원인을 단정하지 않고 '같이 움직인 것'만 보여준다(예측 아님, 매매 규칙에 쓰지 않음).
 * 과거 빈도·이후 흐름·간밤 미국 민감도 같은 고정 수치는 web/src/data/dropDayFacts.ts(scripts/research/build_drop_day_facts.py)에 있다.
 */
import { fetchKospiCloses } from "./marketFlowCaution";

type SupabaseClientAny = any;

/** 카드에서 쓰는 하락 구간 경계(%). dropDayFacts.ts의 buckets와 같아야 한다 */
export const DROP_DAY_THRESHOLDS = [-1.5, -2, -3, -5] as const;
/** 급등 경계(%). dropDayFacts.ts의 rally.surge.threshold와 같아야 한다 */
export const SURGE_THRESHOLD = 3;
/** 52주 신고가를 재는 기간(거래일) */
export const NEW_HIGH_WINDOW = 250;
/** 최근 고점을 찾는 기간(거래일) */
export const DROP_DAY_HIGH_WINDOW = 60;
/** 외국인 순매수 위치를 재는 기간(거래일) */
export const DROP_DAY_FLOW_WINDOW = 250;

export type DropDayContext = {
  /** 마지막 거래일(YYYY-MM-DD). 장중이면 오늘 */
  asOf: string;
  /** 직전 거래일 대비 등락(%) */
  changePct: number;
  /** 최근 60거래일 고점 대비(%, 0 이하) */
  fromHighPct: number;
  /** 연속 하락 거래일 수(오늘 포함, 오늘 올랐으면 0) */
  downStreak: number;
  /** asOf가 속한 해의 하루 하락·급등 횟수. 키는 경계(%) 문자열(급등은 "+3") */
  yearCounts: Record<string, number>;
  /** 오늘 종가가 직전 250거래일 최고 종가 이상(52주 신고가). 직전 자료가 250일 미만이면 false */
  newHigh52w: boolean;
  /** 외국인 순매수(억원)와 최근 250거래일 중 오늘보다 적게 산(많이 판) 날 비율. 오늘 자료가 없으면 null */
  foreign: { date: string; net: number; rank: number } | null;
};

export type CloseDay = { date: string; close: number };
export type FlowDay = { date: string; foreignNet: number };

/**
 * closes: 오래된 것부터. live가 있으면 마지막 날을 실시간 값으로 바꾸거나(같은 날) 오늘 날짜로 덧붙인다.
 * 휴장일에 live 가격이 마지막 종가와 같으면 덧붙이지 않는다(0% 하루가 생기지 않게).
 */
export function computeDropDayContext(input: {
  closes: CloseDay[];
  flows: FlowDay[];
  live?: { date: string; price: number } | null;
}): DropDayContext | null {
  const days = input.closes.filter((d) => Number.isFinite(d.close) && d.close > 0);
  const live = input.live;
  if (live && Number.isFinite(live.price) && live.price > 0 && days.length > 0) {
    const last = days[days.length - 1];
    if (last.date === live.date) days[days.length - 1] = { date: live.date, close: live.price };
    else if (live.date > last.date && Math.abs(live.price - last.close) > 1e-9) days.push({ date: live.date, close: live.price });
  }
  if (days.length < 2) return null;

  const n = days.length;
  const asOf = days[n - 1].date;
  const ret = (i: number) => (days[i].close / days[i - 1].close - 1) * 100;
  const changePct = ret(n - 1);

  let high = 0;
  for (let i = Math.max(0, n - DROP_DAY_HIGH_WINDOW); i < n; i += 1) high = Math.max(high, days[i].close);
  const fromHighPct = Math.min(0, (days[n - 1].close / high - 1) * 100);

  let downStreak = 0;
  for (let i = n - 1; i >= 1 && ret(i) < 0; i -= 1) downStreak += 1;

  const year = asOf.slice(0, 4);
  const yearCounts: Record<string, number> = {};
  const surgeKey = `+${SURGE_THRESHOLD}`;
  for (const t of DROP_DAY_THRESHOLDS) yearCounts[String(t)] = 0;
  yearCounts[surgeKey] = 0;
  for (let i = 1; i < n; i += 1) {
    if (days[i].date.slice(0, 4) !== year) continue;
    const r = ret(i);
    for (const t of DROP_DAY_THRESHOLDS) if (r <= t) yearCounts[String(t)] += 1;
    if (r >= SURGE_THRESHOLD) yearCounts[surgeKey] += 1;
  }

  let newHigh52w = false;
  if (n - 1 >= NEW_HIGH_WINDOW) {
    let prior = 0;
    for (let i = n - 1 - NEW_HIGH_WINDOW; i < n - 1; i += 1) prior = Math.max(prior, days[i].close);
    newHigh52w = days[n - 1].close >= prior;
  }

  let foreign: DropDayContext["foreign"] = null;
  const flows = input.flows.filter((f) => Number.isFinite(f.foreignNet));
  const lastFlow = flows[flows.length - 1];
  if (lastFlow && lastFlow.date === asOf && flows.length > DROP_DAY_FLOW_WINDOW) {
    const hist = flows.slice(-DROP_DAY_FLOW_WINDOW - 1, -1);
    const lower = hist.filter((f) => f.foreignNet < lastFlow.foreignNet).length;
    foreign = { date: lastFlow.date, net: lastFlow.foreignNet, rank: lower / hist.length };
  }

  return { asOf, changePct, fromHighPct, downStreak, yearCounts, newHigh52w, foreign };
}

let flowCache: { expiresAt: number; value: FlowDay[] } | null = null;

async function fetchForeignFlows(supabase: SupabaseClientAny): Promise<FlowDay[]> {
  if (flowCache && Date.now() < flowCache.expiresAt) return flowCache.value;
  const { data, error } = await supabase
    .from("market_breadth_daily")
    .select("trade_date, foreign_net")
    .eq("market", "KOSPI")
    .eq("universe_level", "market_investor")
    .order("trade_date", { ascending: false })
    .limit(DROP_DAY_FLOW_WINDOW + 10);
  // 조회 실패는 '없음'으로 캐시하지 않는다
  if (error) return [];
  const value = ((data ?? []) as any[])
    .map((r) => ({ date: String(r.trade_date).slice(0, 10), foreignNet: Number(r.foreign_net) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  flowCache = { expiresAt: Date.now() + 10 * 60_000, value };
  return value;
}

/** 네이버 코스피 종가(약 420거래일, 30분 공유 캐시) + 실시간 지수 + market_breadth_daily 외국인 순매수 */
export async function fetchDropDayContext(
  supabase: SupabaseClientAny | null,
  live: { date: string; price: number } | null
): Promise<DropDayContext | null> {
  const [closeMap, flows] = await Promise.all([
    fetchKospiCloses(7),
    supabase ? fetchForeignFlows(supabase).catch(() => [] as FlowDay[]) : Promise.resolve([] as FlowDay[]),
  ]);
  const closes = [...closeMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }));
  return computeDropDayContext({ closes, flows, live });
}
