import React from 'react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  /** 처리 중 — 버튼을 잠그고 문구를 바꾼다 (예전엔 DOM 속성으로 새어 나가기만 하고 아무 효과가 없었다) */
  loading?: boolean
}

export default function Button({ variant = 'primary', size = 'md', className = '', loading = false, disabled, children, ...rest }: Props) {
  const base = 'ui-button '
  const vclass =
    variant === 'primary' ? 'ui-btn-primary'
      : variant === 'secondary' ? 'ui-btn-secondary'
        : variant === 'danger' ? 'ui-btn-danger'
          : 'ui-btn-ghost'
  const sizeClass = size === 'sm' ? 'ui-btn-sm' : size === 'lg' ? 'ui-btn-lg' : ''
  return (
    <button className={base + vclass + ' ' + sizeClass + ' ' + className} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? '처리 중…' : children}
    </button>
  )
}
