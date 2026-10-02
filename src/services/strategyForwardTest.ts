/**
 * 전략 경쟁 측정(전향 검증) — 저장 없이 쌓이는 가격·점수 데이터로 매번 다시 계산한다.
 *
 * 과거 데이터가 짧아 백테스트만으로는 결론이 안 나므로, 같은 실데이터로 여러 전략을 동시에 굴려
 * 기준일 이후 실제로 이긴 전략을 채택한다. 기준일을 운영 시작일(2026-09-28)로 두면 순수 전향 검증,
 * 과거로 두면 백테스트다.
 *
 * 규칙: 주간 전략은 매주 첫 거래일 시가에 전 거래일 점수로 종목을 골라 다음 주 첫 거래일 시가까지 동일비중 보유.
 * 지수 코어는 전일 종가가 SMA50 위면 KODEX200, 아래면 CD금리. 주식 왕복비용 0.45%(편도 0.225%), ETF 편도 0.035%.
 *
 * 실적 관문 전략은 그날그날 저장한 판정(forward-test/gate/{날짜}.json)으로 다시 계산한다 — 분기 실적 테이블은
 * 주간 ETL이 덮어쓰므로 과거 시점의 판정을 나중에 다시 만들 수 없다.
 * 봇 실제 계좌는 매일 저장한 평가액(forward-test/bot-equity/{날짜}.json)으로 계산한다.
 */

import { isCapitalFlow, type EquityPoint } from "./goalTracker";
import { computeDistributionCredit, exDividendDate, type EtfDistribution } from "./etfDistribution";

export type DailyBar = { date: string; open: number; close: number; volume: number; high?: number; low?: number };
export type ScoreRow = { code: string; score: number };

export type StrategyName =
  | "index-core"
  | "kodex200-hold"
  | "cd-only"
  | "score-top5"
  | "score-top5+trend"
  | "score-top5+flow"
  | "momentum-top5"
  | "breakout-top5"
  | "order-sheet"
  | "gate-monthly"
  | "gate-monthly+trend50"
  | "gate-top20"
  | "bot-account"
  | "sp500-hold"
  | "profile-growth-5050"
  | "profile-balanced-4"
  | "profile-allweather-kr"
  | "profile-permanent"
  | "profile-6040"
  | "profile-domestic";

export type StrategyResult = {
  name: StrategyName;
  label: string;
  totalReturnPct: number;
  maxDrawdownPct: number;
  periods: number;
  /** 봇 계좌만: 지수(KODEX200)가 내린 날·오른 날에 봇이 얼마나 같이 움직였나 */
  capture?: CaptureStats;
};

export type CaptureStats = {
  downDays: number;
  /** 지수가 내린 날들만 이은 누적수익(%) — 봇 / 지수 */
  botDownPct: number;
  indexDownPct: number;
  /** 봇 ÷ 지수. 100%보다 작을수록 하락 때 덜 빠졌다. 하락일이 부족하면 null */
  downCapturePct: number | null;
  upDays: number;
  botUpPct: number;
  indexUpPct: number;
  upCapturePct: number | null;
};

export const STRATEGY_LABELS: Record<StrategyName, string> = {
  "index-core": "지수 추세 코어(SMA50, 봇 매수 기준과 동일)",
  "kodex200-hold": "KODEX200 보유",
  "cd-only": "CD금리만",
  "score-top5": "점수 상위5 주간교체",
  "score-top5+trend": "점수 상위5 + 시장추세",
  "score-top5+flow": "점수 상위5 + 수급이탈 제외",
  "momentum-top5": "중기 모멘텀(63/126일, 최근21일 제외) 상위5",
  "breakout-top5": "55일 고점 돌파 + 거래량 확장 상위5",
  "order-sheet": "금요일 주문표대로(1주 보유)",
  "gate-monthly": "실적 관문 통과 전 종목 동일비중(월 교체)",
  "gate-monthly+trend50": "실적 관문 통과 동일비중 + 50일선 아래 CD금리",
  "gate-top20": "실적 관문 코어: 통과 종목 점수 상위 20 (월 교체·50일선, 봇 구현됨)",
  "bot-account": "봇 실제 계좌",
  "sp500-hold": "TIGER 미국S&P500 보유",
  "profile-growth-5050": "코어 성장형: 코스피200 50 + S&P500 50",
  "profile-balanced-4": "코어 균형형: 코스피200 30·나스닥100 30·국고채 25·금 15",
  "profile-allweather-kr": "코어 올웨더형: S&P500 30·미국30년채 40·미국10년채 15·금 15",
  "profile-permanent": "코어 영구형: S&P500 25·미국30년채 25·금 25·CD 25",
  "profile-6040": "코어 60/40: S&P500 60·미국10년채 40",
  "profile-domestic": "코어 국내형: 코스피200 40·국고채 40·금 20",
};

