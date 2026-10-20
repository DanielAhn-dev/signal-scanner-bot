import { useEffect, useRef, useState } from 'react'
import More from '../../components/ui/More'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { MAX_TOTAL_SLOTS, fixedCashOf, irregularForMonth, fixedOutsideCardOf, matchesIrregular, monthSpending, slotsForMonth, type FlowCheckInput, type FlowSummary, type Payment, type TotalKind } from '../../../../src/lib/moneyFlow'

/** 서버가 주는 월 합계 한 칸. mine = 내가 적은 칸(배우자 칸은 읽기만) */
export type MonthTotalRow = { month: string; label: string; kind: TotalKind; amount: number; mine: boolean; updatedAt?: string }
type Slot = { key: string; label: string; kind: TotalKind; amount: string }
/** 이 달 세부 기록(비정기 실제 금액을 찾고 고치는 데 쓴다) */
export type MonthRecord = { id: string; date: string; amount: number; memo: string; categoryId: string; payment: Payment; forWhom?: string; paidWith?: 'card' | 'cash'; cut: string | null; mustPart: number | null }

const krw = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const newKey = () => Math.random().toString(36).slice(2)
const KIND_LABEL: Record<TotalKind, string> = { cash: '카드·현금', point: '포인트' }

/**
 * 이 달 합계 칸. 결제월 기준 — 그 달 통장에서 빠져나간 카드 결제금액을 칸별로 적는다(투자 가능액은 실제로 남는 돈 기준).
 * 다음 달 칸은 카드 앱의 '다음 결제 예정금액'을 미리 적고 볼 때마다 고친다. 결제일이 지나면 그대로 그 달 확정 금액이다.
 * 세부 기록은 원할 때만 — 카드 세부를 안 적는 달은 '세부 안 적음'을 보여 주지 않는다.
 */
