// src/lib/themeFlow.ts
// 오늘 시장 브리핑 — 테마 흐름(뜨는·식는 테마)과 보유 연결 테마의 근거 판정. 순수 함수 (테스트 tests/themeFlow.test.ts)
//
// 이 점수는 "지금 시장이 어디를 보고 있나"를 보여 주는 주목도이지 예측이 아니다.
// 급등 직후 따라 사기는 검증에서 불리했다(급등 5일 매수 회피 규칙). 화면도 '쫓지 말고 알아두기'로 쓴다.
// 기준값(EVIDENCE_RULES·HOT_WEIGHTS)은 결과를 보기 전에 정했다(2026-10-19). 바꾸면 날짜와 이유를 남긴다.

import type { ThemeNewsItem } from "./marketThemes";

export type ThemeDay = {
  tradeDate: string;
  themeNo: number;
  changeRate: number;
  riseCount: number;
  totalCount: number;
  tradingValue: number;
  newsCount: number;
  news: ThemeNewsItem[];
};

export type ThemeMeta = {
  themeNo: number;
  name: string;
  memberCodes: string[];
  firstSeen: string;
};

/** 최근 5거래일 기준. 거래대금·뉴스는 그 앞 20거래일 평균과 비교한다 */
export const RECENT_DAYS = 5;
export const BASELINE_DAYS = 20;
/** 비교 기준(평소)을 믿으려면 앞쪽에 이만큼은 쌓여 있어야 한다 */
export const MIN_BASELINE_DAYS = 5;
/** 종목 1~2개짜리 테마는 한 종목이 테마 전체를 흔들어 순위에서 뺀다 */
export const MIN_THEME_MEMBERS = 3;

export const HOT_WEIGHTS = { ret: 0.4, breadth: 0.2, value: 0.2, news: 0.2 } as const;

export type ThemeStats = {
  themeNo: number;
  /** 최근 5거래일(쌓인 만큼) 복리 등락 % */
  ret5: number;
  /** 최근 5거래일 평균 상승 종목 비율 0~1 */
  breadth5: number | null;
  /** 최근 5일 평균 거래대금 / 앞 20일 평균. 기준이 모자라면 null */
  valueRatio: number | null;
  /** 최근 5일 뉴스 언급 합 */
  news5: number;
  /** 최근 5일 언급 / 평소 5일치(앞 20일 평균 × 5). 기준이 모자라면 null */
  newsRatio: number | null;
  totalCount: number;
  daysUsed: number;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 한 테마의 거래일 오름차순 기록에서 마지막 날 기준 통계 */
export function themeStats(daysAsc: ThemeDay[]): ThemeStats | null {
  if (!daysAsc.length) return null;
  const recent = daysAsc.slice(-RECENT_DAYS);
  const base = daysAsc.slice(-(RECENT_DAYS + BASELINE_DAYS), -RECENT_DAYS);
  const last = daysAsc[daysAsc.length - 1];
  const ret5 = (recent.reduce((acc, d) => acc * (1 + d.changeRate / 100), 1) - 1) * 100;
  const br = recent.filter((d) => d.totalCount > 0).map((d) => d.riseCount / d.totalCount);
  const baseValue = mean(base.map((d) => d.tradingValue));
  const news5 = recent.reduce((a, d) => a + d.newsCount, 0);
  const baseNews = mean(base.map((d) => d.newsCount));
  const enoughBase = base.length >= MIN_BASELINE_DAYS;
  return {
    themeNo: last.themeNo,
    ret5,
    breadth5: br.length ? mean(br) : null,
    valueRatio: enoughBase && baseValue > 0 ? mean(recent.map((d) => d.tradingValue)) / baseValue : null,
    news5,
    // +1은 평소 0건인 테마가 1건만 나와도 무한대로 튀지 않게
    newsRatio: enoughBase ? (news5 / recent.length + 1) / (baseNews + 1) : null,
    totalCount: last.totalCount,
    daysUsed: recent.length,
  };
}

/** 값이 클수록 1에 가까운 백분위(동률은 평균 순위). null은 빼고 매긴다 */
function percentile(values: Array<number | null>): Array<number | null> {
  const idx = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  idx.sort((a, b) => a.v - b.v);
  const out: Array<number | null> = values.map(() => null);
  const n = idx.length;
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && idx[j + 1].v === idx[k].v) j += 1;
    const p = n === 1 ? 1 : (k + j) / 2 / (n - 1);
    for (let t = k; t <= j; t += 1) out[idx[t].i] = p;
    k = j + 1;
  }
  return out;
}

