// src/lib/sectors.ts

import { getBizDaysAgo, toNumberSafe, clamp } from "./normalize";
import {
  fetchSectorPriceSeries,
  fetchSectorVolumeSeries,
  fetchInvestorNetByTicker,
  fetchTickerMetaInSector,
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
      // id가 undefined가 아닐 경우에만 맵에 추가
      if (id) {
        if (!tickerMetaCache.has(id)) {
          tickerMetaCache.set(id, []);
        }
        tickerMetaCache.get(id)!.push({ code: meta.code, name: meta.name });
      }
    }
  }
  return tickerMetaCache.get(sectorId) || [];
}

export async function scoreSectors(today: string): Promise<SectorScore[]> {
  const [sectors, volMap, inv5, inv20] = await Promise.all([
    fetchSectorPriceSeries(today),
    fetchSectorVolumeSeries(today),
    fetchInvestorNetByTicker(getBizDaysAgo(today, 5), today),
    fetchInvestorNetByTicker(getBizDaysAgo(today, 20), today),
  ]);

  const inv5Map = new Map(inv5.map((i: any) => [i.ticker, i]));
  const inv20Map = new Map(inv20.map((i: any) => [i.ticker, i]));
  const out: (SectorScore & { rawScore: number })[] = [];

  const isNum = (x: unknown): x is number => Number.isFinite(x as number);

  for (const s of sectors) {
    const { id, name, series: px } = s;
    const vol = volMap[id] || [];

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

    // 이하 SMA, TV, 변동성 등은 그대로 사용
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

    const tickers = await getTickersInSector(id);
    let flowF5 = 0,
      flowI5 = 0,
      flowF20 = 0,
      flowI20 = 0;

    for (const t of tickers) {
      const i5 = inv5Map.get(t.code);
      if (i5) {
        flowF5 += i5.foreign || 0;
        flowI5 += i5.institution || 0;
      }
      const i20 = inv20Map.get(t.code);
      if (i20) {
        flowF20 += i20.foreign || 0;
        flowI20 += i20.institution || 0;
      }
    }

    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    const sig = (x: number) => (Number.isFinite(x) ? sigmoid(x) : 0.5); // 데이터 없으면 중립점

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

    const rawScore = ((sRS + sTV + sSMA + sROC + sVolP) * 100) / 0.8;

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

// /nextsector 명령용: 수급 상위 섹터
export function getNextSectorCandidates(
  sectorScores: SectorScore[],
  minFlow: number
): SectorScore[] {
  return sectorScores
    .filter((s) => s.flowF5 > minFlow || s.flowI5 > minFlow)
    .sort((a, b) => b.flowF5 + b.flowI5 - (a.flowF5 + a.flowI5));
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
