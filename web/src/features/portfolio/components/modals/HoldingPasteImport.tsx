import { useRef, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Input from '../../../../components/ui/Input'
import { getStocks } from '../../../../lib/stockCache'
import { parseHoldingLines, validateHolding, type PastedHolding } from '../../../../lib/holdingPaste'
import { getTodayLocalYmd } from '../../lib/dates'
import type { MaintenanceState } from '../../hooks/useMaintenance'

type Row = PastedHolding & { key: string; result?: { ok: boolean; created?: boolean; error?: string } }

/**
 * 계좌/보유 추가 2단계의 "여러 종목 붙여넣기" — 메모장에 한 줄씩 적은 목록을 읽어 미리보기로 보여 주고,
 * 확인한 뒤 한 번에 저장한다. 종목을 정확히 못 찾은 줄은 후보에서 직접 골라야 저장된다.
 */
export default function HoldingPasteImport({ maint }: { maint: MaintenanceState }) {
  const today = getTodayLocalYmd()
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [defaultDate, setDefaultDate] = useState(today)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const savingRef = useRef(false)

  const read = async () => {
    if (!text.trim()) return
    setReading(true)
    setNotice(null)
    try {
      const stocks = await getStocks()
      if (stocks.length === 0) { setNotice('종목 목록을 불러오지 못했습니다. 잠시 뒤 다시 읽어 주세요.'); return }
      setRows(parseHoldingLines(text, stocks, today).map((r, i) => ({ ...r, key: `${Date.now()}-${i}` })))
    } finally {
      setReading(false)
    }
  }

  const pickCandidate = (key: string, code: string) => setRows((list) => list.map((r) => {
    if (r.key !== key) return r
    const c = r.candidates.find((x) => x.code === code)
    if (!c) return { ...r, code: null, name: null, error: '종목을 정확히 찾지 못했습니다. 아래에서 고르세요' }
    const next = { ...r, code: c.code, name: c.name }
    return { ...next, error: validateHolding(next, today) }
  }))
  const removeRow = (key: string) => setRows((list) => list.filter((r) => r.key !== key))

  const pending = rows.filter((r) => !r.result?.ok)
  const ready = pending.filter((r) => r.code && !r.error)
  const blocked = pending.length - ready.length

  const save = async () => {
    if (savingRef.current || ready.length === 0) return
    savingRef.current = true
    setSaving(true)
    setNotice(null)
    try {
      const results = await maint.runBulkRestore(ready.map((r) => ({ code: r.code!, quantity: r.quantity!, avgPrice: r.avgPrice!, buyDate: r.buyDate ?? defaultDate })))
      const byCode = new Map(results.map((x) => [x.code, x]))
      setRows((list) => list.map((r) => (r.code && byCode.has(r.code) && !r.result?.ok ? { ...r, result: byCode.get(r.code) } : r)))
      const okCount = results.filter((x) => x.ok).length
      const failCount = results.length - okCount
      setNotice(failCount === 0 ? `${okCount}종목 저장했습니다.` : `${okCount}종목 저장, ${failCount}종목은 저장하지 못했습니다. 줄마다 사유를 확인하세요.`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const won = (n: number | null) => (n == null ? '-' : `${n.toLocaleString('ko-KR')}원`)

  return (
    <div style={{ wordBreak: 'keep-all' }}>
      <div className="ui-field" style={{ marginBottom: 'var(--space-2)' }}>
        <label className="ui-label" htmlFor="holding-paste">한 줄에 한 종목: 종목명(또는 코드) 수량 평균매수가 [매수일]</label>
        <textarea
          id="holding-paste"
          className="input"
          rows={5}
          value={text}
          placeholder={'삼성전자 10 72000\nKODEX 200 25 35,000 250312\n360750 12주 21,350원'}
          onChange={(e) => setText(e.target.value)}
          style={{ width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
        />
        <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
          칸은 띄어쓰기·탭·쉼표 아무거나 됩니다. 증권사 앱의 보유 목록을 보며 메모장에 옮겨 적은 뒤 붙여 넣으세요. 매수일은 빼도 되고, 빼면 아래 날짜로 저장합니다.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', marginBottom: 'var(--space-3)' }}>
        <div style={{ flex: 1 }}>
          <Input label="매수일 (줄에 없을 때)" type="date" value={defaultDate} max={today} onChange={(e: any) => setDefaultDate(String(e?.target?.value || today))} />
        </div>
        <Button variant="secondary" onClick={read} disabled={!text.trim() || reading}>{reading ? '읽는 중…' : '읽기'}</Button>
      </div>

      {rows.length > 0 && (
        <div aria-label="저장 전 확인" style={{ marginBottom: 'var(--space-3)' }}>
          <div className="caption muted" style={{ marginBottom: 'var(--space-1)' }}>
            미리보기 {rows.length}줄 · 같은 계좌에 이미 있는 종목은 이 수량·평균매수가로 바뀝니다.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                  <th style={{ padding: '4px 6px' }}>종목</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>수량</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>평균매수가</th>
                  <th style={{ padding: '4px 6px' }}>매수일</th>
                  <th style={{ padding: '4px 6px' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={{ borderTop: '1px solid var(--color-border)', verticalAlign: 'top' }}>
                    <td style={{ padding: '6px' }}>
                      {r.code ? <><strong>{r.name}</strong> <span className="muted">{r.code}</span></> : <span className="muted">{r.input || r.line}</span>}
                      {!r.code && r.candidates.length > 0 && (
                        <select className="input" style={{ display: 'block', marginTop: 4 }} value="" onChange={(e) => pickCandidate(r.key, e.target.value)} aria-label={`${r.input} 종목 고르기`}>
                          <option value="">종목 고르기</option>
                          {r.candidates.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                        </select>
                      )}
                      {r.result?.ok ? (
                        <div className="caption" style={{ color: 'var(--color-success)' }}>{r.result.created ? '추가함' : '기존 보유를 바꿈'}</div>
                      ) : r.result?.error ? (
                        <div className="caption" style={{ color: 'var(--color-danger)' }}>{r.result.error}</div>
                      ) : r.error ? (
                        <div className="caption" style={{ color: 'var(--color-danger)' }}>{r.error}</div>
                      ) : null}
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{r.quantity == null ? '-' : `${r.quantity.toLocaleString('ko-KR')}주`}</td>
                    <td style={{ padding: '6px', textAlign: 'right', whiteSpace: 'nowrap' }}>{won(r.avgPrice)}</td>
                    <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>{r.buyDate ?? defaultDate}</td>
                    <td style={{ padding: '6px', textAlign: 'right' }}>
                      {!r.result?.ok && <button type="button" className="caption" style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--color-text-secondary)' }} onClick={() => removeRow(r.key)}>빼기</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {notice && <div className="caption" role="status" style={{ marginBottom: 'var(--space-2)' }}>{notice}</div>}
      {rows.length > 0 && blocked > 0 && (
        <div className="caption muted" style={{ marginBottom: 'var(--space-2)' }}>확인이 필요한 {blocked}줄은 저장하지 않습니다. 종목을 고르거나 빼 주세요.</div>
      )}
      {rows.length > 0 && (
        <Button variant="primary" onClick={save} disabled={saving || ready.length === 0}>
          {saving ? '저장 중…' : `${ready.length}종목 저장`}
        </Button>
      )}
    </div>
  )
}
