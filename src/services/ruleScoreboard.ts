/**
 * 규칙 점수판 — 매수 회피·선호 규칙이 실제로 말한 대로 작동하는지 날마다 기록하고 주간으로 집계한다.
 *
 * 전략 경쟁 측정(strategyForwardTest.ts)이 '전략 묶음'의 수익을 비교한다면, 이건 '규칙 하나'가 가리킨 종목의
 * 이후 20거래일 성과를 같은 날 후보군 평균·KODEX 200과 비교한다. 규칙을 바꾸지 않고 기록만 한다(자동 전환 없음).
 *
 * 기록(하루 한 번, 판단 시점 고정): 그날 완료된 일봉만으로 규칙에 걸린 종목을 forward-test/rules/{날짜}.json 에 저장한다.
 * 집계: 기록일 다음 거래일 시가 진입 → 20거래일 뒤 시가 청산(시가 대 시가). 비용은 빼지 않는다(회피 규칙은 '사면 얼마나 나빴나'를
 * 보는 용도이고, 선호 규칙은 같은 날 평균과의 상대 비교라 비용 차이가 작다).
 *
 * 판정 기준(결과 보기 전 고정 — docs/rule-scoreboard-2026-10-08.md):
 *   - 기록일(성숙일) 20일 미만: 표본 부족, 숫자만 보여 준다.
 *   - 20일 이상: 같은 날 후보군 평균 대비 평균 초과수익의 부호가 규칙의 기대 방향과 같은지(방향 일치) 본다.
 *   - 60일 이상이고 |t| ≥ 2(날짜별 평균 초과수익의 Newey-West t)일 때만 '통과/반대 확정'. 11/23 관문은 방향만 쓴다(H11).
 */
import {
  CHASE_ENTRY_EVIDENCE,
  FALLING_KNIFE_EVIDENCE,
  UPPER_WICK_EVIDENCE,
  computeEntryGuardKinds,
  type DailyBar,
  type EntryGuardKind,
} from "./chaseEntrySignal";
import { QUALITY_PREF_EVIDENCE, computeQualityMetrics, rankQualityPreference, type QualityMetrics } from "./qualityPreferenceSignal";

export type RuleId = EntryGuardKind | "pref-top";

export const RULE_HORIZON_DAYS = 20;
/** 방향을 말할 수 있는 최소 성숙일 */
export const RULE_MIN_DATES_FOR_DIRECTION = 20;
/** t 판정을 하는 최소 성숙일 — 20일 보유가 겹치므로 서로 안 겹치는 구간 3개 정도 */
export const RULE_MIN_DATES_FOR_T = 60;
export const RULE_T_THRESHOLD = 2;
/** 선호 점수 상위 몫 (C22와 같은 20%) */
export const PREF_TOP_SHARE = 0.2;
export const RULE_MIN_BENCH_POOL = 10;

export const RULE_SCOREBOARD_DIR = "forward-test/rules";
export const RULE_SCOREBOARD_RESULT_PATH = "forward-test/rules-latest.json";

export type RuleDef = {
  id: RuleId;
  label: string;
  /** -1: 걸린 종목이 평균보다 못해야 규칙이 맞음(회피), +1: 더 나아야 맞음(선호) */
  expected: -1 | 1;
  /** 과거 검증이 말한 20일 초과수익 (표시용) */
  history: string;
};

const pct1 = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export const RULE_DEFS: RuleDef[] = [
  {
    id: "chase",
    label: "급등 추격 회피(급등 뒤 5거래일)",
    expected: -1,
    history: `과거 ${pct1(CHASE_ENTRY_EVIDENCE.excess20d)} (C16, 코스피 대비)`,
  },
  {
    id: "wick",
    label: "긴 윗꼬리 회피",
    expected: -1,
    history: `과거 ${pct1(UPPER_WICK_EVIDENCE.excess20dBefore2022)}(~2021)·${pct1(UPPER_WICK_EVIDENCE.excess20dSince2022)}(2022~)`,
  },
  {
    id: "knife",
    label: "한 달 -15% 급락 회피",
    expected: -1,
    history: `과거 ${pct1(FALLING_KNIFE_EVIDENCE.excess20dBefore2022)}(~2021)·${pct1(FALLING_KNIFE_EVIDENCE.excess20dSince2022)}(2022~)`,
  },
  {
    id: "pref-top",
    label: "선호 점수 상위 20%(저변동·52주 고가 근접)",
    expected: 1,
    history: `과거 ${pct1(QUALITY_PREF_EVIDENCE.excess20dBefore2022)}(~2021)·${pct1(QUALITY_PREF_EVIDENCE.excess20dSince2022)}(2022~), 봇 유니버스 근사 +0.4~+1.0%`,
  },
];

