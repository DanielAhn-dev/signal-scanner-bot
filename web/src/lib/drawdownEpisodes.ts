/**
 * 월말 가격에서 고점 대비 큰 하락 구간을 찾는다 — 하락 카드의 "과거 큰 하락 위에 지금 위치" 그림용.
 * 구간 = 고점 → 그 고점을 다시 넘는 달. 저점 깊이가 minDepthPct(예: −15) 이하인 구간만.
 * 끝까지 회복하지 못한 구간(진행 중)은 recoverYm이 null.
 */
export type DrawdownEpisode = {
  peakYm: string
  troughYm: string
  recoverYm: string | null
  depthPct: number
  /** 고점 → 저점 개월 */
  monthsDown: number
  /** 고점 → 회복 개월 (진행 중이면 null) */
  monthsToRecover: number | null
}

const ymIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1

export function drawdownEpisodes(monthly: ReadonlyArray<readonly [string, number]>, minDepthPct = -15): DrawdownEpisode[] {
  const out: DrawdownEpisode[] = []
  let peak: { ym: string; v: number } | null = null
  let trough: { ym: string; v: number } | null = null
  const close = (recoverYm: string | null) => {
    if (!peak || !trough) return
    const depthPct = (trough.v / peak.v - 1) * 100
    if (depthPct <= minDepthPct) {
      out.push({
        peakYm: peak.ym,
        troughYm: trough.ym,
        recoverYm,
        depthPct,
        monthsDown: ymIndex(trough.ym) - ymIndex(peak.ym),
        monthsToRecover: recoverYm ? ymIndex(recoverYm) - ymIndex(peak.ym) : null,
      })
    }
  }
  for (const [ym, v] of monthly) {
    if (!(v > 0)) continue
    if (!peak || v >= peak.v) {
      if (trough) close(ym)
      peak = { ym, v }
      trough = null
    } else if (!trough || v < trough.v) {
      trough = { ym, v }
    }
  }
  if (trough) close(null)
  return out
}

/** 개월 → "1년 3개월" */
export function monthsLabel(n: number): string {
  const y = Math.floor(n / 12)
  const m = n % 12
  return y ? `${y}년${m ? ` ${m}개월` : ''}` : `${m}개월`
}
