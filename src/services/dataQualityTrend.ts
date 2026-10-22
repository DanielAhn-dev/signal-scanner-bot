/**
 * 데이터 품질 추세 점검 — "왔나?"(신선도·행 수)가 아니라 "제대로 왔나?"를 본다(순수 함수).
 *
 * 2026-10-15~20 신용/공매도 수집은 매일 KRX 차단으로 60~118종목만 정상이었지만, KIS 보조가 채운 부분 행 덕에
 * 행 수 검증은 "정상"이었다. 그래서 행 안의 상태(정상 비율)를 최근 거래일과 비교하고, 유니버스 대비 채움률이
 * 오래 낮은 항목은 만성 부족으로 따로 표시한다. 평소 수준은 DB에 이미 있는 최근 거래일 기록에서 센다(별도 테이블 없음).
 */

import { labelFromNameMap } from "../lib/stockLabel";

export type MetricSpec = {
  key: string;
  label: string;
  /** 유니버스 대비 이 비율 아래면 만성 부족으로 본다(없으면 판정 안 함) */
  floorShare?: number;
  /** 주간 요약에만 보이고 급감·만성 판정은 하지 않는다(원래 날마다 크게 흔들리는 값) */
  trackOnly?: boolean;
};

/** date 오름차순, 마지막이 최신 거래일. 값이 null이면 조회 실패(판정에서 뺀다) */
export type DailyMetrics = { date: string; values: Record<string, number | null> };

export type TrendFinding = { key: string; label: string; latest: number; baseline: number };
export type ChronicFinding = { key: string; label: string; latest: number; share: number; floorShare: number };

export type TrendReport = { drops: TrendFinding[]; chronic: ChronicFinding[] };

/** 최신값이 평소(직전 거래일들 중앙값)의 이 비율 미만이면 급감으로 본다 */
export const DROP_RATIO = 0.8;
/** 평소 값이 이보다 작으면 비교가 무의미해 판정하지 않는다 */
const MIN_BASELINE = 20;
/** 평소 수준을 볼 직전 거래일 수 */
const BASELINE_DAYS = 7;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function evaluateQualityTrend(history: DailyMetrics[], specs: MetricSpec[], universeSize: number | null): TrendReport {
  const drops: TrendFinding[] = [];
  const chronic: ChronicFinding[] = [];
  const latestDay = history[history.length - 1];
  if (!latestDay) return { drops, chronic };
  const prevDays = history.slice(0, -1).slice(-BASELINE_DAYS);

  for (const spec of specs) {
    if (spec.trackOnly) continue;
    const latest = latestDay.values[spec.key];
    if (latest == null) continue;
    const prevValues = prevDays.map((d) => d.values[spec.key]).filter((v): v is number => v != null);
    const baseline = median(prevValues);
    if (baseline != null && baseline >= MIN_BASELINE && latest < baseline * DROP_RATIO) {
      drops.push({ key: spec.key, label: spec.label, latest, baseline });
    }
    if (spec.floorShare != null && universeSize && universeSize > 0) {
      const share = latest / universeSize;
      if (share < spec.floorShare) chronic.push({ key: spec.key, label: spec.label, latest, share, floorShare: spec.floorShare });
    }
  }
  return { drops, chronic };
}

export type Bar = { ticker: string; close: number | null };

/**
 * 하루 등락이 가격제한폭(±30%)을 넘는 종목 — 분할·병합 미반영 가격이거나 잘못 받은 값이다.
 * 지표·점수가 그 종목에서 왜곡되므로 알린다. 경계 반올림 여유로 30.5%를 쓴다.
 */
export function findLimitBreaches(latest: Bar[], prev: Bar[], limit = 0.305): { ticker: string; ret: number }[] {
  const prevClose = new Map(prev.map((b) => [b.ticker, Number(b.close)]));
  const out: { ticker: string; ret: number }[] = [];
  for (const b of latest) {
    const c = Number(b.close);
    const pc = prevClose.get(b.ticker);
    if (!(c > 0) || !(pc && pc > 0)) continue;
    const ret = c / pc - 1;
    if (Math.abs(ret) > limit) out.push({ ticker: b.ticker, ret });
  }
  return out.sort((a, b) => Math.abs(b.ret) - Math.abs(a.ret));
}

/** 오늘 새로 시세가 빠진 유니버스 종목(어제는 있었는데 오늘 없음). 원래 빠져 있던 거래정지 종목은 반복 알리지 않는다 */
export function findNewlyMissing(universe: string[], latestTickers: Iterable<string>, prevTickers: Iterable<string>): string[] {
  const latest = new Set(latestTickers);
  const prev = new Set(prevTickers);
  return universe.filter((c) => !latest.has(c) && prev.has(c)).sort();
}

/** 이름이 비었거나 코드와 같은 행(2026-10-20 사고: 수집 실패 시 코드를 이름으로 저장) */
export function findBadNames(rows: { code: string; name: string | null }[]): string[] {
  return rows.filter((r) => !r.name || !r.name.trim() || r.name.trim() === r.code).map((r) => r.code).sort();
}

export type RequiredStockRow = { code: string; name: string | null; is_active: boolean | null; close: number | null };
export type RequiredIssue = { code: string; uses: string[]; issues: string[] };

