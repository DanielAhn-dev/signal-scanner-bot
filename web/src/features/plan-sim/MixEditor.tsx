import { useState } from 'react'
import { SIM_ASSETS } from '../../data/simData'
import { normalize, type Weights } from '../../lib/mix'
import { ymText } from '../../lib/sim/period'
import { CLASS_LABEL, CLASS_ORDER, SIM_MIX_PRESETS, presetKeyOf } from './presets'

export type Slot = { uid: number; label: string; weights: Weights }

const NAME_OF = new Map(SIM_ASSETS.map((a) => [a.id, a.name]))

/** "코스피200 50 · S&P500 50" — 합이 100이 아니어도 비율로 보여 준다 */
export function weightsText(w: Weights): string {
  const n = normalize(w)
  return Object.entries(n)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => `${NAME_OF.get(id) ?? id} ${Math.round(v * 100)}`)
    .join(' · ')
}

type Props = {
  name: string
  slot: Slot
  /** 이 구성 하나만 볼 때 쓸 수 있는 첫 달 */
  firstYm: string | null
  onChange: (slot: Slot) => void
  onRemove?: () => void
}

/** 비교 구성 한 줄 — 평소엔 요약만, [바꾸기]를 누르면 예시·자산별 비중 */
export default function MixEditor({ name, slot, firstYm, onChange, onRemove }: Props) {
  const [open, setOpen] = useState(false)
  const total = Object.values(slot.weights).reduce((s, v) => s + Math.max(0, v), 0)
  const presetKey = presetKeyOf(slot.weights)
  const setWeight = (id: string, v: number) => {
    const weights = { ...slot.weights, [id]: v }
    const key = presetKeyOf(weights)
    onChange({ ...slot, weights, label: key ? SIM_MIX_PRESETS.find((p) => p.key === key)!.label : '직접 정한 구성' })
  }

  return (
    <div className={`ps-slot ps-slot--${name}`}>
      <div className="ps-slot-head">
        <span className="ps-slot-name" aria-hidden="true">{name}</span>
        <div className="ps-slot-text">
          <strong>{slot.label}</strong>
          <small>{total > 0 ? weightsText(slot.weights) : '비중을 정해 주세요'}{firstYm ? ` · ${ymText(firstYm)}~` : ''}</small>
        </div>
        <button type="button" className="ps-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '접기' : '바꾸기'}</button>
        {onRemove && <button type="button" className="ps-btn" onClick={onRemove} aria-label={`${name} 구성 빼기`}>빼기</button>}
      </div>
      {open && (
        <div className="ps-slot-body">
          <div className="acc-seg">
            {SIM_MIX_PRESETS.map((p) => (
              <button key={p.key} type="button" className={presetKey === p.key ? 'is-active' : ''}
                onClick={() => onChange({ ...slot, weights: { ...p.weights }, label: p.label })}>
                {p.label}<br /><small>{p.note}</small>
              </button>
            ))}
          </div>
          {CLASS_ORDER.map((cls) => {
            const assets = SIM_ASSETS.filter((a) => a.class === cls)
            if (!assets.length) return null
            return (
              <fieldset key={cls} className="ps-group">
                <legend>{CLASS_LABEL[cls]}</legend>
                {assets.map((a) => (
                  <label key={a.id} className="acc-field mix-slider">
                    <span>{a.name} <b>{slot.weights[a.id] ?? 0}</b> <small className="acc-code">{ymText(a.first)}~{a.priceOnly ? ' · 가격만' : ''}</small></span>
                    <input type="range" min={0} max={100} step={5} value={slot.weights[a.id] ?? 0}
                      onChange={(e) => setWeight(a.id, Number(e.target.value))} />
                  </label>
                ))}
              </fieldset>
            )
          })}
          <p className="acc-note">합계 {Math.round(total)}{total !== 100 && total > 0 ? ' — 100이 아니어도 비율로 환산해 계산합니다.' : ''}</p>
        </div>
      )}
    </div>
  )
}