export type RankedTheme = ThemeStats & { score: number; rank: number };

/** 테마 통계 목록 → 주목도 점수 순위 (구성 종목이 적은 테마 제외) */
export function rankThemes(stats: ThemeStats[]): RankedTheme[] {
  const eligible = stats.filter((s) => s.totalCount >= MIN_THEME_MEMBERS);
  const pr = percentile(eligible.map((s) => s.ret5));
  const pb = percentile(eligible.map((s) => s.breadth5));
  const pv = percentile(eligible.map((s) => s.valueRatio));
  const pn = percentile(eligible.map((s) => s.newsRatio));
  const scored = eligible.map((s, i) => {
    const parts: Array<[number | null, number]> = [
      [pr[i], HOT_WEIGHTS.ret],
      [pb[i], HOT_WEIGHTS.breadth],
      [pv[i], HOT_WEIGHTS.value],
      [pn[i], HOT_WEIGHTS.news],
    ];
    const used = parts.filter((p): p is [number, number] => p[0] != null);
    const w = used.reduce((a, p) => a + p[1], 0);
    return { ...s, score: w > 0 ? used.reduce((a, p) => a + p[0] * p[1], 0) / w : 0 };
  });
  scored.sort((a, b) => b.score - a.score || b.ret5 - a.ret5 || a.themeNo - b.themeNo);
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

/** 거래일 오름차순 날짜 목록과 테마별 기록 → 날짜 d까지의 순위 */
export function rankOnDate(byTheme: Map<number, ThemeDay[]>, date: string): RankedTheme[] {
  const stats: ThemeStats[] = [];
  for (const days of byTheme.values()) {
    const upto = days.filter((d) => d.tradeDate <= date);
    // 그날 기록이 없는 테마(그날 사라진 테마)는 그날 순위에 넣지 않는다
    if (!upto.length || upto[upto.length - 1].tradeDate !== date) continue;
    const s = themeStats(upto);
    if (s) stats.push(s);
  }
  return rankThemes(stats);
}

export type ThemeFlowItem = RankedTheme & {
  name: string;
  isNew: boolean;
  news: ThemeNewsItem[];
  /** 식는 테마: 최근 10거래일 안에서 가장 높았던 순위 */
  peakRank?: number;
};

export type ThemeFlow = {
  asOf: string | null;
  /** 쌓인 거래일 수 (5일 등락·평소 대비는 이만큼만 반영) */
  daysCollected: number;
  hot: ThemeFlowItem[];
  cooling: ThemeFlowItem[];
};

export const HOT_TOP = 5;
/** 식는 테마: 최근 10거래일 중 한 번이라도 10위 안 → 지금 20위 밖이고 5일 등락이 마이너스 */
export const COOLING_LOOKBACK = 10;
export const COOLING_PAST_TOP = 10;
export const COOLING_NOW_BELOW = 20;

export function buildThemeFlow(days: ThemeDay[], meta: ThemeMeta[], opts?: { top?: number }): ThemeFlow {
  const top = opts?.top ?? HOT_TOP;
  const byTheme = new Map<number, ThemeDay[]>();
  for (const d of [...days].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))) {
    const list = byTheme.get(d.themeNo) ?? [];
    list.push(d);
    byTheme.set(d.themeNo, list);
  }
  const dates = [...new Set(days.map((d) => d.tradeDate))].sort();
  const asOf = dates[dates.length - 1] ?? null;
  if (!asOf) return { asOf: null, daysCollected: 0, hot: [], cooling: [] };

  const metaByNo = new Map(meta.map((m) => [m.themeNo, m]));
  // 처음 수집한 날에 이미 있던 테마는 '새로 등장'이 아니다
  const firstCollected = meta.reduce((min, m) => (m.firstSeen < min ? m.firstSeen : min), asOf);
  const decorate = (r: RankedTheme, extra?: Partial<ThemeFlowItem>): ThemeFlowItem => {
    const m = metaByNo.get(r.themeNo);
    const list = byTheme.get(r.themeNo) ?? [];
    return {
      ...r,
      name: m?.name ?? `테마 ${r.themeNo}`,
      isNew: !!m && m.firstSeen > firstCollected,
      news: list[list.length - 1]?.news ?? [],
      ...extra,
    };
  };

  const today = rankOnDate(byTheme, asOf);
  const hot = today.slice(0, top).map((r) => decorate(r));

  const pastDates = dates.slice(-(COOLING_LOOKBACK + 1), -1);
  const peak = new Map<number, number>();
  for (const d of pastDates) {
    for (const r of rankOnDate(byTheme, d)) {
      if (r.rank <= COOLING_PAST_TOP) peak.set(r.themeNo, Math.min(peak.get(r.themeNo) ?? Infinity, r.rank));
    }
  }
  const cooling = today
    .filter((r) => peak.has(r.themeNo) && r.rank > COOLING_NOW_BELOW && r.ret5 < 0)
    .sort((a, b) => peak.get(a.themeNo)! - peak.get(b.themeNo)! || a.ret5 - b.ret5)
    .slice(0, top)
    .map((r) => decorate(r, { peakRank: peak.get(r.themeNo) }));

  return { asOf, daysCollected: dates.length, hot, cooling };
}

