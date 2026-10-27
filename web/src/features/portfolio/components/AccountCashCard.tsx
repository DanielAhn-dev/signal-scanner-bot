import { useRef, useState } from 'react'
import Button from '../../../components/ui/Button'
import More from '../../../components/ui/More'
import UnitInput from '../../../components/ui/UnitInput'
import { useToast } from '../../../components/ToastProvider'
import { useAmountMask } from '../../../stores/amountMaskStore'
import type { AccountCashRow } from '../../../../../src/lib/accountCash'

/**
 * 한 계좌 탭: 보유 평가 + 예수금. 수동 입금과 잔액 보정을 분리해 기록한다.
 */
export default function AccountCashCard({ cashKey, holdingValue, row, loaded, onSave, onDeposit }: {
  cashKey: string
  holdingValue: number
  row: AccountCashRow | undefined
  loaded: boolean
  onSave: (key: string, amount: number) => Promise<string | null>
  onDeposit: (key: string, amount: number) => Promise<string | null>
}) {
  const toast = useToast()
  const m = useAmountMask()
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'correction' | 'deposit' | null>(null)
  const [input, setInput] = useState('')
  const amount = row?.amount ?? 0

  const submit = async () => {
    const digits = input.replace(/[^\d]/g, '')
    if (digits === '') { toast.show(mode === 'deposit' ? '입금액을 원 단위 숫자로 적어 주세요.' : '잔액을 원 단위 숫자로 적어 주세요.'); return }
    const value = Number(digits)
    if (mode === 'deposit' && value === 0) { toast.show('입금액은 1원 이상 적어 주세요.'); return }
    if (!mode) return
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const err = mode === 'deposit' ? await onDeposit(cashKey, value) : await onSave(cashKey, value)
    savingRef.current = false
    setSaving(false)
    if (err) { toast.show(`${mode === 'deposit' ? '입금을 저장' : '잔액 보정을 저장'}하지 못했습니다: ${err}`, 6000); return }
    setMode(null)
    toast.show(mode === 'deposit' ? `${value.toLocaleString('ko-KR')}원을 이 계좌에 입금했습니다.` : `예수금을 ${value.toLocaleString('ko-KR')}원으로 보정했습니다.`)
  }

  return (
    <div className="card mb-4 portfolio-account-cash">
      <div className="portfolio-account-cash-row">
        <span>보유 평가 <strong>{m.compact(holdingValue)}</strong></span>
        <span>
          예수금 <strong>{loaded ? m.text(`${amount.toLocaleString('ko-KR')}원`) : '…'}</strong>
        </span>
        {!mode && (
          <>
            <Button size="sm" variant="secondary" onClick={() => { setInput(amount > 0 ? amount.toLocaleString('ko-KR') : ''); setMode('correction') }}>
              잔액 보정
            </Button>
            <Button size="sm" onClick={() => { setInput(''); setMode('deposit') }}>
              입금 기록
            </Button>
          </>
        )}
      </div>
      {row?.checkedAt ? (
        <div className="caption muted">
          마지막 잔액 보정 {row.checkedAt}
          {row.sinceCheck != null && row.sinceCheck !== 0 && ` · 이후 매매·분배금·입금으로 ${row.sinceCheck > 0 ? '+' : ''}${row.sinceCheck.toLocaleString('ko-KR')}원 반영`}
        </div>
      ) : loaded && (
        <div className="caption muted">아직 실제 잔액을 보정하지 않았습니다. 증권사 앱의 예수금으로 맞추면 이후 매매·분배금 기록이 자동으로 더하고 뺍니다.</div>
      )}
      {row?.activity.length ? (
        <More label="수동 입금·보정 내역">
          <ul className="caption muted" style={{ margin: 'var(--space-2) 0', paddingLeft: '1.25rem' }}>
            {[...row.activity].reverse().slice(0, 10).map((entry, index) => (
              <li key={`${entry.at}-${entry.kind}-${index}`}>
                {entry.at} · {entry.kind === 'deposit' ? '입금' : '잔액 보정'} {entry.delta > 0 ? '+' : ''}{entry.delta.toLocaleString('ko-KR')}원
                {' · '}잔액 {entry.before.toLocaleString('ko-KR')} → {entry.after.toLocaleString('ko-KR')}원
              </li>
            ))}
          </ul>
        </More>
      ) : null}
      {mode && (
        <div className="portfolio-account-cash-row" style={{ marginTop: 'var(--space-2)' }}>
          <UnitInput
            unit="원" width={160} inputMode="numeric" placeholder="0"
            aria-label={mode === 'deposit' ? '입금액(원)' : '보정 후 예수금(원)'}
            autoFocus
            value={input}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, '')
              setInput(digits ? Number(digits).toLocaleString('ko-KR') : '')
            }}
          />
          <Button size="sm" onClick={() => void submit()} disabled={saving}>{saving ? '저장 중…' : mode === 'deposit' ? '입금 저장' : '보정 저장'}</Button>
          <Button size="sm" variant="secondary" onClick={() => setMode(null)} disabled={saving}>취소</Button>
        </div>
      )}
      <More label="예수금은 어떻게 바뀌나요">
        <p className="caption muted">
          잔액 보정은 증권사 앱의 현재 잔액으로 맞추고 차액을 보정 내역에 남깁니다. 입금 기록은 입력한 금액만 이 계좌 예수금에 더합니다.
          매수·매도와 받은 분배금은 기록하면 자동 반영되므로 같은 분배금을 입금 기록으로 다시 더하지 마세요.
          CMA 이자·이벤트 지급은 잔액 보정으로 맞추거나 입금 기록으로 따로 더해 주세요. 리밸런싱 가이드는 예수금을 읽기만 합니다.
        </p>
      </More>
    </div>
  )
}
