import React from 'react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

export default function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: Props) {
  const base = 'ui-button '
  const vclass = variant === 'primary' ? 'ui-btn-primary' : variant === 'secondary' ? 'ui-btn-secondary' : 'ui-btn-ghost'
  const sizeClass = size === 'sm' ? 'ui-btn-sm' : size === 'lg' ? 'ui-btn-lg' : ''
  return (
    <button className={base + vclass + ' ' + sizeClass + ' ' + className} {...rest}>
      {children}
    </button>
  )
}
