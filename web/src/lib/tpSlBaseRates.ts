// 자동 생성: 2026-09-28 점검 스크립트. 네이버 수정주가 일봉(코어+확장 214종목, 2016~2026, 5거래일 간격 진입)에서
// 종가 진입 후 5거래일 안에 목표가(+target%)와 손절가(-stop%) 중 어디에 먼저 닿았는지 실측한 비율.
// 같은 날 둘 다 닿으면 손절로 본다(보수적). none=둘 다 안 닿고 5일째 종가로 끝난 비율, noneRet=그때 평균 수익(%).
// 현재 상장 종목만 대상이라 생존편향으로 실제보다 약간 좋게 나올 수 있다.

export type TpSlBaseRate = { target: number; stop: number; win: number; loss: number; none: number; noneRet: number }

export const TP_SL_HORIZON_DAYS = 5

export const TP_SL_BASE_RATES: TpSlBaseRate[] = [
  { target: 2, stop: 1, win: 30.1, loss: 68.9, none: 1.0, noneRet: 0.36 },
  { target: 2, stop: 2, win: 44.6, loss: 52.2, none: 3.2, noneRet: -0.05 },
  { target: 2, stop: 2.5, win: 49.7, loss: 45.5, none: 4.8, noneRet: -0.28 },
  { target: 2, stop: 3, win: 53.6, loss: 39.8, none: 6.7, noneRet: -0.52 },
  { target: 2, stop: 4, win: 59.0, loss: 30.5, none: 10.6, noneRet: -0.97 },
  { target: 2, stop: 5, win: 62.1, loss: 23.4, none: 14.4, noneRet: -1.38 },
  { target: 2, stop: 7, win: 65.3, loss: 14.0, none: 20.7, noneRet: -2.08 },
  { target: 2, stop: 10, win: 66.9, loss: 6.8, none: 26.4, noneRet: -2.86 },
  { target: 3, stop: 1, win: 24.7, loss: 72.9, none: 2.4, noneRet: 0.8 },
  { target: 3, stop: 2, win: 36.3, loss: 57.3, none: 6.4, noneRet: 0.34 },
  { target: 3, stop: 2.5, win: 40.3, loss: 50.6, none: 9.0, noneRet: 0.11 },
  { target: 3, stop: 3, win: 43.5, loss: 44.7, none: 11.9, noneRet: -0.12 },
  { target: 3, stop: 4, win: 48.0, loss: 34.7, none: 17.4, noneRet: -0.56 },
  { target: 3, stop: 5, win: 50.7, loss: 26.9, none: 22.4, noneRet: -0.95 },
  { target: 3, stop: 7, win: 53.4, loss: 16.1, none: 30.5, noneRet: -1.63 },
  { target: 3, stop: 10, win: 54.8, loss: 7.8, none: 37.4, noneRet: -2.35 },
  { target: 4, stop: 1, win: 20.3, loss: 75.6, none: 4.0, noneRet: 1.19 },
  { target: 4, stop: 2, win: 29.5, loss: 60.5, none: 10.0, noneRet: 0.72 },
  { target: 4, stop: 2.5, win: 32.8, loss: 53.7, none: 13.4, noneRet: 0.48 },
  { target: 4, stop: 3, win: 35.4, loss: 47.6, none: 17.0, noneRet: 0.25 },
  { target: 4, stop: 4, win: 39.1, loss: 37.2, none: 23.7, noneRet: -0.19 },
  { target: 4, stop: 5, win: 41.4, loss: 29.0, none: 29.6, noneRet: -0.57 },
  { target: 4, stop: 7, win: 43.7, loss: 17.5, none: 38.8, noneRet: -1.23 },
  { target: 4, stop: 10, win: 45.0, loss: 8.5, none: 46.5, noneRet: -1.93 },
  { target: 5, stop: 1, win: 16.8, loss: 77.3, none: 5.9, noneRet: 1.57 },
  { target: 5, stop: 2, win: 24.2, loss: 62.4, none: 13.4, noneRet: 1.08 },
  { target: 5, stop: 2.5, win: 26.9, loss: 55.6, none: 17.5, noneRet: 0.83 },
  { target: 5, stop: 3, win: 29.0, loss: 49.4, none: 21.6, noneRet: 0.59 },
  { target: 5, stop: 4, win: 32.0, loss: 38.8, none: 29.2, noneRet: 0.16 },
  { target: 5, stop: 5, win: 34.0, loss: 30.3, none: 35.7, noneRet: -0.23 },
  { target: 5, stop: 7, win: 36.0, loss: 18.3, none: 45.8, noneRet: -0.88 },
  { target: 5, stop: 10, win: 37.0, loss: 8.9, none: 54.0, noneRet: -1.56 },
  { target: 6, stop: 1, win: 13.9, loss: 78.4, none: 7.7, noneRet: 1.95 },
  { target: 6, stop: 2, win: 19.9, loss: 63.6, none: 16.5, noneRet: 1.43 },
  { target: 6, stop: 2.5, win: 22.0, loss: 56.8, none: 21.2, noneRet: 1.17 },
  { target: 6, stop: 3, win: 23.7, loss: 50.6, none: 25.7, noneRet: 0.93 },
  { target: 6, stop: 4, win: 26.2, loss: 39.8, none: 34.0, noneRet: 0.48 },
  { target: 6, stop: 5, win: 27.9, loss: 31.2, none: 41.0, noneRet: 0.1 },
  { target: 6, stop: 7, win: 29.5, loss: 18.9, none: 51.6, noneRet: -0.56 },
  { target: 6, stop: 10, win: 30.4, loss: 9.3, none: 60.3, noneRet: -1.23 },
  { target: 8, stop: 1, win: 9.7, loss: 79.5, none: 10.8, noneRet: 2.59 },
  { target: 8, stop: 2, win: 13.8, loss: 64.9, none: 21.4, noneRet: 2.01 },
  { target: 8, stop: 2.5, win: 15.2, loss: 58.1, none: 26.7, noneRet: 1.74 },
  { target: 8, stop: 3, win: 16.4, loss: 51.8, none: 31.8, noneRet: 1.48 },
  { target: 8, stop: 4, win: 18.2, loss: 40.9, none: 41.0, noneRet: 1.02 },
  { target: 8, stop: 5, win: 19.3, loss: 32.1, none: 48.6, noneRet: 0.63 },
  { target: 8, stop: 7, win: 20.5, loss: 19.5, none: 60.0, noneRet: -0.03 },
  { target: 8, stop: 10, win: 21.2, loss: 9.6, none: 69.2, noneRet: -0.7 },
  { target: 10, stop: 1, win: 6.9, loss: 80.1, none: 13.1, noneRet: 3.13 },
  { target: 10, stop: 2, win: 9.7, loss: 65.5, none: 24.8, noneRet: 2.5 },
  { target: 10, stop: 2.5, win: 10.7, loss: 58.7, none: 30.7, noneRet: 2.21 },
  { target: 10, stop: 3, win: 11.5, loss: 52.4, none: 36.1, noneRet: 1.94 },
  { target: 10, stop: 4, win: 12.8, loss: 41.4, none: 45.8, noneRet: 1.46 },
  { target: 10, stop: 5, win: 13.6, loss: 32.6, none: 53.8, noneRet: 1.05 },
  { target: 10, stop: 7, win: 14.5, loss: 19.8, none: 65.7, noneRet: 0.38 },
  { target: 10, stop: 10, win: 15.0, loss: 9.8, none: 75.2, noneRet: -0.29 },
  { target: 12, stop: 1, win: 5.1, loss: 80.3, none: 14.6, noneRet: 3.54 },
  { target: 12, stop: 2, win: 7.1, loss: 65.8, none: 27.1, noneRet: 2.87 },
  { target: 12, stop: 2.5, win: 7.8, loss: 59.0, none: 33.2, noneRet: 2.57 },
  { target: 12, stop: 3, win: 8.4, loss: 52.7, none: 38.9, noneRet: 2.29 },
  { target: 12, stop: 4, win: 9.3, loss: 41.7, none: 49.0, noneRet: 1.8 },
  { target: 12, stop: 5, win: 9.9, loss: 32.8, none: 57.2, noneRet: 1.38 },
  { target: 12, stop: 7, win: 10.6, loss: 20.0, none: 69.4, noneRet: 0.69 },
  { target: 12, stop: 10, win: 11.1, loss: 9.9, none: 79.1, noneRet: 0.02 },
  { target: 15, stop: 1, win: 3.4, loss: 80.5, none: 16.1, noneRet: 4.07 },
  { target: 15, stop: 2, win: 4.6, loss: 66.0, none: 29.3, noneRet: 3.34 },
  { target: 15, stop: 2.5, win: 5.1, loss: 59.2, none: 35.7, noneRet: 3.01 },
  { target: 15, stop: 3, win: 5.5, loss: 52.9, none: 41.6, noneRet: 2.71 },
  { target: 15, stop: 4, win: 6.1, loss: 41.9, none: 52.0, noneRet: 2.19 },
  { target: 15, stop: 5, win: 6.5, loss: 33.0, none: 60.5, noneRet: 1.76 },
  { target: 15, stop: 7, win: 7.0, loss: 20.1, none: 72.9, noneRet: 1.06 },
  { target: 15, stop: 10, win: 7.3, loss: 10.0, none: 82.7, noneRet: 0.37 },
  { target: 20, stop: 1, win: 1.8, loss: 80.7, none: 17.5, noneRet: 4.68 },
  { target: 20, stop: 2, win: 2.5, loss: 66.2, none: 31.3, noneRet: 3.86 },
  { target: 20, stop: 2.5, win: 2.7, loss: 59.4, none: 37.9, noneRet: 3.5 },
  { target: 20, stop: 3, win: 2.9, loss: 53.1, none: 44.0, noneRet: 3.18 },
  { target: 20, stop: 4, win: 3.3, loss: 42.1, none: 54.7, noneRet: 2.63 },
  { target: 20, stop: 5, win: 3.5, loss: 33.1, none: 63.4, noneRet: 2.18 },
  { target: 20, stop: 7, win: 3.8, loss: 20.2, none: 76.0, noneRet: 1.46 },
  { target: 20, stop: 10, win: 3.9, loss: 10.0, none: 86.0, noneRet: 0.77 },
]

