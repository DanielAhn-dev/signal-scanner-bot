import { useEffect, useMemo, useState } from 'react'
import More from '../../../components/ui/More'
import { apiFetch } from '../../../lib/api'
import { formatKrwCompact, formatNumber } from '../../../lib/format'
import { useCurrentChatId } from '../../../stores/profileStore'
import { buildAccountOverview, planKrIndexPct } from '../lib/accountOverview'
import type { HoldingRow } from '../types'

/**
 * 실제 계좌 전체 탭 맨 위 — 계좌 여러 개를 유형별로 한 번에 보고, 내 계획과 다른 곳만 짚는다.
 * 계산은 lib/accountOverview.ts. 매매를 막거나 권하지 않고 차이만 보여 준다(옮길 금액은 리밸런싱 제안).
 */
type Mix = { index: string; weight: number }[] | null

const signed = (n: number | null) => (n == null ? '-' : `${n > 0 ? '+' : ''}${formatNumber(n, 1)}%`)
const tone = (n: number | null) => (n == null || Math.abs(n) < 0.05 ? '' : n > 0 ? 'positive' : 'negative')

export default function AccountOverviewCard({ rows }: { rows: HoldingRow[] }) {
  const chatId = useCurrentChatId()
  const [mix, setMix] = useState<Mix>(null)

  useEffect(() => {
    if (!chatId) return
    let active = true
    apiFetch('/api/ui/investment-prefs', { cacheMs: 30_000, retries: 0 })
      .then((res) => { if (active) setMix((res?.data?.plan?.mix as Mix) ?? null) })
      .catch(() => {})
    return () => { active = false }
  }, [chatId])

  const o = useMemo(() => buildAccountOverview(rows, { planKrPct: planKrIndexPct(mix) }), [rows, mix])
  if (o.total <= 0) return null

  return (
    <div className="card mb-4 portfolio-account-overview">
      <div className="title-md">내 돈 한눈에</div>
      <div className="caption muted">
        실제 계좌 {o.accounts.length}개 · 마지막 종가 기준 · 예수금과 이 앱에 입력하지 않은 계좌는 빠져 있습니다.
      </div>

      <div className="portfolio-account-overview-total">
        넣은 돈 {formatKrwCompact(o.cost)} → 지금 {formatKrwCompact(o.total)}{' '}
        <span className={tone(o.returnPct)}>({signed(o.returnPct)})</span>
      </div>

      <table className="portfolio-account-overview-table">
        <thead>
          <tr><th scope="col">유형</th><th scope="col">비중</th><th scope="col">수익률</th></tr>
        </thead>
        <tbody>
          {o.buckets.map((b) => (
            <tr key={b.bucket}>
              <td>
                {b.label}
                {b.note && <div className="portfolio-account-overview-note">{b.note}</div>}
              </td>
              <td>{formatNumber(b.pct, 1)}%<div className="caption muted">{formatKrwCompact(b.value)}</div></td>
              <td className={tone(b.returnPct)}>{signed(b.returnPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {o.missingPrice.length > 0 && (
        <div className="portfolio-account-overview-note" role="status">
          가격 자료가 없는 종목 {o.missingPrice.length}개({o.missingPrice.map((m) => m.name).join(', ')})는 산 가격으로 계산했습니다.
        </div>
      )}

      <More label="계좌별 한 줄 보기">
        <ul className="portfolio-account-overview-accounts">
          {o.accounts.map((a) => (
            <li key={a.key}>
              <strong>{a.label}</strong> {formatKrwCompact(a.value)} · {a.topLabel} {formatNumber(a.topPct, 0)}% ·{' '}
              <span className={tone(a.returnPct)}>{signed(a.returnPct)}</span>
            </li>
          ))}
        </ul>
        <p className="caption muted">
          개별주 상한 10%(20%를 넘으면 팔아 줄이기), 커버드콜은 인컴의 1/3 이하, 국내 지수는 내 계획 구성과 10%p 넘게 다를 때 표시합니다.
          옮길 금액은 리밸런싱 제안에서 봅니다.
        </p>
      </More>
    </div>
  )
}
