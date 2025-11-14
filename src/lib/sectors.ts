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
      // ✅ id가 undefined가 아닐 경우에만 맵에 추가
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

  const inv5Map = new Map(inv5.map((i) => [i.ticker, i]));
  const inv20Map = new Map(inv20.map((i) => [i.ticker, i]));
  const out: (SectorScore & { rawScore: number })[] = [];

  for (const s of sectors) {
    const { id, name, series: px } = s;
    const vol = volMap[id] || [];

    const d1M = getBizDaysAgo(today, 21),
      d3M = getBizDaysAgo(today, 63),
      d6M = getBizDaysAgo(today, 126),
      d12M = getBizDaysAgo(today, 252);
    const pT = toNumberSafe(px, today),
      p1 = toNumberSafe(px, d1M),
      p3 = toNumberSafe(px, d3M),
      p6 = toNumberSafe(px, d6M),
      p12 = toNumberSafe(px, d12M);
    const rs1M = pT && p1 ? pT / p1 - 1 : 0,
      rs3M = pT && p3 ? pT / p3 - 1 : 0,
      rs6M = pT && p6 ? pT / p6 - 1 : 0,
      rs12M = pT && p12 ? pT / p12 - 1 : 0;
    const p21 = toNumberSafe(px, getBizDaysAgo(today, 21));
    const roc21 = pT && p21 ? (pT - p21) / p21 : 0;
    const last20 = px.slice(-20),
      above = last20.filter(
        (r) => r.close && r.sma20 && r.close >= r.sma20
      ).length;
    const sma20AboveRatio = last20.length ? above / last20.length : 0;
    const tv5d =
      vol.slice(-5).reduce((a, b) => a + (b.value || 0), 0) /
      Math.max(1, vol.slice(-5).length);
    const tv20d =
      vol.slice(-20).reduce((a, b) => a + (b.value || 0), 0) /
      Math.max(1, vol.slice(-20).length);
    const tv60d =
      vol.slice(-60).reduce((a, b) => a + (b.value || 0), 0) /
      Math.max(1, vol.slice(-60).length);
    const tv5dChg = tv60d ? tv5d / tv60d - 1 : 0,
      tv20dChg = tv60d ? tv20d / tv60d - 1 : 0;
    const rets = px
      .slice(-60)
      .map((r, i, arr) =>
        i ? Math.log((r.close || 1) / (arr[i - 1].close || 1)) : 0
      )
      .slice(1);
    const volStd = Math.sqrt(
      rets.reduce((a, b) => a + b * b, 0) / Math.max(1, rets.length)
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
    const sRS =
      0.4 *
      (0.25 * sigmoid(rs1M * 5) +
        0.25 * sigmoid(rs3M * 2) +
        0.25 * sigmoid(rs6M) +
        0.25 * sigmoid(rs12M * 0.5));
    const sTV =
      0.15 * (0.5 * sigmoid(tv5dChg * 2) + 0.5 * sigmoid(tv20dChg * 2));
    const sSMA = 0.1 * sma20AboveRatio;
    const sROC = 0.1 * sigmoid(roc21 * 10);
    const sFlow =
      0.2 *
      (0.25 * sigmoid(flowF5 / 1e11) +
        0.25 * sigmoid(flowI5 / 1e11) +
        0.25 * sigmoid(flowF20 / 1e11) +
        0.25 * sigmoid(flowI20 / 1e11));
    const sVolP = 0.05 * (1 - extVolPenalty);
    const rawScore = (sRS + sTV + sSMA + sROC + sFlow + sVolP) * 100;

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