// ─── 보유 ↔ 테마 연결 ────────────────────────────────────────────────────────

export type HoldingWeight = { code: string; name: string; weight: number };

export type LinkedTheme = {
  themeNo: number;
  name: string;
  /** 보유(ETF면 구성) 중 이 테마 종목 비중 0~1 */
  overlap: number;
  matched: HoldingWeight[];
};

/** ETF 상위 구성의 이 비중 이상이 테마에 들어 있어야 연결로 본다 */
export const MIN_LINK_OVERLAP = 0.15;
export const MAX_LINKS_PER_HOLDING = 2;

/** 개별주면 [{code, weight:1}], ETF면 상위 10 구성(비중 0~1) */
export function linkHoldingToThemes(weights: HoldingWeight[], meta: ThemeMeta[], opts?: { minOverlap?: number; max?: number }): LinkedTheme[] {
  const minOverlap = opts?.minOverlap ?? MIN_LINK_OVERLAP;
  const max = opts?.max ?? MAX_LINKS_PER_HOLDING;
  const out: LinkedTheme[] = [];
  for (const m of meta) {
    const members = new Set(m.memberCodes);
    const matched = weights.filter((w) => members.has(w.code));
    const overlap = matched.reduce((a, w) => a + w.weight, 0);
    if (overlap >= minOverlap) out.push({ themeNo: m.themeNo, name: m.name, overlap, matched });
  }
  // 겹침이 같으면 종목 수가 적은(좁은) 테마가 보유 성격을 더 잘 말한다
  const size = new Map(meta.map((x) => [x.themeNo, x.memberCodes.length]));
  out.sort((a, b) => b.overlap - a.overlap || (size.get(a.themeNo) ?? 0) - (size.get(b.themeNo) ?? 0) || a.themeNo - b.themeNo);
  return out.slice(0, max);
}

// ─── 근거 판정 ───────────────────────────────────────────────────────────────

export type EvidenceLevel = "strong" | "normal" | "weak" | "unknown";
export type EvidenceKey = "price" | "breadth" | "news" | "value";

export type EvidenceSignal = { key: EvidenceKey; label: string; level: EvidenceLevel; detail: string };

export type EvidenceOverall = "strong" | "weak" | "mixed" | "pending";

/** 사전에 정한 기준 (2026-10-19). 화면 '판정 기준' 설명도 이 값을 그대로 보여 준다 */
export const EVIDENCE_RULES = {
  /** 가격: 200일선 위 + 3개월 등락 ≥ 0 → 강함, 200일선 아래 + 3개월 < 0 → 약함 */
  priceLookbackBars: 63,
  maBars: 200,
  /** 종목 폭: 최근 5일 평균 상승 종목 비율 */
  breadthStrong: 0.6,
  breadthWeak: 0.4,
  /** 언론 관심: 최근 5일 언급 / 평소 */
  newsStrong: 1.5,
  newsWeak: 0.5,
  /** 거래 관심: 최근 5일 거래대금 / 평소 */
  valueStrong: 1.3,
  valueWeak: 0.7,
} as const;

export type PriceTrend = { ret3m: number | null; aboveMa200: boolean | null; bars: number };

