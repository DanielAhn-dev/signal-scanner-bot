// src/lib/sectors.ts

import { getBizDaysAgo, toNumberSafe, clamp } from "./normalize";
import {
  fetchSectorPriceSeries,
  fetchSectorVolumeSeries,
  fetchTickerMetaInSector,
  fetchPrecomputedSectorScores,
} from "./source";

export interface SectorScore {
  id: string;
  name: string;
  rs1M: number;
  rs3M: number;
  rs6M: number;
  rs12M: number;
  roc21: number;
  sma20AboveRatio: number;
  tv5dChg: number;
  tv20dChg: number;
  extVolPenalty: number;
  flowF5: number;
  flowF20: number;
  flowI5: number;
  flowI20: number;
  score: number;
  grade: "A" | "B" | "C";
}

export interface SectorSeriesRow {
  date: string;
  close: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
}

// fetchSectorPriceSeries 가 반환하는 shape 를 명시적으로 정의
export interface SectorSeries {
  id: string;
  name: string;
  metrics: any;
  series: SectorSeriesRow[];
}

let tickerMetaCache: Map<string, { code: string; name: string }[]> | null =
  null;

async function getTickersInSector(
  sectorId: string
): Promise<{ code: string; name: string }[]> {
  if (!tickerMetaCache) {
    const allMetas = await fetchTickerMetaInSector();
    tickerMetaCache = new Map();
    for (const meta of allMetas) {
      const id = meta.sectorId;
      if (id) {
        if (!tickerMetaCache.has(id)) {
          tickerMetaCache.set(id, []);
        }
        tickerMetaCache.get(id)!.push({ code: meta.code, name: meta.name });
      }
    }
    // 캐시 생성 후, 어떤 ID들이 있는지 전체 키를 로그로 확인
    console.log("Ticker cache created. Available sector IDs:", [
      ...tickerMetaCache.keys(),
    ]);
  }
  // 요청된 섹터 ID를 로그로 확인
  console.log("Requesting tickers for sectorId:", sectorId);
  const tickers = tickerMetaCache.get(sectorId) || [];

  if (tickers.length === 0) {
    console.warn(
      `No tickers found for sectorId '${sectorId}'. Check for potential ID mismatch.`
    );
  }

  return tickers;
}

