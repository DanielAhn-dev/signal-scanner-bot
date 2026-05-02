import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  textarea?: boolean
}

export default function Input({ label, textarea, className = '', ...rest }: Props) {
  const base = 'ui-input '
  return (
    <div className={`ui-field ${className}`}>
      {label && <label className="ui-label">{label}</label>}
      {textarea ? (
        <textarea className={base + 'ui-textarea'} {...rest as any} />
      ) : (
        <input className={base + 'ui-text'} {...rest} />
      )}
    </div>
  )
}