/** 비교 기준(벤치마크)과 현재 봇 — 승격 후보가 아니다 */
export const NON_CANDIDATE_STRATEGIES: StrategyName[] = [
  "kodex200-hold",
  "cd-only",
  "bot-account",
  "sp500-hold",
  // 코어 프로필은 종목 봇 대체 후보가 아니라 별도 측정(coreProfiles.ts) — 종목 봇 승격 판정에 섞이지 않는다
  "profile-growth-5050",
  "profile-balanced-4",
  "profile-allweather-kr",
  "profile-permanent",
  "profile-6040",
  "profile-domestic",
];

const STOCK_SIDE_COST = 0.00225;
const ETF_SIDE_COST = 0.00035;
const CD_ANNUAL = 0.028;
/** 지수 코어 추세선. 자동매매 신규 매수 기준(detectAutoTradeMarketPolicy, 코스피 50일선)과 같은 규칙을 측정한다. */
export const INDEX_CORE_SMA_WINDOW = 50;
/** 웹(전략 화면)이 읽는 최신 결과 위치 — Storage market-snapshots 버킷 */
export const FORWARD_TEST_RESULT_PATH = "forward-test/latest.json";
/** 날짜별 실적 관문 판정 스냅샷 폴더 */
export const FORWARD_TEST_GATE_DIR = "forward-test/gate";
/** 날짜별 봇 계좌 평가액 스냅샷 폴더 */
export const FORWARD_TEST_BOT_EQUITY_DIR = "forward-test/bot-equity";

export type GateSnapshot = { asof: string; pass: string[]; fail: string[] };
export type BotEquitySnapshot = EquityPoint;

/** asof 이하 가장 최근 스냅샷. 없으면(측정 첫 주) 가장 이른 스냅샷 — 분기 실적은 며칠 사이 거의 안 바뀐다 */
export function pickSnapshotOnOrBefore<T extends { asof: string }>(snapshots: T[], asof: string): T | null {
  const sorted = [...snapshots].sort((a, b) => a.asof.localeCompare(b.asof));
  let found: T | null = null;
  for (const snap of sorted) if (snap.asof <= asof) found = snap;
  return found ?? sorted[0] ?? null;
}

/**
 * 봇 계좌 수익: 날짜별 평가액을 이어 붙인다. 입출금이 있던 날(isCapitalFlow)은 그날 수익을 0으로 본다 — 주간 시드 재계산은 입출금이 아니다.
 */
