import React from 'react'

export function cardBgStyle(side: string): React.CSSProperties {
  // 토스증권 스타일: 카드는 흰색 유지, 아주 미세한 tint만 (배지/텍스트로 상태 표현)
  if (side === 'BUY') return { background: 'rgba(240, 68, 82, 0.04)' }   // --color-stock-up 4% 투명도
  if (side === 'SELL') return { background: 'rgba(20, 120, 255, 0.04)' }  // --color-stock-down 4% 투명도
  return {}
}

export function sideBadge(side: string) {
  if (side === 'BUY') return <span style={{ color: 'var(--color-positive)', fontWeight: 600 }}>매수</span>
  if (side === 'SELL') return <span style={{ color: 'var(--color-negative)', fontWeight: 600 }}>매도</span>
  return <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>조정</span>
}