export default function MonthTotals({ month, thisMonth, today, setMonth, totals, cardDetail, cashDetail, records, plan, partnerShared, ready, onSaved }: {
  month: string; thisMonth: string; today: string; setMonth: (m: string) => void
  /** 카드 세부(합계 안)와 현금 세부(합계 밖, 더함) 요약 */
  totals: MonthTotalRow[]; cardDetail: FlowSummary; cashDetail: FlowSummary
  /** 이 달 세부 기록과, 그 달 기준 점검(고정비·1년 비정기 예산). 점검이 없으면 비정기 칸을 안 보여 준다 */
  records: MonthRecord[]; plan: FlowCheckInput | null
  partnerShared: boolean; ready: boolean; onSaved: () => Promise<void> | void
}) {
  // 부모가 다시 그릴 때마다 배열이 새로 와도, 저장된 내용이 그대로면 입력 중인 값을 지우지 않는다(내용 문자열로 비교)
  const mine = totals.filter((t) => t.mine)
  const savedSlots = slotsForMonth(month, mine)
  const slotsKey = `${month}|${JSON.stringify(savedSlots)}`
  const toSlots = () => savedSlots.map((s) => ({ key: newKey(), label: s.label, kind: s.kind, amount: s.amount === null ? '' : String(s.amount) }))
  const [slots, setSlots] = useState<Slot[]>(toSlots)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setSlots(toSlots()), [slotsKey])
  // 이번 달 나가는 비정기: 1년 예산 중 이 달 몫(예상)과 실제 낸 금액. 실제는 항목 이름으로 세부 기록에 저장한다
  const monthNo = Number(month.slice(5))
  const upcoming = month > thisMonth
  const lastEdited = mine.filter((t) => t.month === month && t.updatedAt).map((t) => t.updatedAt!).sort().pop()
  const irregular = irregularForMonth(plan, monthNo, records)
  const toActual = () => Object.fromEntries(irregular.rows.map((r) => [r.label, r.actual === null ? '' : String(r.actual)]))
  const actualKey = `${month}|${irregular.rows.map((r) => `${r.label}:${r.actual}`).join('|')}`
  const [actual, setActual] = useState<Record<string, string>>(toActual)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setActual(toActual()), [actualKey])
  const changedIrregular = irregular.rows.filter((r) => (actual[r.label] ?? '').trim() !== '' && Number(actual[r.label]) !== r.actual)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const partnerTotals = totals.filter((t) => !t.mine && t.month === month)
  const entered = slots.filter((s) => s.amount.trim() !== '')
  const preview = monthSpending([
    ...entered.map((s) => ({ label: s.label, kind: s.kind, amount: Math.max(0, Math.round(Number(s.amount) || 0)) })),
    ...partnerTotals,
  ], cardDetail, cashDetail, fixedOutsideCardOf(plan))
  const savedMonth = mine.some((t) => t.month === month)
  const update = (key: string, patch: Partial<Slot>) => setSlots((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const save = async () => {
    if (savingRef.current) return
    const labels = entered.map((s) => s.label.trim())
    if (labels.some((l) => !l)) { setNotice('금액을 적은 칸에 이름을 붙여 주세요.'); return }
    if (new Set(labels).size !== labels.length) { setNotice('칸 이름이 겹칩니다. 다르게 붙여 주세요(예: A카드, B카드).'); return }
    if (entered.some((s) => !Number.isSafeInteger(Number(s.amount)) || Number(s.amount) < 0)) { setNotice('금액은 0원 이상 정수로 적어 주세요.'); return }
    if (changedIrregular.some((r) => !Number.isSafeInteger(Number(actual[r.label])) || Number(actual[r.label]) < 1)) { setNotice('비정기 실제 금액은 1원 이상 정수로 적어 주세요.'); return }
    // 같은 이름 기록이 여러 건이면 어느 것을 고칠지 알 수 없다 — 세부 기록에서 고치게 한다
    const ambiguous = changedIrregular.filter((r) => records.filter((x) => matchesIrregular(x.memo, r.label)).length > 1)
    if (ambiguous.length > 0) { setNotice(`${ambiguous.map((r) => r.label).join(', ')}은(는) 이 달 기록이 여러 건이라 아래 세부 기록에서 고쳐 주세요.`); return }
    savingRef.current = true
    setSaving(true)
    setNotice('')
    try {
      if (entered.length > 0 || savedMonth) {
        await apiFetch('/api/ui/money-flow', {
          method: 'POST', cacheMs: 0,
          body: JSON.stringify({ action: 'save-month-totals', month, totals: entered.map((s) => ({ label: s.label.trim(), kind: s.kind, amount: Number(s.amount) })) }),
        })
      }
      // 비정기 실제: 이미 있는 기록은 금액만 고치고, 없으면 그 달 기록으로 더한다(이번 달이면 오늘, 지난달이면 말일)
      const date = month === thisMonth ? today : lastDay(month)
      const adds = []
      for (const r of changedIrregular) {
        const value = Number(actual[r.label])
        const existing = records.find((x) => matchesIrregular(x.memo, r.label))
        if (existing) {
          await apiFetch('/api/ui/money-flow', { method: 'POST', cacheMs: 0, body: JSON.stringify({ action: 'update-entry', id: existing.id, date: existing.date, amount: value, memo: existing.memo, categoryId: existing.categoryId, payment: existing.payment, forWhom: existing.forWhom ?? 'shared', paidWith: existing.paidWith ?? 'card', cut: existing.cut, mustPart: existing.mustPart !== null && existing.mustPart <= value ? existing.mustPart : null, learn: false }) })
        } else {
          adds.push({ date, amount: value, memo: r.label, categoryId: r.categoryId, payment: 'cash', forWhom: 'shared', learn: false })
        }
      }
      if (adds.length > 0) await apiFetch('/api/ui/money-flow', { method: 'POST', cacheMs: 0, body: JSON.stringify({ action: 'add-entries', entries: adds }) })
      const parts = [entered.length > 0 ? '합계' : savedMonth ? '합계(비움)' : '', changedIrregular.length > 0 ? `비정기 ${changedIrregular.length}건` : ''].filter(Boolean)
      setNotice(`${monthNo}월 ${parts.join('·')}을 저장했습니다.`)
      await onSaved()
    } catch (error) {
      setNotice(`저장 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const refunds = cardDetail.refundRegular + cardDetail.refundOnce + cashDetail.refundRegular + cashDetail.refundOnce
  const cashRecords = records.filter((r) => r.paidWith === 'cash')
  // 미리 보기: 아직 저장 안 한 실제 금액도 반영한 비정기 합
  const irregularPreview = irregular.rows.reduce((sum, r) => sum + ((actual[r.label] ?? '').trim() !== '' ? Math.max(0, Number(actual[r.label]) || 0) : r.expected), 0) + irregular.others
  const fixed = plan ? fixedCashOf(plan) : null
  const rest = fixed !== null && entered.some((s) => s.kind === 'cash') ? preview.cash - fixed - irregularPreview : null
  const detailTotal = preview.detailedCash + preview.detailedPoint
  const total = preview.cashTotal + preview.pointTotal
  const unrecorded = preview.unrecordedCash + preview.unrecordedPoint

  return (
    <section className="acc-card">
      <div className="mf-month-nav">
        <button type="button" aria-label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} />{Number(shiftMonth(month, -1).slice(5))}월</button>
        <h2>{month.replace('-', '년 ')}월 {upcoming ? '결제 예정' : '합계'}</h2>
        <button type="button" aria-label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= shiftMonth(thisMonth, 1)}>{Number(shiftMonth(month, 1).slice(5))}월{shiftMonth(month, 1) > thisMonth ? ' 예정' : ''}<ChevronRight size={16} /></button>
      </div>
      {!ready ? <p className="acc-note">합계 칸은 준비 중입니다(서버 설정 대기). 아래 세부 기록은 그대로 쓸 수 있습니다.</p> : (
        <>
          {upcoming
            ? <><p className="acc-note">카드 앱의 "다음 결제 예정금액"을 칸별로 적으세요. 아래 투자 가능액은 예상입니다.</p>
              <More label="결제일이 지나면"><p className="acc-note">앱을 볼 때마다 고쳐 저장하세요. 결제일이 지나면 그 금액이 그대로 {monthNo}월 결제금액이 됩니다.</p></More></>
            : <><p className="acc-note">{monthNo}월에 통장에서 나간 카드 결제금액(명세서 결제금액)을 적으세요.</p>
              <More label="왜 결제금액인가요 · 다음 달 미리 적기"><p className="acc-note">지난달에 쓴 돈이 이 달에 나가므로, 이 달 수입에서 빼야 실제로 남는 돈이 나옵니다. 다음 달 예정금액은 오른쪽 "{Number(shiftMonth(month, 1).slice(5))}월{shiftMonth(month, 1) > thisMonth ? ' 예정' : ''}" 버튼으로 넘어가 미리 적을 수 있습니다. 관리비·보험까지 모두 카드로 낸다면 카드 칸만 적으면 됩니다.</p></More></>}
          {lastEdited && <p className="acc-note">마지막 수정 {lastEdited.slice(5, 10).replace('-', '/')}</p>}
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
          {irregular.rows.length > 0 && (
            <div className="mf-irregular" role="group" aria-label="이번 달 나가는 비정기">
              <h3>이번 달 나가는 비정기 <small>1년 예산 기준</small></h3>
              {irregular.rows.map((r) => (
                <div key={r.label} className="mf-irregular-row">
                  <span>{r.label}</span>
                  <small>예상 {krw(r.expected)}</small>
                  {!upcoming && <input type="number" inputMode="numeric" min="1" aria-label={`${r.label} 실제`} value={actual[r.label] ?? ''} placeholder="실제 안 적음" onChange={(e) => setActual((cur) => ({ ...cur, [r.label]: e.target.value }))} />}
                </div>
              ))}
              <p className="acc-note">매달 1/12씩 떼어 둔 돈에서 내는 것으로 봅니다.</p>
              <More label="실제 금액 적기"><p className="acc-note">실제 금액을 적으면 그 이름으로 세부 기록에 남아 작년과 비교되고, 안 적으면 예상 금액으로 계산합니다. 예산에 없는 비정기(경조사 등)는 자세히 적기에서 분류를 골라 적으면 함께 빠집니다.</p></More>
            </div>
          )}
          <dl className="acc-facts mf-reconcile" aria-label="합계와 세부 기록">
            <div><dt>카드 합계</dt><dd>{krw(total)}</dd></div>
            {/* 카드 세부를 안 적는 달은 비교할 게 없어 숨긴다 */}
            {detailTotal > 0 && <div><dt>카드 세부 기록</dt><dd>{krw(detailTotal)}{total > 0 && ` (${Math.round((Math.min(detailTotal, total) / total) * 100)}%)`}</dd></div>}
            {detailTotal > 0 && <div><dt>세부 안 적음</dt><dd>{krw(unrecorded)}</dd></div>}
            <div><dt>현금으로 낸 돈</dt><dd>{krw(preview.cashPaid)}{cashRecords.length > 0 && ` (${cashRecords.length}건)`}</dd></div>
            {preview.outsideCard > 0 && <div><dt>카드 밖 고정비</dt><dd>{krw(preview.outsideCard)}</dd></div>}
            <div><dt>{upcoming ? '이 달 지출(예상)' : '이 달 지출'}</dt><dd>{krw(preview.cash)}</dd></div>
            {rest !== null && <div><dt>고정 · 비정기</dt><dd>{krw(fixed!)} · {krw(irregularPreview)}</dd></div>}
            {rest !== null && <div><dt>나머지(변동)</dt><dd>{krw(rest)}</dd></div>}
          </dl>
          <p className="acc-note">현금으로 낸 돈은 아래 "자세히 적기"에 "현금"을 붙여 적으면 여기 더해집니다.</p>
          <More label="예시"><p className="acc-note">현금·계좌이체·서울페이로 낸 돈은 칸에 적지 않고, 쓸 때 적습니다(예: 축의금 100000원 현금). 나중에 기억으로 적으면 빠지기 쉽습니다.</p></More>
          {irregular.emergency > 0 && <p className="acc-warn">1년 예산에 없던 비정기 {krw(irregular.emergency)}은 비상금에서 나간 돈으로 봅니다. 변동 지출에는 넣지 않으니, 다음 달 비상금 적립에 더해 채워 넣으세요.</p>}
          {(preview.overCash || preview.overPoint) && <p className="acc-warn">카드 세부 기록이 카드 합계보다 많습니다. 다른 달 기록이 섞였거나 합계를 덜 적었을 수 있어요. 저장은 됩니다.</p>}
          {refunds > 0 && entered.some((s) => s.kind === 'cash') && <p className="acc-note">세부 기록의 돌려받은 돈(환급·캐시백) {krw(refunds)}은 카드 이용금액과 별개라 통장에서 나간 돈을 셀 때 따로 뺍니다.</p>}
          <button type="button" className="acc-primary" onClick={() => void save()} disabled={saving || (!savedMonth && entered.length === 0 && changedIrregular.length === 0)}>{saving ? '저장 중…' : '합계 저장'}</button>
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

function lastDay(month: string) {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
