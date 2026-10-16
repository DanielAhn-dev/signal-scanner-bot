import React, { useMemo, useRef, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import Button from '../../components/ui/Button'

/** 서버 src/lib/distributionReceipts.ts (handlers/ui/income-guide.ts의 distributionReceipts) */
export type Receipt = { id: string; month: string; code: string; name: string; quantity: number; perShare: number; net: number | null; createdAt: string }
type MonthSum = { month: string; items: Receipt[]; gross: number; net: number; estimatedCount: number }
type ProjectionRow = {
  code: string
  name: string
  quantity: number
  net: number
  source: 'receipt' | 'estimate'
  perShare: number | null
  netRatio: number | null
  intervalMonths: number | null
  addedShares: number
}
export type DistributionReceiptsData = {
  thisMonth: MonthSum
  lastMonth: MonthSum
  projection: { total: number; fromReceipts: number; fromEstimate: number; receiptCodes: number; rows: ProjectionRow[] }
  recent: Receipt[]
}

type Props = {
  data: DistributionReceiptsData
  /** 분배금이 나오는 보유 종목(같은 종목 여러 계좌면 수량 합) */
  holdings: Array<{ code: string; name: string; quantity: number }>
  buyName: string | null
  /** 서버에 보내고 성공하면 null, 실패하면 이유 */
  submit: (body: Record<string, unknown>) => Promise<string | null>
}

const man = formatKrwMan
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
const card: React.CSSProperties = {
  margin: '8px 12px',
  padding: 14,
  border: '1px solid var(--color-border-default)',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.65,
  background: 'var(--color-bg-elevated, transparent)',
  wordBreak: 'keep-all',
}
const muted: React.CSSProperties = { color: 'var(--color-text-secondary)' }
const faint: React.CSSProperties = { color: 'var(--color-text-tertiary)', fontSize: 12 }
const cell: React.CSSProperties = { padding: '3px 6px' }
const num: React.CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' }
const thisMonthKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 받은 분배금 — 종목·받은 수량·주당 분배금(·세후 입금액)을 적으면 이번 달 실제 합계와
 * '최근 주당 × 지금 수량 × 실제 세후 비율'로 다음 달 예상을 보여 준다. 월 인컴(위 요약)도 이 예상을 쓴다.
 */
export default function DistributionReceipts({ data, holdings, buyName, submit }: Props) {
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [form, setForm] = useState({ month: thisMonthKey(), code: '', quantity: '', perShare: '', net: '' })
  const holdingOf = useMemo(() => new Map(holdings.map((h) => [h.code, h])), [holdings])
  const { thisMonth, projection } = data
  const delta = projection.total - thisMonth.net
  const notYet = holdings.filter((h) => !thisMonth.items.some((r) => r.code === h.code) && projection.rows.some((p) => p.code === h.code)).length
  const added = projection.rows.filter((r) => r.source === 'receipt' && r.addedShares > 0 && r.perShare)

  const pick = (code: string) => {
    const h = holdingOf.get(code)
    setForm((f) => ({ ...f, code, quantity: h ? String(h.quantity) : f.quantity }))
  }
  const run = async (body: Record<string, unknown>, done: string) => {
    if (busy.current) return false
    busy.current = true
    setPending(true)
    setMsg(null)
    try {
      const err = await submit(body)
      setMsg(err ?? done)
      return err == null
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const add = async () => {
    const h = holdingOf.get(form.code)
    if (!h) return setMsg('종목을 골라 주세요.')
    const ok = await run(
      { action: 'receipt-add', receipt: { month: form.month, code: h.code, name: h.name, quantity: form.quantity, perShare: form.perShare, net: form.net } },
      `${h.name} 분배금을 적었습니다.`,
    )
    if (ok) setForm((f) => ({ ...f, code: '', quantity: '', perShare: '', net: '' }))
  }

  return (
    <div style={card}>
      <strong style={{ fontSize: 15, display: 'block', marginBottom: 4 }}>받은 분배금</strong>
      <div>
        {thisMonth.month.slice(5).replace(/^0/, '')}월 받은 금액(세후) <strong>{won(thisMonth.net)}</strong>
        {thisMonth.items.length > 0 && <span style={muted}> · {thisMonth.items.length}종목{notYet > 0 ? ` · 아직 안 적은 종목 ${notYet}개` : ''}</span>}
        {thisMonth.estimatedCount > 0 && <span style={faint}> (세후를 안 적은 {thisMonth.estimatedCount}건은 15.4%를 떼고 계산)</span>}
      </div>
      <div style={{ marginTop: 4 }}>
        다음 달 예상(세후) <strong>약 {man(projection.total)}</strong>
        {thisMonth.items.length > 0 && (
          <span style={{ ...muted, marginLeft: 4 }}>· 이번 달보다 {Math.abs(delta) < 5_000 ? '거의 그대로' : `${delta > 0 ? '+' : '−'}${man(Math.abs(delta))}`}</span>
        )}
      </div>
      {added.map((r) => (
        <div key={r.code} style={faint}>
          └ {r.name} {r.addedShares.toLocaleString('ko-KR')}주 늘어남 → 약 +{man((r.perShare ?? 0) * r.addedShares * (r.netRatio ?? 0.846) / (r.intervalMonths ?? 1))}
        </div>
      ))}
      <div style={faint}>
        받은 기록이 있는 종목은 &lsquo;가장 최근 주당 분배금 × 지금 수량 × 그 종목의 실제 세후 비율&rsquo;로, 기록이 없는 종목은 최근 12개월 분배율로 추정합니다
        {projection.receiptCodes > 0 ? ` (기록 ${projection.receiptCodes}종목 ${man(projection.fromReceipts)} + 추정 ${man(projection.fromEstimate)})` : ''}.
        달마다 주당 분배금이 바뀌니 예상치입니다. 위 요약의 월 인컴도 이 값을 씁니다.
      </div>

      {/* 적기 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-end', marginTop: 10 }}>
        <label style={{ fontSize: 12 }}>
          입금된 달
          <input type="month" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))} style={{ display: 'block', width: 120 }} />
        </label>
        <label style={{ fontSize: 12 }}>
          종목
          <select value={form.code} onChange={(e) => pick(e.target.value)} style={{ display: 'block', maxWidth: 220 }}>
            <option value="">골라 주세요</option>
            {holdings.map((h) => (
              <option key={h.code} value={h.code}>{h.name}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          받은 수량
          <input inputMode="numeric" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} style={{ display: 'block', width: 70 }} placeholder="주" />
        </label>
        <label style={{ fontSize: 12 }}>
          주당 분배금
          <input inputMode="decimal" value={form.perShare} onChange={(e) => setForm((f) => ({ ...f, perShare: e.target.value }))} style={{ display: 'block', width: 80 }} placeholder="원" />
        </label>
        <label style={{ fontSize: 12 }}>
          세후 입금액(선택)
          <input inputMode="numeric" value={form.net} onChange={(e) => setForm((f) => ({ ...f, net: e.target.value }))} style={{ display: 'block', width: 100 }} placeholder="원" />
        </label>
        <Button size="sm" variant="secondary" onClick={() => void add()} disabled={pending}>
          {pending ? '저장 중…' : '적기'}
        </Button>
      </div>
      <div style={faint}>
        받은 수량은 지금 보유 수량이 기본값입니다. 기준일 뒤에 산 수량은 빼고 적어 주세요. 세후 입금액을 적으면 그 종목의 실제 세금(커버드콜은 15.4%보다 적게 떼는 경우가 있습니다)으로 다음 달을 계산합니다.
        같은 달·같은 종목을 다시 적으면 고친 것으로 저장합니다.
      </div>
      {msg && <div style={{ ...muted, marginTop: 4 }}>{msg}</div>}

      {/* 기록 */}
      {data.recent.length > 0 && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={muted}>
                <th style={{ ...cell, textAlign: 'left' }}>달</th>
                <th style={{ ...cell, textAlign: 'left' }}>종목</th>
                <th style={{ ...num }}>수량</th>
                <th style={{ ...num }}>주당</th>
                <th style={{ ...num }}>세후</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              {(showAll ? data.recent : data.recent.slice(0, 6)).map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--color-border-default)' }}>
                  <td style={cell}>{r.month.slice(5).replace(/^0/, '')}월</td>
                  <td style={cell}>{r.name}</td>
                  <td style={num}>{r.quantity.toLocaleString('ko-KR')}주</td>
                  <td style={num}>{won(r.perShare)}</td>
                  <td style={num}>{r.net != null ? won(r.net) : <span style={faint}>{won(r.quantity * r.perShare * 0.846)} 추정</span>}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => void run({ action: 'receipt-delete', id: r.id }, `${r.name} 기록을 지웠습니다.`)}>
                      지우기
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.recent.length > 6 && (
            <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '접기' : `기록 ${data.recent.length}건 모두 보기`}
            </Button>
          )}
        </div>
      )}

      {thisMonth.net > 0 && (
        <div style={{ marginTop: 10 }}>
          이번 달 받은 <strong>{won(thisMonth.net)}</strong>은 {buyName ? <strong>{buyName}</strong> : '성장 지수 ETF'}로 재투자합니다(위 ①과 같은 곳).
        </div>
      )}
    </div>
  )
}
