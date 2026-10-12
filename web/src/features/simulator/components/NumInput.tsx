import React from 'react'

export default function NumInput({
  label, value, onChange, min, max, step, suffix,
}: {
  label: string
  value: number | string
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <div className="sim-input-group">
      <label className="sim-input-label">{label}</label>
      <div className="sim-input-row">
        <input
          className="sim-input"
          type="number"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value || 0))}
        />
        {suffix && <span className="sim-input-suffix">{suffix}</span>}
      </div>
    </div>
  )
}
