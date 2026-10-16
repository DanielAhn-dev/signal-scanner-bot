import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'

type Props = {
  /** 이번 달 YYYY-MM */
  month: string
  /** 이 달 투자금 '분배금 재투자' 칸에 이미 넣은 금액 */
  invested: number
  /** 그 칸에 더하고(+) 빼서(−) 저장. 저장이 성공해야 true */
  onApply: (delta: number) => Promise<boolean>
  krw: (amount: number) => string
}

type GuideSlice = { received: number; estimated: number; buyName: string | null; count: number }

/**
 * 이번 달 투자금 맨 위: 실계좌에서 이 달 받은 분배금(리밸런싱 가이드의 받은 분배금 기록)을 투자금에 넣는다.
 * 이미 넣은 금액(칸 값)과의 차이만 넣으므로 두 번 눌러도 중복되지 않고, 기록을 고치면 차이만 다시 보인다.
 */
export default function DistributionInbox({ month, invested, onApply, krw }: Props) {
  const [slice, setSlice] = useState<GuideSlice | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/ui/income-guide', { cacheMs: 60_000, retries: 0, timeoutMs: 20_000 })
      .then((res) => {
        const d = res?.data
        const r = d?.distributionReceipts
        if (cancelled || !r || r.thisMonth?.month !== month) return
        setSlice({ received: Number(r.thisMonth.net) || 0, estimated: Number(r.thisMonth.estimatedCount) || 0, buyName: d?.plan?.buyTarget?.name ?? null, count: r.thisMonth.items?.length ?? 0 })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [month])

  if (!slice || (slice.received <= 0 && invested <= 0)) return null
  const gap = slice.received - invested

  const run = async (delta: number) => {
    if (busyRef.current || delta === 0) return
    busyRef.current = true
    setBusy(true)
    try {
      await onApply(delta)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <section className="seed-inbox" aria-label="받은 분배금">
      <h2>이번 달 받은 분배금 {krw(slice.received)}</h2>
      <div className="seed-inbox-item">
        <p className="seed-inbox-guide">
          리밸런싱 가이드에 적은 {slice.count}종목 세후 합계입니다{slice.estimated > 0 ? `(세후를 안 적은 ${slice.estimated}건은 15.4%를 떼고 계산)` : ''}.
          {' '}재투자는 {slice.buyName ? <strong>{slice.buyName}</strong> : '성장 지수 ETF'} 한 곳으로 — 커버드콜·배당 ETF를 더 사지 않습니다.
        </p>
        {gap > 0 ? (
          <div className="seed-inbox-actions">
            <button type="button" className="seed-primary" disabled={busy} onClick={() => void run(gap)}>
              {busy ? '저장 중' : `${krw(gap)} 투자금에 넣기`}
            </button>
          </div>
        ) : (
          <div className="seed-inbox-done">
            <span>{krw(invested)} 넣음{gap < 0 ? ` · 기록보다 ${krw(-gap)} 많음` : ''}</span>
            <button type="button" className="seed-link-button" disabled={busy} onClick={() => void run(gap < 0 ? gap : -invested)}>
              {gap < 0 ? '기록에 맞추기' : '되돌리기'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
