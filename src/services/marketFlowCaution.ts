/**
 * 시장 수급 '비중 조절 경고' — 코스피가 52주 고점 5% 안쪽인데 외국인 60거래일 누적 순매도가
 * 지난 1년(250거래일) 중 하위 10%(가장 많이 판 쪽)이면 켜진다. 한 번 켜지면 60거래일 동안 '경고 유지'로 본다.
 *
 * 근거: scripts/research/validate_market_flow_caution.py (2016-01~2026-10 코스피 투자자별 일별 순매수, 네이버).
 * 기준값은 검증 전에 고정했다.
 *   - 신호 뒤 60거래일 안에 -10% 이상 빠진 비율 50% (평소 21%), 독립 사건 6번
 *     (2017-08, 2018-04, 2019-12, 2021-05, 2023-07, 2026-02)
 *   - 신호 때 지수 비중을 70%로 줄이고 60거래일 유지(나머지는 CD금리): 2017-04~2026-10 연 +14.4%·최대낙폭 -38%
 *     (계속 보유 연 +13.7%·-44%). 다른 비중·유지기간에선 수익이 -2~+2%p로 흔들렸다 → 매매 규칙이 아니라 안내로만 쓴다.
 * 한계: 2026-02-10(5,302)에도 켜졌고 그 뒤 지수는 9,115까지 올랐다. 고점 시점은 맞히지 못한다.
 * 비교로 본 신호 중 '상승 중 외국인 20일 순매도'와 '원화 약세 동반 상승'은 오히려 이후 수익이 높아 쓰지 않는다.
 */
type SupabaseClientAny = any;

export const FLOW_SUM_DAYS = 60;
export const FLOW_RANK_WINDOW = 250;
export const FLOW_RANK_BOTTOM = 0.1;
export const NEAR_HIGH_RATIO = 0.95;
export const CAUTION_HOLD_DAYS = 60;
export const MARKET_FLOW_MIN_DAYS = FLOW_SUM_DAYS + FLOW_RANK_WINDOW;

export const MARKET_FLOW_EVIDENCE = {
  period: "2016-01~2026-10",
  generatedAt: "2026-10-05",
  drop10Prob: 0.5,
  baseDrop10Prob: 0.21,
  events: 6,
  holdCagr: 0.137,
  holdMdd: -0.44,
  reduceCagr: 0.144,
  reduceMdd: -0.38,
  limit: "2026-02-10(5,302)에도 켜졌고 그 뒤 9,115까지 올랐다. 고점 시점은 맞히지 못한다.",
} as const;

export type MarketFlowDay = { date: string; close: number; foreignNet: number };

export type MarketFlowCaution = {
  asOf: string;
  /** 오늘 조건 충족 */
  activeToday: boolean;
  /** 최근 60거래일 안에 켜진 적 있음(경고 유지 기간) */
  active: boolean;
  lastSignalDate: string | null;
  /** 외국인 60거래일 누적 순매수(억원) */
  foreign60: number;
  /** 지난 250거래일 60일 누적치 중 오늘보다 작은 비율(0=1년 중 가장 많이 팜) */
  foreign60Rank: number;
  /** 코스피 종가 / 52주 고점 */
  fromHigh: number;
  message: string;
};

function signalAt(days: MarketFlowDay[], i: number): { on: boolean; sum: number; rank: number; fromHigh: number } {
  const sumAt = (j: number) => {
    let s = 0;
    for (let k = j - FLOW_SUM_DAYS + 1; k <= j; k += 1) s += days[k].foreignNet;
    return s;
  };
  const sum = sumAt(i);
  let lower = 0;
  for (let j = i - FLOW_RANK_WINDOW; j < i; j += 1) if (sumAt(j) < sum) lower += 1;
  const rank = lower / FLOW_RANK_WINDOW;
  let high = 0;
  for (let k = Math.max(0, i - 250); k <= i; k += 1) high = Math.max(high, days[k].close);
  const fromHigh = days[i].close / high;
  return { on: fromHigh >= NEAR_HIGH_RATIO && rank < FLOW_RANK_BOTTOM, sum, rank, fromHigh };
}

