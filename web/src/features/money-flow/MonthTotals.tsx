import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { MAX_TOTAL_SLOTS, reconcileMonth, slotsForMonth, type FlowSummary, type TotalKind } from '../../../../src/lib/moneyFlow'

/** 서버가 주는 월 합계 한 칸. mine = 내가 적은 칸(배우자 칸은 읽기만) */
export type MonthTotalRow = { month: string; label: string; kind: TotalKind; amount: number; mine: boolean }
type Slot = { key: string; label: string; kind: TotalKind; amount: string }

const krw = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const newKey = () => Math.random().toString(36).slice(2)
const KIND_LABEL: Record<TotalKind, string> = { cash: '카드·현금', point: '포인트' }

/**
 * 이 달 합계 칸. 카드 앱의 '이번 달 이용금액'(이용월 기준)을 칸별로 옮겨 적는다.
 * 세부 기록은 원할 때만 — 합계와의 차액은 '세부 안 적음'으로 남고 0을 맞추지 않아도 저장된다.
 */
export default function MonthTotals({ month, thisMonth, setMonth, totals, detail, partnerShared, ready, onSaved }: {
  month: string; thisMonth: string; setMonth: (m: string) => void
  totals: MonthTotalRow[]; detail: FlowSummary; partnerShared: boolean; ready: boolean; onSaved: () => Promise<void> | void
}) {
  const mine = useMemo(() => totals.filter((t) => t.mine), [totals])
  const initial = useMemo(() => slotsForMonth(month, mine).map((s) => ({ key: newKey(), label: s.label, kind: s.kind, amount: s.amount === null ? '' : String(s.amount) })), [month, mine])
  const [slots, setSlots] = useState<Slot[]>(initial)
  useEffect(() => setSlots(initial), [initial])
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const partnerTotals = totals.filter((t) => !t.mine && t.month === month)
  const entered = slots.filter((s) => s.amount.trim() !== '')
  const preview = reconcileMonth([
    ...entered.map((s) => ({ label: s.label, kind: s.kind, amount: Math.max(0, Math.round(Number(s.amount) || 0)) })),
    ...partnerTotals,
  ], detail)
  const savedMonth = mine.some((t) => t.month === month)
  const update = (key: string, patch: Partial<Slot>) => setSlots((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const save = async () => {
    if (savingRef.current) return
    const labels = entered.map((s) => s.label.trim())
    if (labels.some((l) => !l)) { setNotice('금액을 적은 칸에 이름을 붙여 주세요.'); return }
    if (new Set(labels).size !== labels.length) { setNotice('칸 이름이 겹칩니다. 다르게 붙여 주세요(예: A카드, B카드).'); return }
    if (entered.some((s) => !Number.isSafeInteger(Number(s.amount)) || Number(s.amount) < 0)) { setNotice('금액은 0원 이상 정수로 적어 주세요.'); return }
    savingRef.current = true
    setSaving(true)
    setNotice('')
    try {
      await apiFetch('/api/ui/money-flow', {
        method: 'POST', cacheMs: 0,
        body: JSON.stringify({ action: 'save-month-totals', month, totals: entered.map((s) => ({ label: s.label.trim(), kind: s.kind, amount: Number(s.amount) })) }),
      })
      setNotice(entered.length === 0 ? `${Number(month.slice(5))}월 합계를 비웠습니다.` : `${Number(month.slice(5))}월 합계를 저장했습니다.`)
      await onSaved()
    } catch (error) {
      setNotice(`저장 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const refunds = detail.refundRegular + detail.refundOnce
  const detailTotal = preview.detailedCash + preview.detailedPoint
  const total = preview.cashTotal + preview.pointTotal
  const unrecorded = preview.unrecordedCash + preview.unrecordedPoint

  return (
    <section className="acc-card">
      <div className="mf-month-nav">
        <button type="button" aria-label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button>
        <h2>{month.replace('-', '년 ')}월 합계</h2>
        <button type="button" aria-label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth}><ChevronRight size={18} /></button>
      </div>
      {!ready ? <p className="acc-note">합계 칸은 준비 중입니다(서버 설정 대기). 아래 세부 기록은 그대로 쓸 수 있습니다.</p> : (
        <>
          <p className="acc-note">{Number(month.slice(5))}월에 쓴 돈을 적는 칸입니다. 다음 달 중순에 나가는 카드 결제 대금(명세서)이 대개 이 달 이용분이라, 명세서를 받으면 쓴 달 칸에 적으세요(예: 10월 13일 결제 대금 → 9월 칸). 관리비·보험·학원비처럼 계좌에서 바로 나가는 돈은 "현금" 칸에 넣어야 빠지지 않습니다. 세부는 적을 수 있을 때만 적고, 나머지는 "세부 안 적음"으로 남겨도 됩니다.</p>
          <div className="mf-slots" role="group" aria-label="합계 칸">
            {slots.map((s, i) => (
              <div key={s.key} className="mf-slot">
                <input type="text" maxLength={20} aria-label={`${i + 1}번 칸 이름`} value={s.label} placeholder="예: A카드" onChange={(e) => update(s.key, { label: e.target.value })} />
                <select aria-label={`${s.label || `${i + 1}번 칸`} 종류`} value={s.kind} onChange={(e) => update(s.key, { kind: e.target.value as TotalKind })}>
                  {(Object.keys(KIND_LABEL) as TotalKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <input type="number" inputMode="numeric" min="0" aria-label={`${s.label || `${i + 1}번 칸`} 금액`} value={s.amount} placeholder="안 적음" onChange={(e) => update(s.key, { amount: e.target.value })} />
                <button type="button" className="acc-remove" onClick={() => setSlots((list) => list.filter((x) => x.key !== s.key))}>빼기</button>
              </div>
            ))}
          </div>
          {slots.length < MAX_TOTAL_SLOTS && (
            <button type="button" className="acc-add" onClick={() => setSlots((list) => [...list, { key: newKey(), label: '', kind: 'cash', amount: '' }])}><Plus size={14} /> 칸 추가</button>
          )}
          {partnerTotals.length > 0 && <p className="acc-note">배우자가 적은 칸: {partnerTotals.map((t) => `${t.label} ${krw(t.amount)}`).join(' · ')} (합계에 함께 셉니다)</p>}
          {partnerShared && <p className="acc-note">각자 자기 카드만 적어요. 같은 가족카드를 둘 다 적으면 두 번 셉니다.</p>}
          <dl className="acc-facts mf-reconcile" aria-label="합계와 세부 기록">
            <div><dt>합계</dt><dd>{krw(total)}</dd></div>
            <div><dt>세부 기록</dt><dd>{krw(detailTotal)}{total > 0 && ` (${Math.round((Math.min(detailTotal, total) / total) * 100)}%)`}</dd></div>
            <div><dt>세부 안 적음</dt><dd>{krw(unrecorded)}</dd></div>
          </dl>
          {(preview.overCash || preview.overPoint) && <p className="acc-warn">세부 기록이 합계보다 많습니다. 다른 달 기록이 섞였거나 합계를 덜 적었을 수 있어요. 저장은 됩니다.</p>}
          {refunds > 0 && entered.some((s) => s.kind === 'cash') && <p className="acc-note">세부 기록의 돌려받은 돈(환급·캐시백) {krw(refunds)}은 카드 이용금액과 별개라 통장에서 나간 돈을 셀 때 따로 뺍니다.</p>}
          <button type="button" className="acc-primary" onClick={() => void save()} disabled={saving || (!savedMonth && entered.length === 0)}>{saving ? '저장 중…' : '합계 저장'}</button>
          {notice && <p className="acc-note" role="status">{notice}</p>}
        </>
      )}
    </section>
  )
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