export function simulateBotAccount(input: { points: BotEquitySnapshot[]; startDate: string }): StrategyResult | null {
  const pts = input.points
    .filter((p) => p.date >= input.startDate && p.seed > 0 && p.total > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  const equity = [1];
  for (let i = 1; i < pts.length; i += 1) {
    const r = isCapitalFlow(pts[i - 1], pts[i]) ? 0 : pts[i].total / pts[i - 1].total - 1;
    equity.push(equity[equity.length - 1] * (1 + r));
  }
  return {
    name: "bot-account",
    label: STRATEGY_LABELS["bot-account"],
    totalReturnPct: (equity[equity.length - 1] - 1) * 100,
    maxDrawdownPct: maxDrawdown(equity),
    periods: equity.length - 1,
  };
}

/** 하락·상승 포착률을 믿기 위한 최소 일수 — 이보다 적으면 비율을 내지 않는다 */
export const MIN_CAPTURE_DAYS = 5;

/**
 * 봇 계좌 vs 지수(KODEX200 종가) 하락·상승 포착률. 봇 평가액의 연속한 두 기록(a→b)마다 같은 기간 지수 수익을 맞춰
 * 지수가 내린 구간과 오른 구간으로 나눠 복리로 이어 붙인다. 입출금이 있던 구간(isCapitalFlow)은 뺀다.
 * 종가 가격수익만 쓴다(분배금 제외) — 일 단위 방향 판정엔 영향이 작다.
 */
export function computeBotCapture(input: { points: BotEquitySnapshot[]; startDate: string; index: DailyBar[] }): CaptureStats | null {
  const pts = input.points
    .filter((p) => p.date >= input.startDate && p.seed > 0 && p.total > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const bars = input.index.filter((b) => b.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2 || bars.length < 2) return null;
  const closeOnOrBefore = (date: string): number | null => {
    let lo = 0;
    let hi = bars.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].date <= date) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans >= 0 ? bars[ans].close : null;
  };
  const acc = { down: { bot: 1, idx: 1, n: 0 }, up: { bot: 1, idx: 1, n: 0 } };
  for (let i = 1; i < pts.length; i += 1) {
    if (isCapitalFlow(pts[i - 1], pts[i])) continue;
    const a = closeOnOrBefore(pts[i - 1].date);
    const b = closeOnOrBefore(pts[i].date);
    if (a == null || b == null) continue;
    const idxRet = b / a - 1;
    if (idxRet === 0) continue;
    const botRet = pts[i].total / pts[i - 1].total - 1;
    const side = idxRet < 0 ? acc.down : acc.up;
    side.bot *= 1 + botRet;
    side.idx *= 1 + idxRet;
    side.n += 1;
  }
  const ratio = (side: { bot: number; idx: number; n: number }): number | null => {
    const idxPct = (side.idx - 1) * 100;
    return side.n >= MIN_CAPTURE_DAYS && Math.abs(idxPct) > 1e-9 ? (((side.bot - 1) * 100) / idxPct) * 100 : null;
  };
  return {
    downDays: acc.down.n,
    botDownPct: (acc.down.bot - 1) * 100,
    indexDownPct: (acc.down.idx - 1) * 100,
    downCapturePct: ratio(acc.down),
    upDays: acc.up.n,
    botUpPct: (acc.up.bot - 1) * 100,
    indexUpPct: (acc.up.idx - 1) * 100,
    upCapturePct: ratio(acc.up),
  };
}

export type ForwardTestSnapshot = {
  startDate: string;
  endDate: string;
  generatedAt: string;
  results: StrategyResult[];
  review?: StrategyReview;
};

/** 승격·퇴출 판단에 필요한 최소 측정 거래일 (8주) */
export const MIN_REVIEW_TRADING_DAYS = 40;

export type StrategyReview = {
  status: "too-early" | "no-bot-data" | "propose" | "warn-bot" | "hold";
  measuredDays: number;
  /** 사람이 읽는 판정 문장 */
  lines: string[];
  /** 승격 후보 전략 이름 */
  candidates: StrategyName[];
};

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * 전략 승격·퇴출 판정 — 미리 정한 기준으로만 제안하고, 전환은 사람이 승인한다(자동 전환 없음).
 *   승격 후보: 8주 이상 측정 + 봇 실제 계좌·KODEX 200·CD금리를 모두 앞섬 + 최대 낙폭이 봇보다 나쁘지 않음
 *   봇 경고: 8주 이상 측정 + 봇이 KODEX 200과 CD금리 둘 다에 못 미침
 */
