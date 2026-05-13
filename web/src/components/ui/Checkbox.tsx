import React from 'react'

type Props = {
  label?: string
  checked?: boolean
  onChange?: (checked: boolean) => void
}

export default function Checkbox({ label, checked, onChange }: Props) {
  return (
    <label className="ui-check-wrap">
      <input className="ui-checkbox" type="checkbox" checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} />
      {label ? <span className="ui-label ui-check-label">{label}</span> : null}
    </label>
  )
}