export async function scoreSectors(today: string): Promise<SectorScore[]> {
  const [sectors, volMap] = await Promise.all([
    fetchSectorPriceSeries(today), // SectorSeries[]
    fetchSectorVolumeSeries(today), // { [sectorId]: { date, value }[] }
  ]);

  // sector_daily 데이터가 최근 5영업일 이내 데이터를 포함하는지 확인
  const recentCutoff = getBizDaysAgo(today, 5);
  const hasRecentData = (sectors as SectorSeries[]).some((s) => {
    const last = s.series?.[s.series.length - 1];
    return last && last.date >= recentCutoff;
  });

  if (!hasRecentData) {
    console.warn(
      `[scoreSectors] sector_daily stale (cutoff: ${recentCutoff}). Using pre-computed scores from sectors table.`
    );
    return scoreSectorsFromPrecomputed();
  }

  const out: (SectorScore & { rawScore: number })[] = [];
  const isNum = (x: unknown): x is number => Number.isFinite(x as number);

  for (const s of sectors as SectorSeries[]) {
    const { id, name, series: px, metrics } = s;
    const vol = volMap[id] || [];

    // 기준일들 (영업일 기준)
    const d1M = getBizDaysAgo(today, 21);
    const d3M = getBizDaysAgo(today, 63);
    const d6M = getBizDaysAgo(today, 126);
    const d12M = getBizDaysAgo(today, 252);

    const pT = toNumberSafe(px, today);
    const p1 = toNumberSafe(px, d1M);
    const p3 = toNumberSafe(px, d3M);
    const p6 = toNumberSafe(px, d6M);
    const p12 = toNumberSafe(px, d12M);

    const rs1M = isNum(pT) && isNum(p1) ? pT / p1 - 1 : NaN;
    const rs3M = isNum(pT) && isNum(p3) ? pT / p3 - 1 : NaN;
    const rs6M = isNum(pT) && isNum(p6) ? pT / p6 - 1 : NaN;
    const rs12M = isNum(pT) && isNum(p12) ? pT / p12 - 1 : NaN;

    const p21 = toNumberSafe(px, getBizDaysAgo(today, 21));
    const roc21 = isNum(pT) && isNum(p21) ? (pT - p21) / p21 : NaN;

    // SMA 및 Volume 지표
    const last20 = px.slice(-20);
    const above = last20.filter(
      (r: any) => r.close && r.sma20 && r.close >= r.sma20
    ).length;
    const sma20AboveRatio = last20.length ? above / last20.length : 0;

    const tv5d =
      vol.slice(-5).reduce((a: number, b: any) => a + (b.value || 0), 0) /
      Math.max(1, vol.slice(-5).length);
    const tv20d =
      vol.slice(-20).reduce((a: number, b: any) => a + (b.value || 0), 0) /
      Math.max(1, vol.slice(-20).length);
    const tv60d =
      vol.slice(-60).reduce((a: number, b: any) => a + (b.value || 0), 0) /
      Math.max(1, vol.slice(-60).length);

    const tv5dChg = tv60d ? tv5d / tv60d - 1 : 0;
    const tv20dChg = tv60d ? tv20d / tv60d - 1 : 0;

    // 변동성 패널티
    const rets = px
      .slice(-60)
      .map((r: any, i: number, arr: any[]) =>
        i ? Math.log((r.close || 1) / (arr[i - 1].close || 1)) : 0
      )
      .slice(1);
    const volStd = Math.sqrt(
      rets.reduce((a: number, b: number) => a + b * b, 0) /
        Math.max(1, rets.length)
    );
    const extVolPenalty = clamp((volStd - 0.02) / 0.05, 0, 1);

    // 수급: 파이썬 배치가 sectors.metrics 에 넣어둔 값 사용
    const m = metrics || {};
    const flowF5 = m.flow_foreign_5d || 0;
    const flowI5 = m.flow_inst_5d || 0;
    const flowF20 = m.flow_foreign_20d || 0; // 향후 확장 대비
    const flowI20 = m.flow_inst_20d || 0;

    // 점수 산출
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    const sig = (x: number) => (Number.isFinite(x) ? sigmoid(x) : 0.5);

    const sRS =
      0.4 *
      (0.25 * sig(rs1M * 5) +
        0.25 * sig(rs3M * 2) +
        0.25 * sig(rs6M) +
        0.25 * sig(rs12M * 0.5));

    const sTV = 0.15 * (0.5 * sig(tv5dChg * 2) + 0.5 * sig(tv20dChg * 2));
    const sSMA = 0.1 * sma20AboveRatio;
    const sROC = 0.1 * sig(roc21 * 10);
    const sVolP = 0.05 * (1 - extVolPenalty);

    // 수급 점수: 5일 누적 순매수(외+기)를 1억 단위로 스케일링
    const flowSum5 = (flowF5 + flowI5) / 1e8;
    const sFlow = 0.2 * sig(flowSum5); // 전체 점수의 20%

    const rawScore = (sRS + sTV + sSMA + sROC + sVolP + sFlow) * 100;

    out.push({
      id,
      name,
      rs1M,
      rs3M,
      rs6M,
      rs12M,
      roc21,
      sma20AboveRatio,
      tv5dChg,
      tv20dChg,
      extVolPenalty,
      flowF5,
      flowI5,
      flowF20,
      flowI20,
      score: 0,
      grade: "C",
      rawScore,
    });
  }

  if (out.length > 0) {
    const rawScores = out.map((o) => o.rawScore);
    const minScore = Math.min(...rawScores);
    const maxScore = Math.max(...rawScores);
    const scoreRange = Math.max(1, maxScore - minScore);

    out.forEach((o) => {
      o.score = Math.round(((o.rawScore - minScore) / scoreRange) * 50 + 40);
      o.grade = o.score >= 80 ? "A" : o.score >= 65 ? "B" : "C";
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out as SectorScore[];
}

/**
 * sector_daily가 stale할 때 sectors 테이블의 사전계산 점수를 사용하는 fallback.
 * Python batch 스크립트가 sectors.score, change_rate, metrics를 업데이트함.
 */
async function scoreSectorsFromPrecomputed(): Promise<SectorScore[]> {
  const rows = await fetchPrecomputedSectorScores();
  if (!rows.length) return [];

  return rows
    .filter((r) => r.score > 0)
    .map((r) => {
      const m = r.metrics || {};
      return {
        id: r.id,
        name: r.name,
        rs1M: r.change_rate / 100, // 등락률% → 비율
        rs3M: NaN,
        rs6M: NaN,
        rs12M: NaN,
        roc21: r.change_rate / 100,
        sma20AboveRatio: 0,
        tv5dChg: 0,
        tv20dChg: 0,
        extVolPenalty: 0,
        flowF5: Number(m.flow_foreign_5d ?? 0),
        flowF20: Number(m.flow_foreign_20d ?? 0),
        flowI5: Number(m.flow_inst_5d ?? 0),
        flowI20: Number(m.flow_inst_20d ?? 0),
        score: r.score,
        grade: (r.score >= 80 ? "A" : r.score >= 65 ? "B" : "C") as
          | "A"
          | "B"
          | "C",
      };
    })
    .sort((a, b) => b.score - a.score);
}

// /nextsector 명령용: 수급 유입 & 순환매 후보 섹터
// 순환매 = "아직 주가 안 올랐지만 수급이 들어오는" 패턴
// 수급 데이터 미수집 시에도 모멘텀/점수 기반으로 후보 추출
export function getNextSectorCandidates(
  sectorScores: SectorScore[],
  minFlow: number
): SectorScore[] {
  // 수급 or 모멘텀 기반 후보 선별
  const candidates = sectorScores.filter(
    (s) => s.flowF5 + s.flowI5 > 0 || (Number.isFinite(s.rs1M) && s.rs1M < 0.05)
  );

  // 순환매 점수 계산
  const scored = candidates.map((s) => {
    const flowTotal = (s.flowF5 + s.flowI5) / 1e8;
    const flowScore = Math.min(50, Math.max(0, flowTotal * 0.5));

    // RS가 낮을수록 보너스 (아직 덜 오른 섹터 = 순환매 대상)
    const rs = Number.isFinite(s.rs1M) ? s.rs1M : 0;
    const rotationBonus = rs < 0.03 ? 20 : rs < 0.08 ? 10 : 0;

    // 현재 종합 점수가 중간 이하면 추가 보너스
    const undervaluedBonus = s.score < 60 ? 15 : s.score < 70 ? 5 : 0;

    const nextScore = flowScore + rotationBonus + undervaluedBonus;
    return { ...s, nextScore, flowTotal };
  });

  // 최소 수급 or 순환매 점수 기준 필터 + 정렬
  return scored
    .filter((s) => s.flowF5 + s.flowI5 > minFlow || s.nextScore > 20)
    .sort((a, b) => b.nextScore - a.nextScore);
}

// /sector 명령용: 통합 점수 상위 섹터
export function getTopSectors(
  sectorScores: SectorScore[],
  minScore: number = 50
): SectorScore[] {
  return sectorScores
    .filter((s) => s.score > minScore)
    .sort((a, b) => b.score - a.score);
}
