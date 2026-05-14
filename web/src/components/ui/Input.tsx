import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  textarea?: boolean
}

export default function Input({ label, textarea, className = '', type, onKeyDown, ...rest }: Props) {
  const base = 'ui-input '
  
  // 숫자 입력 필드에서 키 이벤트 처리
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 기본 동작만 수행, blur()는 호출하지 않음
    // (수정 중 포커스가 자동 해제되는 것을 방지)
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
