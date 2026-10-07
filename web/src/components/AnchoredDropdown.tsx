import React, { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  /** 목록이 붙을 기준 요소(입력창 또는 그 래퍼) */
  anchorRef: React.RefObject<HTMLElement | null>
  className?: string
  style?: React.CSSProperties
  maxHeight?: number
  /** 바깥 클릭 판정 등에 쓰는 목록 DOM 참조 */
  dropdownRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}

type Pos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

/**
 * 자동완성 같은 떠 있는 목록을 body에 그려서, 부모의 overflow:hidden·스크롤 영역에 잘리지 않게 한다.
 * 키보드가 올라와 보이는 영역(visualViewport)이 줄면 아래 공간이 모자랄 때 입력창 위로 연다.
 */
export default function AnchoredDropdown({ anchorRef, className, style, maxHeight = 280, dropdownRef, children }: Props) {
  const [pos, setPos] = useState<Pos | null>(null)

  useLayoutEffect(() => {
    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vv = window.visualViewport
      const vvTop = vv?.offsetTop ?? 0
      const vvBottom = vvTop + (vv?.height ?? window.innerHeight)
      const below = vvBottom - rect.bottom - 8
      const above = rect.top - vvTop - 8
      const useBelow = below >= Math.min(160, maxHeight) || below >= above
      setPos(
        useBelow
          ? { left: rect.left, width: rect.width, top: rect.bottom + 4, maxHeight: Math.max(80, Math.min(maxHeight, below)) }
          : { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.max(80, Math.min(maxHeight, above)) }
      )
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [anchorRef, maxHeight])

  if (!pos || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={dropdownRef}
      className={className}
      // 목록을 눌러도 입력창 포커스를 잃지 않게(키보드가 내려가며 목록이 사라지는 것 방지)
      onMouseDown={(e) => e.preventDefault()}
      style={{
        ...style,
        position: 'fixed',
        left: pos.left,
        width: pos.width,
        right: 'auto',
        top: pos.top ?? 'auto',
        bottom: pos.bottom ?? 'auto',
        maxHeight: pos.maxHeight,
        overflowY: 'auto',
        // 모달(.modal-overlay 10020) 안의 입력창에서도 목록이 모달 뒤로 숨지 않게 그보다 위에 둔다
        zIndex: 10030,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