export function reviewStrategies(input: { results: StrategyResult[]; measuredDays: number }): StrategyReview {
  const { results, measuredDays } = input;
  const byName = new Map(results.map((r) => [r.name, r]));
  const bot = byName.get("bot-account");
  const kodex = byName.get("kodex200-hold");
  const cd = byName.get("cd-only");
  if (measuredDays < MIN_REVIEW_TRADING_DAYS) {
    return {
      status: "too-early",
      measuredDays,
      lines: [`측정 ${measuredDays}거래일 — ${MIN_REVIEW_TRADING_DAYS}거래일(8주) 전에는 전략을 바꾸지 않습니다.`],
      candidates: [],
    };
  }
  if (!bot || !kodex || !cd) {
    return { status: "no-bot-data", measuredDays, lines: ["봇 계좌 또는 기준 데이터가 없어 판정하지 않습니다."], candidates: [] };
  }
  const candidates = results.filter(
    (r) =>
      !NON_CANDIDATE_STRATEGIES.includes(r.name) &&
      r.totalReturnPct > bot.totalReturnPct &&
      r.totalReturnPct > kodex.totalReturnPct &&
      r.totalReturnPct > cd.totalReturnPct &&
      r.maxDrawdownPct >= bot.maxDrawdownPct
  );
  const lines: string[] = [];
  let status: StrategyReview["status"] = "hold";
  if (candidates.length) {
    status = "propose";
    for (const c of candidates) {
      lines.push(
        `승격 후보: ${c.label} ${fmtPct(c.totalReturnPct)} (낙폭 ${c.maxDrawdownPct.toFixed(1)}%) — 봇 ${fmtPct(bot.totalReturnPct)}, KODEX 200 ${fmtPct(kodex.totalReturnPct)}, CD ${fmtPct(cd.totalReturnPct)}를 모두 앞서고 낙폭도 봇 이하`
      );
    }
    // 승인·보류는 텔레그램 버튼 또는 웹 전략 화면 (strategyPromotion.ts). 자동 전환 없음
    lines.push("승인 방법: 이 메시지의 [승인] 버튼 또는 웹 전략 화면의 승인 버튼(관리자). 자동으로 바뀌지는 않습니다.");
  }
  if (bot.totalReturnPct < kodex.totalReturnPct && bot.totalReturnPct < cd.totalReturnPct) {
    if (status !== "propose") status = "warn-bot";
    lines.push(
      `봇 경고: 봇 ${fmtPct(bot.totalReturnPct)}가 KODEX 200 ${fmtPct(kodex.totalReturnPct)}과 CD금리 ${fmtPct(cd.totalReturnPct)} 모두에 못 미칩니다.`
    );
  }
  if (!lines.length) lines.push("기준을 모두 넘은 후보가 없습니다 — 현재 봇을 유지합니다.");
  return { status, measuredDays, lines, candidates: candidates.map((c) => c.name) };
}

function sma(values: number[], end: number, window: number): number | null {
  if (end + 1 < window) return null;
  let s = 0;
  for (let i = end - window + 1; i <= end; i += 1) s += values[i];
  return s / window;
}

export function maxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 1;
  let mdd = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return mdd * 100;
}

/**
 * ETF 분배금 내역 → 분배락일(가격이 실제로 빠지는 날) 기준 세후 주당 금액 지도.
 * 종가 수익률만으로는 분배금이 빠져 kodex200-hold·index-core가 실제보다 낮게 나온다
 * (etfDistribution.ts 참고 — 예전에 봇 실계좌 쪽에서 한 번 고친 것과 같은 문제).
 */
export function buildDistributionNetPerShareByDate(distributions: EtfDistribution[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of distributions) {
    const date = exDividendDate(d.recordDate);
    const net = computeDistributionCredit(d, 1).net;
    map.set(date, (map.get(date) ?? 0) + net);
  }
  return map;
}

