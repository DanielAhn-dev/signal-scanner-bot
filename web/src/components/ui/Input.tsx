import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  textarea?: boolean
}

export default function Input({ label, textarea, className = '', type, onKeyDown, ...rest }: Props) {
  const base = 'ui-input '
  
  // 숫자 입력 필드에서 엔터/탭 키 전파 방지
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (type === 'number' && ['Enter', 'Tab'].includes(e.key)) {
      // number 타입에서 위/아래 화살표 키나 Enter 처리 후 포커스 이동 방지
      if (e.key === 'Enter') {
        e.currentTarget.blur()
      }
    }
    onKeyDown?.(e)
  }
  
  return (
    <div className={`ui-field ${className}`}>
      {label && <label className="ui-label">{label}</label>}
      {textarea ? (
        <textarea className={base + 'ui-textarea'} {...rest as any} />
      ) : (
        <input className={base + 'ui-text'} type={type} onKeyDown={handleKeyDown} {...rest} />
      )}
    </div>
  )
}
