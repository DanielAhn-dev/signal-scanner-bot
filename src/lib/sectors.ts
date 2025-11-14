// src/lib/sectors.ts
import { getBizDaysAgo, toNumberSafe, clamp } from "./normalize";
import {
  fetchSectorPriceSeries,
  fetchSectorVolumeSeries,
  fetchInvestorNetByTicker,
  fetchTickerMetaInSector,
} from "./source"; // PyKRX/스크래핑 어댑터

// 반환 타입
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
  flowI20: number; // 외인/기관 순매수(섹터 집계, 표준화 전 원시)
  score: number;
  grade: "A" | "B" | "C";
}

export async function scoreSectors(today: string): Promise<SectorScore[]> {
  // 1) 섹터 마스터 조회
  const sectors = await fetchSectorPriceSeries(today); // 섹터별 시계열(지수/종가)
  const volMap = await fetchSectorVolumeSeries(today); // 섹터별 거래대금 시계열
  // 2) 기준일 계산
  const d1M = getBizDaysAgo(today, 21);
  const d3M = getBizDaysAgo(today, 63);
  const d6M = getBizDaysAgo(today, 126);
  const d12M = getBizDaysAgo(today, 252);

  // 3) 투자자 수급(종목→섹터 합산)
  // 최근 5/20영업일 종목별 순매수 대금을 섹터로 그룹바이
  const inv5 = await fetchInvestorNetByTicker(getBizDaysAgo(today, 5), today);
  const inv20 = await fetchInvestorNetByTicker(getBizDaysAgo(today, 20), today);

  const out: SectorScore[] = [];
  for (const s of sectors) {
    const name = s.name;
    const id = s.id;
    const px = s.series; // {date, close, sma20, sma50, sma200}
    const vol = volMap[id] || [];

    // 수익률/RS 계산
    const pT = toNumberSafe(px, today);
    const p1 = toNumberSafe(px, d1M);
    const p3 = toNumberSafe(px, d3M);
    const p6 = toNumberSafe(px, d6M);
    const p12 = toNumberSafe(px, d12M);
    const rs1M = pT && p1 ? pT / p1 - 1 : 0;
    const rs3M = pT && p3 ? pT / p3 - 1 : 0;
    const rs6M = pT && p6 ? pT / p6 - 1 : 0;
    const rs12M = pT && p12 ? pT / p12 - 1 : 0;

    // ROC21
    const p21 = toNumberSafe(px, getBizDaysAgo(today, 21));
    const roc21 = pT && p21 ? (pT - p21) / p21 : 0;

    // 20SMA 상회 비중
    const last20 = px.slice(-20);
    const above = last20.filter(
      (r) => r.close && r.sma20 && r.close >= r.sma20
    ).length;
    const sma20AboveRatio = last20.length ? above / last20.length : 0;

    // 거래대금 변화(5/20)
    const tv5d =
      vol.slice(-5).reduce((a, b) => a + (b.value || 0), 0) /
      Math.max(1, vol.slice(-5).length);
    const tv20d =
      vol.slice(-20).reduce((a, b) => a + (b.value || 0), 0) /
      Math.max(1, vol.slice(-20).length);
    const tv60d =
      vol.slice(-60).reduce((a, b) => a + (b.value || 0), 0) /
      Math.max(1, vol.slice(-60).length);
    const tv5dChg = tv60d ? tv5d / tv60d - 1 : 0;
    const tv20dChg = tv60d ? tv20d / tv60d - 1 : 0;

    // 변동성 패널티(섹터 평균 ATR 대용으로 최근 60일 로그수익률 표준편차 사용)
    const rets = px
      .slice(-60)
      .map((r, i, arr) =>
        i ? Math.log((r.close || 1) / (arr[i - 1].close || 1)) : 0
      )
      .slice(1);
    const volStd = Math.sqrt(
      rets.reduce((a, b) => a + b * b, 0) / Math.max(1, rets.length)
    );
    const extVolPenalty = clamp((volStd - 0.02) / 0.05, 0, 1); // 표준편차 2~7% 구간을 0~1로 매핑

    // 섹터 수급 합산
    const tickers = await fetchTickerMetaInSector(id);
    const tickSet = new Set(tickers.map((t) => t.code));
    const sum = (arr: any[], key: string) =>
      arr
        .filter((x) => tickSet.has(x.ticker))
        .reduce((a, b) => a + (b[key] || 0), 0);
    const flowF5 = sum(inv5, "foreign");
    const flowI5 = sum(inv5, "institution");
    const flowF20 = sum(inv20, "foreign");
    const flowI20 = sum(inv20, "institution");

    // 점수화(가중 예시)
    const z = (x: number) => clamp((x + 1) / 2, 0, 1); // -100%~+100%를 0~1로 압축하는 간단 정규화
    const sRS =
      0.4 *
      (0.25 * z(rs1M) + 0.25 * z(rs3M) + 0.25 * z(rs6M) + 0.25 * z(rs12M));
    const sTV = 0.15 * (0.5 * z(tv5dChg) + 0.5 * z(tv20dChg));
    const sSMA = 0.1 * sma20AboveRatio;
    const sROC = 0.1 * z(roc21);
    const sFlow =
      0.2 *
      (0.25 * z(flowF5 / 1e9) +
        0.25 * z(flowI5 / 1e9) +
        0.25 * z(flowF20 / 1e9) +
        0.25 * z(flowI20 / 1e9));
    const sVolP = 0.05 * (1 - extVolPenalty);

    let score = (sRS + sTV + sSMA + sROC + sFlow + sVolP) * 100;
    score = Math.round(score);

    const grade = score >= 70 ? "A" : score >= 55 ? "B" : "C";
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
      score,
      grade,
    });
  }

  // 페일세이프: 항상 최소 10개 노출
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(10, out.length));
}