/** 종가 오름차순 → 3개월 등락·200일선 위 여부 (모자라면 null) */
export function priceTrend(closesAsc: number[]): PriceTrend {
  const n = closesAsc.length;
  const last = closesAsc[n - 1];
  const back = closesAsc[n - 1 - EVIDENCE_RULES.priceLookbackBars];
  const ret3m = n > EVIDENCE_RULES.priceLookbackBars && back > 0 ? (last / back - 1) * 100 : null;
  const aboveMa200 = n >= EVIDENCE_RULES.maBars ? last > mean(closesAsc.slice(-EVIDENCE_RULES.maBars)) : null;
  return { ret3m, aboveMa200, bars: n };
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

export function evaluateEvidence(input: { price: PriceTrend | null; theme: ThemeStats | null }): { signals: EvidenceSignal[]; overall: EvidenceOverall } {
  const R = EVIDENCE_RULES;
  const signals: EvidenceSignal[] = [];

  const p = input.price;
  if (!p || p.ret3m == null) {
    signals.push({ key: "price", label: "가격 흐름", level: "unknown", detail: "시세가 3개월치 안 됨" });
  } else {
    const ma = p.aboveMa200 == null ? "200일선 판단 불가" : p.aboveMa200 ? "200일선 위" : "200일선 아래";
    const level: EvidenceLevel =
      p.aboveMa200 === true && p.ret3m >= 0 ? "strong" : p.aboveMa200 === false && p.ret3m < 0 ? "weak" : "normal";
    signals.push({ key: "price", label: "가격 흐름", level, detail: `3달 ${pct(p.ret3m)} · ${ma}` });
  }

  const t = input.theme;
  if (!t || t.breadth5 == null) {
    signals.push({ key: "breadth", label: "종목 폭", level: "unknown", detail: "테마 기록 없음" });
  } else {
    const level: EvidenceLevel = t.breadth5 >= R.breadthStrong ? "strong" : t.breadth5 <= R.breadthWeak ? "weak" : "normal";
    signals.push({ key: "breadth", label: "종목 폭", level, detail: `최근 ${t.daysUsed}일 평균 상승 종목 ${Math.round(t.breadth5 * 100)}%` });
  }

  if (!t || t.newsRatio == null) {
    signals.push({ key: "news", label: "언론 관심", level: "unknown", detail: t ? `평소 기준 쌓는 중 (최근 ${t.daysUsed}일 ${t.news5}건)` : "테마 기록 없음" });
  } else {
    const level: EvidenceLevel = t.newsRatio >= R.newsStrong ? "strong" : t.newsRatio <= R.newsWeak ? "weak" : "normal";
    signals.push({ key: "news", label: "언론 관심", level, detail: `최근 5일 ${t.news5}건 · 평소의 ${t.newsRatio.toFixed(1)}배` });
  }

  if (!t || t.valueRatio == null) {
    signals.push({ key: "value", label: "거래 관심", level: "unknown", detail: t ? "평소 기준 쌓는 중" : "테마 기록 없음" });
  } else {
    const level: EvidenceLevel = t.valueRatio >= R.valueStrong ? "strong" : t.valueRatio <= R.valueWeak ? "weak" : "normal";
    signals.push({ key: "value", label: "거래 관심", level, detail: `거래대금 평소의 ${t.valueRatio.toFixed(1)}배` });
  }

  return { signals, overall: overallEvidence(signals) };
}

/**
 * 종합: 아는 신호가 2개 미만이면 판단 보류.
 * 가격 하나만으로 약함·강함이 되지 않게 — 같은 쪽 신호 2개 이상 + 그중 가격 아닌 신호 1개 이상 + 반대쪽 0개일 때만.
 */
export function overallEvidence(signals: EvidenceSignal[]): EvidenceOverall {
  const known = signals.filter((s) => s.level !== "unknown");
  if (known.length < 2) return "pending";
  const side = (lv: EvidenceLevel) => known.filter((s) => s.level === lv);
  const strong = side("strong");
  const weak = side("weak");
  const qualifies = (xs: EvidenceSignal[]) => xs.length >= 2 && xs.some((s) => s.key !== "price");
  if (qualifies(strong) && weak.length === 0) return "strong";
  if (qualifies(weak) && strong.length === 0) return "weak";
  return "mixed";
}
