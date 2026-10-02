/**
 * 일별 시세 분포 점검 — 공급처가 단위·스키마·값 채우기를 바꿔도 날짜와 행 수는 멀쩡해 신선도 감시를 통과한다.
 * 최신 거래일을 직전 거래일과 비교해 "값이 이상한 날"을 잡는다(순수 함수).
 */

export type DailyBar = { ticker: string; close: number | null; volume: number | null };

export type DistributionReport = {
  issues: string[];
  stats: { zeroVolumeShare: number; frozenShare: number; medianAbsReturn: number; medianVolumeRatio: number | null };
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MIN_ROWS = 50;

export function evaluateDailyDistribution(latest: DailyBar[], prev: DailyBar[]): DistributionReport {
  const issues: string[] = [];
  const prevByTicker = new Map(prev.map((b) => [b.ticker, b]));

  const zeroVolume = latest.filter((b) => !(Number(b.volume) > 0)).length;
  const zeroVolumeShare = latest.length ? zeroVolume / latest.length : 0;

  const returns: number[] = [];
  const volumeRatios: number[] = [];
  let frozen = 0;
  let compared = 0;
  for (const b of latest) {
    const p = prevByTicker.get(b.ticker);
    const c = Number(b.close);
    const pc = Number(p?.close);
    if (!p || !(c > 0) || !(pc > 0)) continue;
    compared += 1;
    returns.push(Math.abs(c / pc - 1));
    if (c === pc) frozen += 1;
    const v = Number(b.volume);
    const pv = Number(p.volume);
    if (v > 0 && pv > 0) volumeRatios.push(v / pv);
  }
  const frozenShare = compared ? frozen / compared : 0;
  const medianAbsReturn = median(returns) ?? 0;
  const medianVolumeRatio = median(volumeRatios);

  if (latest.length >= MIN_ROWS && compared >= MIN_ROWS) {
    if (zeroVolumeShare > 0.2) issues.push(`거래량 0인 종목이 ${(zeroVolumeShare * 100).toFixed(0)}%`);
    // 정상 시장에서 종가가 전일과 같은 종목은 대개 10% 안팎이다
    if (frozenShare > 0.5) issues.push(`전일과 종가가 같은 종목이 ${(frozenShare * 100).toFixed(0)}% (시세 동결 의심)`);
    // 종목 중앙값이 하루에 10% 넘게 움직일 수는 없다 — 단위·배율 변경 의심
    if (medianAbsReturn > 0.1) issues.push(`종가 변동 중앙값 ${(medianAbsReturn * 100).toFixed(1)}% (단위·배율 변경 의심)`);
    if (medianVolumeRatio !== null && (medianVolumeRatio > 5 || medianVolumeRatio < 0.2)) {
      issues.push(`거래량 중앙값이 전일의 ${medianVolumeRatio.toFixed(2)}배 (단위 변경 의심)`);
    }
  }
  return { issues, stats: { zeroVolumeShare, frozenShare, medianAbsReturn, medianVolumeRatio } };
}