/** 지수 코어·보유·CD: 일별 */
export function simulateIndexStrategies(input: {
  index: DailyBar[]; // KODEX200 (시작 전 100봉 이상 포함)
  startDate: string;
  /** KODEX200 분배락일 → 세후 주당 분배금. 없으면 분배금 없이(세전 가격수익률만) 계산 */
  distributionNetPerShareByDate?: Map<string, number>;
  /** 실제 CD/금리 ETF 가격(예: KODEX CD금리액티브). 없으면 CD_ANNUAL 고정값으로 대체 */
  cd?: DailyBar[];
}): StrategyResult[] {
  const bars = input.index.filter((b) => b.close > 0);
  const closes = bars.map((b) => b.close);
  const startIdx = bars.findIndex((b) => b.date >= input.startDate);
  if (startIdx < 1) return [];
  const distByDate = input.distributionNetPerShareByDate ?? new Map<string, number>();
  const cdCloseByDate = new Map((input.cd ?? []).filter((b) => b.close > 0).map((b) => [b.date, b.close]));
  const cdDailyFallback = (1 + CD_ANNUAL) ** (1 / 250) - 1;
  const cdReturnOn = (date: string, prevDate: string): number => {
    const cur = cdCloseByDate.get(date);
    const prev = cdCloseByDate.get(prevDate);
    return cur && prev ? cur / prev - 1 : cdDailyFallback;
  };
  const eq = { core: [1], hold: [1], cd: [1] };
  let inIndex = false;
  for (let i = startIdx; i < bars.length; i += 1) {
    const distYield = (distByDate.get(bars[i].date) ?? 0) / bars[i - 1].close;
    const ret = bars[i].close / bars[i - 1].close - 1 + distYield;
    const cdRet = cdReturnOn(bars[i].date, bars[i - 1].date);
    const m = sma(closes, i - 1, INDEX_CORE_SMA_WINDOW);
    const wantIndex = m != null && closes[i - 1] > m;
    const switchCost = wantIndex !== inIndex ? ETF_SIDE_COST * 2 : 0;
    inIndex = wantIndex;
    const last = (k: keyof typeof eq) => eq[k][eq[k].length - 1];
    eq.core.push(last("core") * (1 + (inIndex ? ret : cdRet) - switchCost));
    eq.hold.push(last("hold") * (1 + ret));
    eq.cd.push(last("cd") * (1 + cdRet));
  }
  const n = bars.length - startIdx;
  const mk = (name: StrategyName, e: number[]): StrategyResult => ({
    name,
    label: STRATEGY_LABELS[name],
    totalReturnPct: (e[e.length - 1] - 1) * 100,
    maxDrawdownPct: maxDrawdown(e),
    periods: n,
  });
  return [mk("index-core", eq.core), mk("kodex200-hold", eq.hold), mk("cd-only", eq.cd)];
}

/** 주간 교체 전략 */
export function simulateWeeklyStrategy(input: {
  name: StrategyName;
  rebalanceDates: string[]; // 오름차순 거래일(각 주 첫 거래일)
  pick: (rebalanceDate: string) => string[]; // 그날 시가에 살 종목 (빈 배열이면 CD금리)
  barsByCode: Map<string, Map<string, DailyBar>>;
  topN?: number;
  /** 교체 주기 — 빈 기간의 CD금리 계산용 (주간 52, 월간 12) */
  periodsPerYear?: number;
}): StrategyResult {
  const cdWeekly = (1 + CD_ANNUAL) ** (1 / (input.periodsPerYear ?? 52)) - 1;
  const equity = [1];
  let prev = new Set<string>();
  for (let w = 0; w + 1 < input.rebalanceDates.length; w += 1) {
    const d0 = input.rebalanceDates[w];
    const d1 = input.rebalanceDates[w + 1];
    const picks = input.pick(d0).slice(0, input.topN ?? 5);
    const rets: number[] = [];
    for (const code of picks) {
      const b0 = input.barsByCode.get(code)?.get(d0);
      const b1 = input.barsByCode.get(code)?.get(d1);
      const p0 = b0 && b0.open > 0 ? b0.open : b0?.close;
      const p1 = b1 && b1.open > 0 ? b1.open : b1?.close;
      if (!(p0 && p0 > 0) || !(p1 && p1 > 0)) continue;
      rets.push(p1 / p0 - 1);
    }
    const next = new Set(picks);
    const turnover = picks.length
      ? ([...next].filter((c) => !prev.has(c)).length + [...prev].filter((c) => !next.has(c)).length) / (2 * Math.max(picks.length, 1))
      : prev.size ? 0.5 : 0;
    const gross = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : cdWeekly;
    equity.push(equity[equity.length - 1] * (1 + gross - turnover * 2 * STOCK_SIDE_COST));
    prev = next;
  }
  return {
    name: input.name,
    label: STRATEGY_LABELS[input.name],
    totalReturnPct: (equity[equity.length - 1] - 1) * 100,
    maxDrawdownPct: maxDrawdown(equity),
    periods: equity.length - 1,
  };
}

