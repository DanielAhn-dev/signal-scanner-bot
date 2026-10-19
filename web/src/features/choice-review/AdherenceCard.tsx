import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatKrwMan } from '../../lib/format'

/** 서버 src/lib/guideAdherence.ts의 AdherenceSummary */
export type AdherenceRow = {
  key: string
  from: string
  to: string
  code: string
  name: string
  shares: number
  amount: number
  status: 'followed' | 'deviated'
  advised: { code: string; name: string } | null
  actualNow: number | null
  advisedNow: number | null
  diff: number | null
  mature: boolean
  excluded: boolean
  reason: string
}
export type Adherence = {
  rows: AdherenceRow[]
  followed: number
  deviated: number
  early: number
  matureDiff: number
  matureCount: number
  since: string | null
}

const monthLabel = (d: string) => `${Number(d.slice(5, 7))}월`
const signedMan = (v: number) => `${v >= 0 ? '+' : '−'}${formatKrwMan(Math.abs(v))}`

/**
 * 가이드 따름 기록 — 리밸런싱 가이드가 그달 안내한 것과 실제 보유 변화를 맞춰 본다.
 * 사용자 선택이 나았던 경우도 같은 크기로 보여 준다(몰아붙이지 않기). 3개월 안 된 결정은 숫자 대신 '아직'.
 */
export default function AdherenceCard({ data, onExclude }: { data: Adherence; onExclude: (key: string, exclude: boolean) => Promise<void> }) {
  const busy = useRef(false)
  const [pending, setPending] = useState<string | null>(null)
  const toggle = async (key: string, exclude: boolean) => {
    if (busy.current) return
    busy.current = true
    setPending(key)
    try {
      await onExclude(key, exclude)
    } finally {
      busy.current = false
      setPending(null)
    }
  }
  const deviated = data.rows.filter((r) => r.status === 'deviated')
  const total = data.followed + data.deviated
  if (!data.since) {
    return (
      <section className="choice-card" aria-label="가이드 따름 기록">
        <h2>가이드 따름 기록</h2>
        <p className="choice-wait">
          이번 달부터 <Link to="/income-guide">리밸런싱 가이드</Link>의 안내(새 돈 살 곳·더 사지 말 것)를 기록합니다. 다음 달 기록과 보유 변화를 맞춰 따랐는지 보고,
          다르게 한 매수는 3개월 뒤부터 &lsquo;안내대로였다면&rsquo;과 비교해 보여 줍니다.
        </p>
      </section>
    )
  }
  return (
    <section className="choice-card" aria-label="가이드 따름 기록">
      <h2>가이드 따름 기록 — {monthLabel(data.since)}부터 · 매수 {total}건</h2>
      {total === 0 ? (
        <p className="choice-wait">아직 판정할 매수가 없습니다. 다음 기록(매달 자동)에서 보유가 늘어난 종목을 그달 안내와 맞춰 봅니다.</p>
      ) : (
        <p className="choice-wait">
          따름 {data.followed} · 다르게 함 {data.deviated}
          {data.early > 0 ? ` · 3개월 안 된 결정 ${data.early}건은 아직 판단하지 않습니다` : ''}
        </p>
      )}
      {deviated.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="choice-health choice-adherence">
            <thead>
              <tr><th>다르게 한 매수</th><th>지금 가치</th><th>안내대로였다면</th><th>차이</th><th /></tr>
            </thead>
            <tbody>
              {deviated.map((r) => (
                <tr key={r.key} className={r.excluded ? 'is-excluded' : ''}>
                  <th>
                    {monthLabel(r.to)} {r.name} {formatKrwMan(r.amount)}
                    <small>{r.reason}{r.advised ? ` → ${r.advised.name}` : ''}</small>
                  </th>
                  {r.mature && r.diff != null ? (
                    <>
                      <td>{formatKrwMan(r.actualNow!)}</td>
                      <td>{formatKrwMan(r.advisedNow!)}</td>
                      <td className={r.diff >= 0 ? 'is-up' : 'is-down'}>
                        {signedMan(r.diff)}
                        <small>{r.diff >= 0 ? '내 선택 우세' : '안내 우세'}</small>
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="is-muted">{r.mature ? '가격 자료 없음' : '아직 (3개월 뒤 비교)'}</td>
                  )}
                  <td>
                    <button type="button" className="choice-link" disabled={pending === r.key} onClick={() => void toggle(r.key, !r.excluded)}>
                      {r.excluded ? '다시 넣기' : '판정에서 빼기'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.matureCount > 0 && (
        <p className="choice-wait" style={{ marginTop: 8 }}>
          다르게 한 {data.matureCount}건 합계 <strong className={data.matureDiff >= 0 ? 'is-up' : 'is-down'}>{signedMan(data.matureDiff)}</strong>
          {data.matureCount < 5 ? ` — ${data.matureCount}건이라 아직 어느 쪽이 낫다고 하기 이릅니다.` : ''}
        </p>
      )}
      <p className="choice-note">
        보유 기록은 매달 남기므로, 산 날은 두 기록 사이 어딘가입니다. 뒤 기록 날 가격으로 계산합니다. 분배금은 받은 기록이 있는 종목만 더하고, 사지 않기로 한 달의 &lsquo;안내대로였다면&rsquo;은 현금 그대로로 봅니다(이자 제외).
        입력 실수나 다른 이유가 있던 매수는 &lsquo;판정에서 빼기&rsquo;로 합계에서 뺄 수 있습니다. 이 기록은 안내를 고치는 자료로도 씁니다. 다만 몇 건만으로 규칙을 바꾸지 않습니다.
      </p>
    </section>
  )
}
