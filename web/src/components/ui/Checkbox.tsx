import React from 'react'

type Props = {
  label?: string
  checked?: boolean
  onChange?: (checked: boolean) => void
}

export default function Checkbox({ label, checked, onChange }: Props) {
  return (
    <label style={{display:'flex', alignItems:'center', gap:8}}>
      <input className="ui-checkbox" type="checkbox" checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} />
      {label ? <span className="ui-label" style={{margin:0}}>{label}</span> : null}
    </label>
  )
}
