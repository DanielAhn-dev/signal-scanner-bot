import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  textarea?: boolean
}

export default function Input({ label, textarea, className = '', type, onKeyDown, onFocus, ...rest }: Props) {
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
        <input
          className={base + 'ui-text'}
          type={type}
          // iOS가 연락처 자동완성 막대를 띄워 입력칸을 가리지 않게, 숫자칸은 숫자 키패드로
          autoComplete="off"
          inputMode={type === 'number' ? 'decimal' : undefined}
          onFocus={type === 'number' ? (e) => { e.currentTarget.select(); onFocus?.(e) } : onFocus}
          onKeyDown={handleKeyDown}
          {...rest}
        />
      )}
    </div>
  )
}
