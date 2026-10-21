import { useRef, useState } from 'react'
import Button from '../../../components/ui/Button'
import More from '../../../components/ui/More'
import UnitInput from '../../../components/ui/UnitInput'
import { useToast } from '../../../components/ToastProvider'
import { formatKrwCompact } from '../../../lib/format'
import type { AccountCashRow } from '../../../../../src/lib/accountCash'

/**
 * 한 계좌 탭: 보유 평가 + 예수금. 예수금은 증권사 앱의 실제 잔액으로 고친다.
 * '적은 뒤 자동 반영'은 마지막으로 적은 값 이후 매수·매도·분배금 기록이 더하고 뺀 몫 — 앱 값과 실제가 어긋날 때 원인을 찾게 한다.
 */
export default function AccountCashCard({ cashKey, holdingValue, row, loaded, onSave }: {
  cashKey: string
  holdingValue: number
  row: AccountCashRow | undefined
  loaded: boolean
  onSave: (key: string, amount: number) => Promise<string | null>
}) {
  const toast = useToast()
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const amount = row?.amount ?? 0

  const submit = async () => {
    const digits = input.replace(/[^\d]/g, '')
    if (digits === '') { toast.show('잔액을 원 단위 숫자로 적어 주세요.'); return }
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const err = await onSave(cashKey, Number(digits))
    savingRef.current = false
    setSaving(false)
    if (err) { toast.show(`예수금을 저장하지 못했습니다: ${err}`, 6000); return }
    setEditing(false)
    toast.show(`예수금을 ${Number(digits).toLocaleString('ko-KR')}원으로 맞췄습니다.`)
  }

  return (
    <div className="card mb-4 portfolio-account-cash">
      <div className="portfolio-account-cash-row">
        <span>보유 평가 <strong>{formatKrwCompact(holdingValue)}</strong></span>
        <span>
          예수금 <strong>{loaded ? `${amount.toLocaleString('ko-KR')}원` : '…'}</strong>
        </span>
        {!editing && (
          <Button size="sm" variant="secondary" onClick={() => { setInput(amount > 0 ? amount.toLocaleString('ko-KR') : ''); setEditing(true) }}>
            예수금 고치기
          </Button>
        )}
      </div>
      {row?.checkedAt ? (
        <div className="caption muted">
          마지막으로 적은 날 {row.checkedAt}
          {row.sinceCheck != null && row.sinceCheck !== 0 && ` · 그 뒤 매매·분배금 기록으로 ${row.sinceCheck > 0 ? '+' : ''}${row.sinceCheck.toLocaleString('ko-KR')}원 반영`}
        </div>
      ) : loaded && (
        <div className="caption muted">아직 실제 잔액을 적지 않았습니다. 증권사 앱의 예수금을 적어 두면 매매·분배금 기록이 자동으로 더하고 뺍니다.</div>
      )}
      {editing && (
        <div className="portfolio-account-cash-row" style={{ marginTop: 'var(--space-2)' }}>
          <UnitInput
            unit="원" width={160} inputMode="numeric" placeholder="0" aria-label="실제 예수금(원)" autoFocus
            value={input}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, '')
              setInput(digits ? Number(digits).toLocaleString('ko-KR') : '')
            }}
          />
          <Button size="sm" onClick={() => void submit()} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={saving}>취소</Button>
        </div>
      )}
      <More label="예수금은 어떻게 바뀌나요">
        <p className="caption muted">
          이 화면에서 매수·매도를 기록하거나 리밸런싱 가이드에 받은 분배금을 적으면 이 계좌 예수금에서 자동으로 빼고 더합니다.
          CMA 이자·이벤트 적립처럼 앱이 모르는 소액은 반영되지 않으니, 가끔 증권사 앱의 잔액으로 다시 맞춰 주세요. 리밸런싱 가이드는 이 값을 읽기만 합니다.
        </p>
      </More>
    </div>
  )
}
