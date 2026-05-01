import React from 'react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
}

export default function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  const base = 'ui-button '
  const vclass = variant === 'primary' ? 'ui-btn-primary' : variant === 'secondary' ? 'ui-btn-secondary' : 'ui-btn-ghost'
  return (
    <button className={base + vclass + ' ' + className} {...rest}>
      {children}
    </button>
  )
}