export type SavedOrderSheet = {
  /** 주문표 기준 거래일 — 다음 거래일부터 주문이 유효 */
  asof: string;
  lines: Array<{ code: string; limitPrice: number; takeProfitPrice: number; stopPrice: number }>;
};

/**
 * 금요일 주문표를 그대로 걸었을 때의 성과.
 *   - 슬롯 5개 균등 비중, 빈 슬롯·미체결은 CD금리
 *   - 체결: 시가 ≤ 지정가면 시가, 장중 저가 ≤ 지정가면 지정가
 *   - 청산: 손절을 먼저 본다(같은 날 익절·손절 둘 다 닿으면 손절 — 보수적). 갭이면 시가 체결.
 *     다음 주문표 기준일 종가까지 안 닿으면 종가 청산 (1주 보유)
 */
export function simulateOrderSheetStrategy(input: {
  sheets: SavedOrderSheet[];
  tradingDates: string[]; // 오름차순
  barsByCode: Map<string, Map<string, DailyBar>>;
  slots?: number;
}): StrategyResult {
  const slots = input.slots ?? 5;
  const cdDaily = (1 + CD_ANNUAL) ** (1 / 252) - 1;
  const sheets = [...input.sheets].sort((a, b) => a.asof.localeCompare(b.asof));
  const lastDate = input.tradingDates[input.tradingDates.length - 1];
  const equity = [1];
  for (let i = 0; i < sheets.length; i += 1) {
    const end = sheets[i + 1]?.asof ?? lastDate;
    const days = input.tradingDates.filter((d) => d > sheets[i].asof && d <= end);
    if (!days.length) continue;
    const cdWindow = (1 + cdDaily) ** days.length - 1;
    const slotReturns: number[] = [];
    for (const line of sheets[i].lines.slice(0, slots)) {
      const bars = input.barsByCode.get(line.code);
      let entry: number | null = null;
      let entryIdx = -1;
      let exit: number | null = null;
      for (let k = 0; k < days.length && exit == null; k += 1) {
        const bar = bars?.get(days[k]);
        if (!bar || !(bar.open > 0)) continue;
        const low = bar.low ?? Math.min(bar.open, bar.close);
        const high = bar.high ?? Math.max(bar.open, bar.close);
        if (entry == null) {
          if (bar.open <= line.limitPrice) entry = bar.open;
          else if (low <= line.limitPrice) entry = line.limitPrice;
          else continue;
          entryIdx = k;
          if (low <= line.stopPrice) exit = Math.min(line.stopPrice, entry);
          else if (high >= line.takeProfitPrice && bar.close >= line.takeProfitPrice) exit = line.takeProfitPrice;
          continue;
        }
        if (bar.open <= line.stopPrice) exit = bar.open;
        else if (bar.open >= line.takeProfitPrice) exit = bar.open;
        else if (low <= line.stopPrice) exit = line.stopPrice;
        else if (high >= line.takeProfitPrice) exit = line.takeProfitPrice;
      }
      if (entry == null) {
        slotReturns.push(cdWindow);
        continue;
      }
      if (exit == null) {
        const lastBar = [...days].reverse().map((d) => bars?.get(d)).find((b) => b && b.close > 0);
        exit = lastBar?.close ?? entry;
      }
      // 체결 전 대기 일수만큼은 CD금리
      slotReturns.push((1 + cdDaily) ** entryIdx * (exit / entry) - 1 - 2 * STOCK_SIDE_COST);
    }
    while (slotReturns.length < slots) slotReturns.push(cdWindow);
    equity.push(equity[equity.length - 1] * (1 + slotReturns.reduce((a, b) => a + b, 0) / slots));
  }
  return {
    name: "order-sheet",
    label: STRATEGY_LABELS["order-sheet"],
    totalReturnPct: (equity[equity.length - 1] - 1) * 100,
    maxDrawdownPct: maxDrawdown(equity),
    periods: equity.length - 1,
  };
}

/**
 * 실적 관문 코어(gateCoreStrategy.ts)와 같은 규칙으로 측정: 교체일에 목록에서 빠진 종목 매도,
 * 50일선 위일 때만 새 종목 매수, 빈 칸은 CD금리. 칸마다 같은 비중(교체 때 비중을 다시 맞춘다고 가정).
 */