/** 가장 가까운 격자(목표·손절 %)의 실측값 */
export function lookupTpSlBaseRate(targetPct: number, stopPct: number): TpSlBaseRate {
  const t = Number.isFinite(targetPct) ? targetPct : 5
  const s = Number.isFinite(stopPct) ? Math.abs(stopPct) : 3
  let best = TP_SL_BASE_RATES[0]
  let bestD = Infinity
  for (const row of TP_SL_BASE_RATES) {
    const d = Math.abs(row.target - t) / Math.max(1, t) + Math.abs(row.stop - s) / Math.max(1, s)
    if (d < bestD) {
      bestD = d
      best = row
    }
  }
  return best
}

/**
 * 시뮬레이터의 이분법 모델(승률×목표 − (1−승률)×손절)이 실측 기대값과 같아지는 환산 승률(%).
 * 실측 기대값 = win×target − loss×stop + none×noneRet (비용 전).
 */
export function empiricalWinProb(targetPct: number, stopPct: number): number {
  const rate = lookupTpSlBaseRate(targetPct, stopPct)
  const t = Math.max(0.1, Number(targetPct) || rate.target)
  const s = Math.max(0.1, Math.abs(Number(stopPct) || rate.stop))
  const ev = (rate.win * rate.target - rate.loss * rate.stop + rate.none * rate.noneRet) / 100
  const p = (ev + s) / (t + s)
  return Math.round(Math.min(100, Math.max(0, p * 100)))
}