export type RuleSnapshot = {
  asof: string;
  recordedAt: string;
  /** 그날 배치가 아니라 나중에 과거 날짜를 다시 만든 기록 — 판단은 asof까지의 일봉만 썼다 */
  backfilled: boolean;
  /** asof에 거래된 후보군(같은 날 평균의 분모) */
  universe: string[];
  flags: Record<RuleId, string[]>;
};

/** 규칙에 걸린 종목을 asof 기준으로 고정한다. barsByCode는 오래된 것부터 정렬된 일봉. */
export function buildRuleSnapshot(input: {
  asof: string;
  universe: string[];
  barsByCode: Map<string, DailyBar[]>;
  recordedAt: string;
  backfilled: boolean;
}): RuleSnapshot {
  const flags: Record<RuleId, string[]> = { chase: [], wick: [], knife: [], "pref-top": [] };
  const universe: string[] = [];
  const metrics = new Map<string, QualityMetrics>();
  for (const code of [...new Set(input.universe)].sort()) {
    const all = input.barsByCode.get(code);
    if (!all?.length) continue;
    const bars = all.filter((b) => b.date <= input.asof);
    if (!bars.length || bars[bars.length - 1].date !== input.asof) continue;
    universe.push(code);
    for (const kind of computeEntryGuardKinds(bars)) flags[kind].push(code);
    const m = computeQualityMetrics(bars);
    if (m) metrics.set(code, m);
  }
  const ranked = [...rankQualityPreference(metrics).entries()].sort(
    (a, b) => b[1].preference - a[1].preference || a[0].localeCompare(b[0])
  );
  flags["pref-top"] = ranked.slice(0, Math.ceil(ranked.length * PREF_TOP_SHARE)).map(([code]) => code);
  return { asof: input.asof, recordedAt: input.recordedAt, backfilled: input.backfilled, universe, flags };
}

export type RuleVerdict = "insufficient" | "direction-match" | "direction-opposite" | "confirmed" | "contradicted";

export const RULE_VERDICT_LABELS: Record<RuleVerdict, string> = {
  insufficient: "표본 부족",
  "direction-match": "방향 일치(유의 판정 전)",
  "direction-opposite": "방향 반대(유의 판정 전)",
  confirmed: "기준 통과",
  contradicted: "기준 반대 — 규칙 점검",
};

export function judgeRule(input: { expected: -1 | 1; maturedDates: number; meanExcess: number | null; t: number | null }): RuleVerdict {
  if (input.meanExcess == null || input.maturedDates < RULE_MIN_DATES_FOR_DIRECTION) return "insufficient";
  const match = input.meanExcess * input.expected > 0;
  if (input.maturedDates >= RULE_MIN_DATES_FOR_T && input.t != null && Math.abs(input.t) >= RULE_T_THRESHOLD) {
    return match ? "confirmed" : "contradicted";
  }
  return match ? "direction-match" : "direction-opposite";
}