export function simulateGateCore(input: {
  rebalanceDates: string[];
  targetsAt: (rebalanceDate: string) => string[];
  trendUpAt: (rebalanceDate: string) => boolean;
  barsByCode: Map<string, Map<string, DailyBar>>;
  slots: number;
  plan: (input: { heldCodes: string[]; targets: string[]; trendUp: boolean; slots: number }) => {
    sell: string[];
    keep: string[];
    buy: string[];
  };
}): StrategyResult {
  const equity = [1];
  let held: string[] = [];
  for (let w = 0; w + 1 < input.rebalanceDates.length; w += 1) {
    const d0 = input.rebalanceDates[w];
    const d1 = input.rebalanceDates[w + 1];
    const plan = input.plan({ heldCodes: held, targets: input.targetsAt(d0), trendUp: input.trendUpAt(d0), slots: input.slots });
    held = [...plan.keep, ...plan.buy];
    const days = Math.max(1, (Date.parse(`${d1}T00:00:00Z`) - Date.parse(`${d0}T00:00:00Z`)) / 86_400_000);
    const cdPeriod = (1 + CD_ANNUAL) ** (days / 365) - 1;
    let sum = 0;
    for (const code of held) {
      const b0 = input.barsByCode.get(code)?.get(d0);
      const b1 = input.barsByCode.get(code)?.get(d1);
      const p0 = b0 && b0.open > 0 ? b0.open : b0?.close;
      const p1 = b1 && b1.open > 0 ? b1.open : b1?.close;
      sum += p0 && p0 > 0 && p1 && p1 > 0 ? p1 / p0 - 1 : cdPeriod;
    }
    sum += (input.slots - held.length) * cdPeriod;
    const cost = ((plan.sell.length + plan.buy.length) * STOCK_SIDE_COST) / input.slots;
    equity.push(equity[equity.length - 1] * (1 + sum / input.slots - cost));
  }
  return {
    name: "gate-top20",
    label: STRATEGY_LABELS["gate-top20"],
    totalReturnPct: (equity[equity.length - 1] - 1) * 100,
    maxDrawdownPct: maxDrawdown(equity),
    periods: equity.length - 1,
  };
}

/** 각 달의 첫 거래일 */
export function firstTradingDaysOfMonths(dates: string[]): string[] {
  const out: string[] = [];
  let lastMonth = "";
  for (const d of [...dates].sort()) {
    if (d.slice(0, 7) !== lastMonth) {
      out.push(d);
      lastMonth = d.slice(0, 7);
    }
  }
  return out;
}

/** 각 주의 첫 거래일 */
export function firstTradingDaysOfWeeks(dates: string[]): string[] {
  const out: string[] = [];
  let lastWeek = "";
  for (const d of [...dates].sort()) {
    const dt = new Date(`${d}T00:00:00Z`);
    const monday = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (monday !== lastWeek) {
      out.push(d);
      lastWeek = monday;
    }
  }
  return out;
}

export function formatForwardTestReport(input: { startDate: string; endDate: string; results: StrategyResult[] }): string {
  const sorted = [...input.results].sort((a, b) => b.totalReturnPct - a.totalReturnPct);
  const lines = [`[전략 경쟁 측정] ${input.startDate} ~ ${input.endDate}`];
  sorted.forEach((r, i) => {
    lines.push(
      `${i + 1}. ${r.label}: ${r.totalReturnPct >= 0 ? "+" : ""}${r.totalReturnPct.toFixed(1)}% · 최대낙폭 ${r.maxDrawdownPct.toFixed(1)}%`
    );
  });
  const cap = input.results.find((r) => r.name === "bot-account")?.capture;
  if (cap?.downCapturePct != null) {
    lines.push(
      `하락 포착률: 지수가 내린 ${cap.downDays}일 동안 지수 ${cap.indexDownPct.toFixed(1)}% · 봇 ${cap.botDownPct.toFixed(1)}% → ${cap.downCapturePct.toFixed(0)}% (100%보다 작을수록 덜 빠짐)`
    );
  }
  return lines.join("\n");
}
