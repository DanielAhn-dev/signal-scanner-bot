import React, { useEffect, useRef } from 'react'

interface ModalProps {
  isOpen?: boolean
  open?: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export default function Modal({ isOpen, open, title, onClose, children, size = 'md' }: ModalProps) {
  const modalOpen = isOpen ?? open ?? false
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusedRef = useRef<HTMLElement | null>(null)

  const getFocusableElements = React.useCallback((container: HTMLElement | null): HTMLElement[] => {
    if (!container) return []
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)
  }, [])

  // ESC로 닫기
  useEffect(() => {
    if (!modalOpen) return

    previousFocusedRef.current = document.activeElement as HTMLElement | null
    setTimeout(() => {
      const focusable = getFocusableElements(dialogRef.current)
      focusable[0]?.focus()
    }, 0)

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const nodes = getFocusableElements(dialogRef.current)
      if (nodes.length === 0) {
        e.preventDefault()
        return
      }

      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (!active || active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (!active || active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
      previousFocusedRef.current?.focus()
    }
  }, [getFocusableElements, modalOpen, onClose])

  if (!modalOpen) return null

  const maxW = size === 'sm' ? '28rem' : size === 'lg' ? '48rem' : '36rem'

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="modal" style={{ maxWidth: maxW }} ref={dialogRef}>
        <div className="modal-header">
          <h2 className="modal-title" id="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
