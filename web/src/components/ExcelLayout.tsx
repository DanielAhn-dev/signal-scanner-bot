/**
 * ExcelLayout — 3패널 수평 분할 레이아웃
 *
 * Desktop (≥1024px): 3패널 모두 표시, 경계선 드래그 리사이즈
 * Tablet  (640-1023px): 2패널 (좌+중), 우 패널 접힘
 * Mobile  (<640px): 1패널, 탭으로 전환
 *
 * 패널 너비 = flex-basis (%), 드래그로 재조정
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'

export type PanelDef = {
  id: string
  label: string
  /** 초기 너비 비율 (전체 합 100) */
  initialFlex: number
  /** 최소 너비 px */
  minPx?: number
  content: React.ReactNode
  /** 패널 툴바 (상단 패널 제목 줄 우측) */
  toolbar?: React.ReactNode
}

type Props = {
  panels: PanelDef[]
  className?: string
}

const MIN_PX_DEFAULT = 120

export default function ExcelLayout({ panels, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // 각 패널의 flex 비율 (합 = 100)
  const [flexes, setFlexes] = useState<number[]>(() =>
    panels.map(p => p.initialFlex)
  )

  // 모바일에서 활성 패널 인덱스
  const [activePanel, setActivePanel] = useState(0)

  // 현재 화면 폭에 따라 표시할 패널 수
  const [visibleCount, setVisibleCount] = useState<1 | 2 | 3>(3)

  useEffect(() => {
    function update() {
      const w = window.innerWidth
      if (w < 640)       setVisibleCount(1)
      else if (w < 1024) setVisibleCount(2)
      else               setVisibleCount(3)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // ── 드래그 리사이즈 ──────────────────────────────────────────────
  const dragState = useRef<{
    dividerIdx: number   // 드래그 중인 경계 (패널 i와 i+1 사이)
    startX: number
    startFlexes: number[]
    containerWidth: number
  } | null>(null)

  const onDividerMouseDown = useCallback((e: React.MouseEvent, dividerIdx: number) => {
    e.preventDefault()
    const cw = containerRef.current?.getBoundingClientRect().width ?? window.innerWidth
    dragState.current = {
      dividerIdx,
      startX: e.clientX,
      startFlexes: [...flexes],
      containerWidth: cw,
    }
  }, [flexes])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragState.current) return
      const { dividerIdx, startX, startFlexes, containerWidth } = dragState.current
      const dx = e.clientX - startX
      const dFlex = (dx / containerWidth) * 100

      const minFlex1 = ((panels[dividerIdx].minPx ?? MIN_PX_DEFAULT) / containerWidth) * 100
      const minFlex2 = ((panels[dividerIdx + 1].minPx ?? MIN_PX_DEFAULT) / containerWidth) * 100

      const newFlexes = [...startFlexes]
      const newA = Math.max(minFlex1, startFlexes[dividerIdx] + dFlex)
      const newB = Math.max(minFlex2, startFlexes[dividerIdx + 1] - dFlex)

      // 양쪽 합이 원래 합을 유지하도록
      const origSum = startFlexes[dividerIdx] + startFlexes[dividerIdx + 1]
      const clampedA = Math.min(newA, origSum - minFlex2)
      const clampedB = origSum - clampedA

      newFlexes[dividerIdx] = clampedA
      newFlexes[dividerIdx + 1] = clampedB
      setFlexes(newFlexes)
    }

    function onUp() {
      dragState.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    function onMoveStart() {
      if (dragState.current) {
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mousemove', onMoveStart)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mousemove', onMoveStart)
      document.removeEventListener('mouseup', onUp)
    }
  }, [panels])

  // 터치 드래그
  const onDividerTouchStart = useCallback((e: React.TouchEvent, dividerIdx: number) => {
    const cw = containerRef.current?.getBoundingClientRect().width ?? window.innerWidth
    dragState.current = {
      dividerIdx,
      startX: e.touches[0].clientX,
      startFlexes: [...flexes],
      containerWidth: cw,
    }
  }, [flexes])

  // ── 렌더 ─────────────────────────────────────────────────────────
  const displayedPanels = panels.slice(0, visibleCount)

  return (
    <div className={`xls-layout ${className}`} ref={containerRef}>

      {/* 모바일 탭 전환 */}
      {visibleCount === 1 && (
        <div className="xls-layout__mobile-tabs">
          {panels.map((p, i) => (
            <button
              key={p.id}
              className={`xls-layout__mobile-tab${activePanel === i ? ' xls-layout__mobile-tab--active' : ''}`}
              onClick={() => setActivePanel(i)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* 패널들 */}
      {(visibleCount === 1 ? [panels[activePanel]] : displayedPanels).map((panel, localIdx) => {
        const panelIdx = visibleCount === 1 ? activePanel : localIdx
        const isLast = localIdx === displayedPanels.length - 1
        const flex = flexes[panelIdx] ?? panel.initialFlex
        const dividerIdx = panelIdx // 이 패널 오른쪽 경계

        return (
          <React.Fragment key={panel.id}>
            <div
              className="xls-panel-wrap"
              style={{ flex: visibleCount === 1 ? '1 1 100%' : `${flex} 0 0%`, minWidth: panel.minPx ?? MIN_PX_DEFAULT }}
            >
              {/* 패널 헤더 */}
              <div className="xls-panel-header">
                <span className="xls-panel-header__title">{panel.label}</span>
                {panel.toolbar && (
                  <div className="xls-panel-header__toolbar">{panel.toolbar}</div>
                )}
              </div>
              {/* 패널 본체 */}
              <div className="xls-panel-body">
                {panel.content}
              </div>
            </div>

            {/* 리사이즈 핸들 */}
            {!isLast && visibleCount > 1 && (
              <div
                className="xls-divider"
                title="드래그해서 패널 너비 조절"
                onMouseDown={e => onDividerMouseDown(e, dividerIdx)}
                onTouchStart={e => onDividerTouchStart(e, dividerIdx)}
              >
                <div className="xls-divider__bar" />
              </div>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