/** days: 오래된 것부터, 같은 거래일끼리 종가·외국인 순매수(억원)가 맞춰진 목록 */
export function computeMarketFlowCaution(days: MarketFlowDay[]): MarketFlowCaution | null {
  const valid = days.filter((d) => Number.isFinite(d.close) && d.close > 0 && Number.isFinite(d.foreignNet));
  if (valid.length < MARKET_FLOW_MIN_DAYS || valid.length !== days.length) return null;
  const last = valid.length - 1;
  const today = signalAt(valid, last);
  let lastSignal: number | null = today.on ? last : null;
  for (let i = last - 1; lastSignal == null && i >= Math.max(MARKET_FLOW_MIN_DAYS, last - CAUTION_HOLD_DAYS + 1); i -= 1) {
    if (signalAt(valid, i).on) lastSignal = i;
  }
  const active = lastSignal != null;
  const ev = MARKET_FLOW_EVIDENCE;
  const foreignJo = (today.sum / 10_000).toFixed(1);
  const message = active
    ? `코스피가 고점 부근인데 외국인이 1년 중 가장 많이 파는 구간(최근 신호 ${valid[lastSignal!].date}). ` +
      `과거 같은 상황에서 3개월 안에 -10% 이상 빠진 비율 ${Math.round(ev.drop10Prob * 100)}%(평소 ${Math.round(ev.baseDrop10Prob * 100)}%). ` +
      `개별주 추가매수를 멈추고, 계획보다 늘어난 비중은 줄일지 검토하세요. 지수 적립은 계획대로.`
    : `외국인 60일 누적 ${Number(foreignJo) >= 0 ? "+" : ""}${foreignJo}조원 — 수급 경고 없음.`;
  return {
    asOf: valid[last].date,
    activeToday: today.on,
    active,
    lastSignalDate: lastSignal != null ? valid[lastSignal].date : null,
    foreign60: today.sum,
    foreign60Rank: today.rank,
    fromHigh: today.fromHigh,
    message,
  };
}

const NAVER_HEADERS = { "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36" };

async function fetchKospiCloses(pages: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const results = await Promise.all(
    Array.from({ length: pages }, (_, p) =>
      fetch(`https://m.stock.naver.com/api/index/KOSPI/price?pageSize=60&page=${p + 1}`, { headers: NAVER_HEADERS })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    )
  );
  for (const rows of results as any[]) {
    for (const r of Array.isArray(rows) ? rows : []) {
      const date = String(r?.localTradedAt ?? "").slice(0, 10);
      const close = Number(String(r?.closePrice ?? "").replace(/,/g, ""));
      if (date && close > 0) out.set(date, close);
    }
  }
  return out;
}

let cache: { expiresAt: number; value: MarketFlowCaution | null } | null = null;

/** market_breadth_daily(배치가 쌓는 시장 수급) + 네이버 코스피 종가. 데이터가 부족하면 null */
export async function fetchMarketFlowCaution(supabase: SupabaseClientAny): Promise<MarketFlowCaution | null> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;
  const { data } = await supabase
    .from("market_breadth_daily")
    .select("trade_date, foreign_net")
    .eq("market", "KOSPI")
    .eq("universe_level", "market_investor")
    .order("trade_date", { ascending: false })
    .limit(400);
  const flows = new Map<string, number>();
  for (const r of (data ?? []) as any[]) flows.set(String(r.trade_date).slice(0, 10), Number(r.foreign_net));
  if (flows.size < MARKET_FLOW_MIN_DAYS) {
    cache = { expiresAt: Date.now() + 10 * 60_000, value: null };
    return null;
  }
  const closes = await fetchKospiCloses(7);
  const days = [...flows.keys()]
    .filter((d) => closes.has(d))
    .sort()
    .map((d) => ({ date: d, close: closes.get(d)!, foreignNet: flows.get(d)! }));
  const value = computeMarketFlowCaution(days.slice(-(MARKET_FLOW_MIN_DAYS + CAUTION_HOLD_DAYS)));
  cache = { expiresAt: Date.now() + 30 * 60_000, value };
  return value;
}