/** 평균의 Newey-West t (Bartlett 가중). 표본이 10개 미만이면 null. */
export function neweyWestT(values: number[], lag: number): number | null {
  const n = values.length;
  if (n < 10) return null;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const e = values.map((v) => v - mean);
  let variance = e.reduce((s, v) => s + v * v, 0) / n;
  const maxLag = Math.min(lag, n - 1);
  for (let l = 1; l <= maxLag; l += 1) {
    let cov = 0;
    for (let i = l; i < n; i += 1) cov += e[i] * e[i - l];
    variance += (2 * (1 - l / (maxLag + 1)) * cov) / n;
  }
  if (!(variance > 0)) return null;
  return mean / Math.sqrt(variance / n);
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type RuleStat = {
  id: RuleId;
  label: string;
  expected: -1 | 1;
  history: string;
  /** 기록된 날짜 수 / 20일 보유가 끝난 날짜 수 / 아직 안 끝난 날짜 수 */
  recordedDates: number;
  maturedDates: number;
  pendingDates: number;
  /** 성숙일 중 규칙에 걸린 종목이 있던 날 수 / 걸린 종목-날짜 건수 */
  datesWithFlags: number;
  events: number;
  /** 같은 날 후보군 평균 대비, 날짜별 평균을 다시 평균 */
  meanExcessUniverse: number | null;
  medianExcessUniverse: number | null;
  meanExcessIndex: number | null;
  /** 기대 방향과 같은 부호였던 날짜 비율 */
  directionHitRate: number | null;
  /** 날짜 순서로 앞절반·뒷절반 평균 (날짜 10개 이상) */
  halves: [number, number] | null;
  t: number | null;
  verdict: RuleVerdict;
};

export type RuleScoreboard = {
  generatedAt: string;
  horizonDays: number;
  firstAsof: string | null;
  lastAsof: string | null;
  backfilledDates: number;
  /** 가장 최근 기록일의 규칙별 걸린 종목 수 / 후보군 크기 */
  latestFlagCounts: Record<RuleId, number> | null;
  latestUniverse: number | null;
  rules: RuleStat[];
};

export function evaluateRuleScoreboard(input: {
  snapshots: RuleSnapshot[];
  /** 지수(KODEX 200) 거래일, 오름차순 — 진입·청산일을 이 달력으로 센다 */
  tradingDates: string[];
  /** 그 날짜의 시가. 거래 없음·자료 없음이면 null */
  openAt: (code: string, date: string) => number | null;
  indexCode: string;
  generatedAt: string;
  horizonDays?: number;
}): RuleScoreboard {
  const horizon = input.horizonDays ?? RULE_HORIZON_DAYS;
  const snapshots = [...input.snapshots].sort((a, b) => a.asof.localeCompare(b.asof));
  const series = new Map<RuleId, Array<{ date: string; vsUniverse: number; vsIndex: number | null; events: number[] }>>(
    RULE_DEFS.map((r) => [r.id, []])
  );
  const pending = new Map<RuleId, number>(RULE_DEFS.map((r) => [r.id, 0]));
  const matured = new Map<RuleId, number>(RULE_DEFS.map((r) => [r.id, 0]));

  for (const snap of snapshots) {
    const entryIdx = input.tradingDates.findIndex((d) => d > snap.asof);
    const exitIdx = entryIdx < 0 ? -1 : entryIdx + horizon;
    if (entryIdx < 0 || exitIdx >= input.tradingDates.length) {
      for (const r of RULE_DEFS) pending.set(r.id, (pending.get(r.id) ?? 0) + 1);
      continue;
    }
    const entryDate = input.tradingDates[entryIdx];
    const exitDate = input.tradingDates[exitIdx];
    const ret = (code: string): number | null => {
      const a = input.openAt(code, entryDate);
      const b = input.openAt(code, exitDate);
      return a && a > 0 && b && b > 0 ? b / a - 1 : null;
    };
    const universeReturns = snap.universe.map(ret).filter((v): v is number => v != null);
    const benchmark = universeReturns.length >= RULE_MIN_BENCH_POOL ? mean(universeReturns) : null;
    const indexReturn = ret(input.indexCode);
    for (const r of RULE_DEFS) {
      if (benchmark == null) {
        pending.set(r.id, (pending.get(r.id) ?? 0) + 1);
        continue;
      }
      matured.set(r.id, (matured.get(r.id) ?? 0) + 1);
      const events = snap.flags[r.id].map(ret).filter((v): v is number => v != null).map((v) => v - benchmark);
      if (!events.length) continue;
      series.get(r.id)!.push({
        date: snap.asof,
        vsUniverse: mean(events),
        vsIndex: indexReturn == null ? null : mean(events) + benchmark - indexReturn,
        events,
      });
    }
  }

  const rules: RuleStat[] = RULE_DEFS.map((def) => {
    const rows = series.get(def.id)!;
    const dateMeans = rows.map((r) => r.vsUniverse);
    const allEvents = rows.flatMap((r) => r.events);
    const indexMeans = rows.map((r) => r.vsIndex).filter((v): v is number => v != null);
    const maturedDates = matured.get(def.id) ?? 0;
    const meanExcess = dateMeans.length ? mean(dateMeans) : null;
    const t = maturedDates >= RULE_MIN_DATES_FOR_T ? neweyWestT(dateMeans, Math.min(horizon - 1, Math.floor(dateMeans.length / 3))) : null;
    const half = dateMeans.length >= 10 ? dateMeans.length >> 1 : 0;
    return {
      id: def.id,
      label: def.label,
      expected: def.expected,
      history: def.history,
      recordedDates: snapshots.length,
      maturedDates,
      pendingDates: pending.get(def.id) ?? 0,
      datesWithFlags: rows.length,
      events: allEvents.length,
      meanExcessUniverse: meanExcess,
      medianExcessUniverse: allEvents.length ? median(allEvents) : null,
      meanExcessIndex: indexMeans.length ? mean(indexMeans) : null,
      directionHitRate: dateMeans.length ? dateMeans.filter((v) => v * def.expected > 0).length / dateMeans.length : null,
      halves: half ? [mean(dateMeans.slice(0, half)), mean(dateMeans.slice(half))] : null,
      t,
      verdict: judgeRule({ expected: def.expected, maturedDates, meanExcess, t }),
    };
  });

  const last = snapshots[snapshots.length - 1] ?? null;
  return {
    generatedAt: input.generatedAt,
    horizonDays: horizon,
    firstAsof: snapshots[0]?.asof ?? null,
    lastAsof: last?.asof ?? null,
    backfilledDates: snapshots.filter((s) => s.backfilled).length,
    latestFlagCounts: last
      ? { chase: last.flags.chase.length, wick: last.flags.wick.length, knife: last.flags.knife.length, "pref-top": last.flags["pref-top"].length }
      : null,
    latestUniverse: last ? last.universe.length : null,
    rules,
  };
}

export function formatRuleScoreboard(board: RuleScoreboard): string {
  const lines = [
    `[규칙 점수판] 기록 ${board.firstAsof ?? "-"} ~ ${board.lastAsof ?? "-"} (사후 재구성 ${board.backfilledDates}일 포함) · 생성 ${board.generatedAt.slice(0, 10)}`,
    `기준: 다음 거래일 시가 진입 → ${board.horizonDays}거래일 뒤 시가, 같은 날 후보군(core·extended) 평균 대비. 비용 미반영.`,
  ];
  if (board.latestFlagCounts && board.latestUniverse != null) {
    const c = board.latestFlagCounts;
    lines.push(`최근 기록일: 후보군 ${board.latestUniverse}종목 중 급등 ${c.chase} · 윗꼬리 ${c.wick} · 급락 ${c.knife} · 선호 상위 ${c["pref-top"]}`);
  }
  for (const r of board.rules) {
    lines.push("");
    lines.push(`■ ${r.label} — ${RULE_VERDICT_LABELS[r.verdict]}`);
    if (r.maturedDates === 0) {
      lines.push(`  아직 ${board.horizonDays}거래일이 지난 기록이 없습니다 (대기 ${r.pendingDates}일).`);
      continue;
    }
    const pctv = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
    lines.push(
      `  성숙 ${r.maturedDates}일 중 해당 ${r.datesWithFlags}일 · ${r.events}건 · 후보군 평균 대비 평균 ${pctv(r.meanExcessUniverse)} · 중앙 ${pctv(r.medianExcessUniverse)} · KODEX 200 대비 ${pctv(r.meanExcessIndex)}`
    );
    const extras: string[] = [];
    if (r.directionHitRate != null) extras.push(`기대 방향 날짜 ${(r.directionHitRate * 100).toFixed(0)}%`);
    if (r.halves) extras.push(`앞절반 ${pctv(r.halves[0])} · 뒷절반 ${pctv(r.halves[1])}`);
    if (r.t != null) extras.push(`t ${r.t.toFixed(2)}`);
    else if (r.maturedDates < RULE_MIN_DATES_FOR_T) extras.push(`t는 ${RULE_MIN_DATES_FOR_T}일부터(현재 ${r.maturedDates}일)`);
    lines.push(`  ${extras.join(" · ")} · 기대: ${r.expected < 0 ? "평균보다 낮음" : "평균보다 높음"} · ${r.history}`);
  }
  lines.push("");
  lines.push(
    `한계: 20일 보유 구간이 겹쳐 날짜 수만큼 독립 표본이 아니고, 걸린 종목이 적은 날이 많습니다. ${RULE_MIN_DATES_FOR_DIRECTION}일 미만은 숫자만 보고 ${RULE_MIN_DATES_FOR_T}일 전에는 규칙을 바꾸지 않습니다. 후보군은 시총 상위 core·extended 233종목 안팎이며 거래정지 종목은 표본에서 빠집니다.`
  );
  return lines.join("\n");
}