/**
 * 보유·추천·운용에 꼭 필요한 종목의 상태. 활성 여부와 관계없이 본다.
 *
 * 이름 점검은 활성 행만 봐서, 필요한 종목이 비활성이 되거나 가격이 비어도 알리지 않았다
 * (2026-10-21 보유 ETF 6종 stocks.close=0이 하루 넘게 −100%로 쓰였는데 알림 없음).
 * barTickers가 null이면(그날 일봉 조회 실패) 일봉 항목은 건너뛴다.
 */
export function findRequiredIssues(
  required: Map<string, string[]>,
  rows: RequiredStockRow[],
  barTickers: Set<string> | null,
): RequiredIssue[] {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const out: RequiredIssue[] = [];
  for (const [code, uses] of [...required.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const row = byCode.get(code);
    const issues: string[] = [];
    if (!row) {
      issues.push("종목 목록에 없음");
    } else {
      if (row.is_active === false) issues.push("비활성");
      if (!row.name || !row.name.trim() || row.name.trim() === code) issues.push("이름 없음");
      if (!(Number(row.close) > 0)) issues.push("종가 없음");
    }
    if (barTickers && !barTickers.has(code)) issues.push("그날 시세 없음");
    if (issues.length) out.push({ code, uses, issues });
  }
  return out;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

export type QualityAlertInput = {
  trend: TrendReport;
  limitBreaches: { ticker: string; ret: number }[];
  newlyMissing: string[];
  badNames: string[];
  /** 보유·추천·운용에 필요한 종목의 문제(활성 여부 무관). 맨 위에 적는다 */
  requiredIssues?: RequiredIssue[];
  /** 종목 코드 → 이름. 있으면 "이름(코드)"로 적는다 */
  nameByCode?: Map<string, string>;
};

// 본문이 텔레그램 HTML이라 이름의 &·<·>(예: S&P500)를 이스케이프한다
function htmlLabel(code: string, names: Map<string, string> | undefined): string {
  return labelFromNameMap(code, names).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 알릴 것이 있으면 텔레그램 HTML 본문, 없으면 null. 만성 부족은 주간 요약에서만 다룬다 */
export function buildQualityAlert(input: QualityAlertInput): string | null {
  const lines: string[] = [];
  const required = input.requiredIssues ?? [];
  if (required.length) {
    const sample = required.slice(0, 8).map((r) => `${htmlLabel(r.code, input.nameByCode)} [${r.uses.join("·")}] ${r.issues.join("·")}`);
    lines.push(`• 보유·추천에 필요한 종목 문제 ${required.length}개:\n  ${sample.join("\n  ")}`);
  }
  for (const d of input.trend.drops) {
    lines.push(`• ${d.label}: ${d.latest}건 (평소 ${Math.round(d.baseline)}건의 ${pct(d.latest / d.baseline)})`);
  }
  if (input.newlyMissing.length) {
    lines.push(`• 어제는 있던 시세가 오늘 빠진 종목 ${input.newlyMissing.length}개: ${input.newlyMissing.slice(0, 8).map((c) => htmlLabel(c, input.nameByCode)).join(", ")}`);
  }
  if (input.limitBreaches.length) {
    const sample = input.limitBreaches.slice(0, 5).map((b) => `${htmlLabel(b.ticker, input.nameByCode)} ${b.ret > 0 ? "+" : ""}${(b.ret * 100).toFixed(0)}%`);
    lines.push(`• 가격제한폭(±30%)을 넘는 등락 ${input.limitBreaches.length}개: ${sample.join(", ")} — 분할·병합 미반영 또는 잘못된 값`);
  }
  if (input.badNames.length) {
    lines.push(`• 이름이 비었거나 코드와 같은 종목 ${input.badNames.length}개: ${input.badNames.slice(0, 8).join(", ")}`);
  }
  if (!lines.length) return null;
  return ["🔎 <b>데이터 품질 주의</b>", "배치는 정상 종료됐지만 값의 질이 평소와 다릅니다.\n", ...lines].join("\n");
}

/** 주간 요약: 항목별 최근 거래일 값 추이와 만성 부족 */
export function buildWeeklyQualitySummary(history: DailyMetrics[], specs: MetricSpec[], universeSize: number | null, chronic: ChronicFinding[]): string {
  const days = history.slice(-5);
  const header = days.map((d) => d.date.slice(5)).join(" · ");
  const lines = ["📋 <b>주간 데이터 품질 요약</b>", `유니버스 ${universeSize ?? "?"}종목 · ${header}\n`];
  for (const spec of specs) {
    const values = days.map((d) => (d.values[spec.key] == null ? "-" : String(d.values[spec.key]))).join(" · ");
    lines.push(`• ${spec.label}: ${values}`);
  }
  if (chronic.length) {
    lines.push("\n만성 부족(유니버스 대비 기준 미달):");
    for (const c of chronic) lines.push(`• ${c.label}: ${pct(c.share)} (기준 ${pct(c.floorShare)})`);
  } else {
    lines.push("\n만성 부족 항목 없음");
  }
  return lines.join("\n");
}

/** 그 주의 마지막 거래일인지(다음 거래일이 다음 주) — 금요일이 휴장이면 목요일에 주간 요약을 보낸다 */
export function isLastTradingDayOfWeek(day: string, nextTradingDay: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  const n = new Date(`${nextTradingDay}T00:00:00Z`);
  const dow = (x: Date) => (x.getUTCDay() + 6) % 7; // 월=0 … 일=6
  return n.getTime() - d.getTime() >= 7 * 86_400_000 || dow(n) <= dow(d);
}
