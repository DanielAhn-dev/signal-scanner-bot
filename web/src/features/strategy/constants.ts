export const STRATEGY_OPTIONS = [
  {
    id: 'HOLD_SAFE',
    label: '안전 포지션',
    desc: '보수 운용 · 최대 2종목 제한 진입',
    color: 'var(--color-brand)',
  },
  {
    id: 'REDUCE_TIGHT',
    label: '타이트 손절',
    desc: '방어 성향 · 종목별 손절선은 변동성에 따라 넓어짐(기본폭의 최대 2.5배)',
    color: 'var(--color-warning)',
  },
  {
    id: 'WAIT_AND_DIP_BUY',
    label: '저가 매수 대기',
    desc: '현금 보유 · 눌림목 진입 기회 대기',
    color: 'var(--color-success)',
  },
] as const

export const COLOR_POSITIVE = 'var(--color-success)'
export const COLOR_NEGATIVE = 'var(--color-error)'
export const COLOR_WARNING = 'var(--color-warning)'
export const COLOR_POSITIVE_BG = 'var(--color-success-bg)'
export const COLOR_NEGATIVE_BG = 'var(--color-error-bg)'

export const TRIGGER_LABEL_MAP: Record<string, string> = {
  'add-on-buy': '추가 매수',
  'rebalance-buy': '리밸런싱 매수',
  'take-profit-partial': '분할 익절',
  'monday-score-candidate': '월요일 점수 후보 진입',
  'stop-loss': '손절 매도',
  'take-profit-final': '최종 익절',
  'take-profit': '익절 매도',
  'loss-trim': '손실 축소',
  'sector-rotation-sell': '섹터 약세 정리',
  'overweight-trim': '비중 초과 축소',
  'new-buy': '신규 매수',
  'rebalance-sell': '리밸런싱 매도',
  rebalance: '리밸런싱',
  manual: '수동 거래',
}

export const MARKET_REGIME_LABEL_MAP: Record<string, string> = {
  bull: '상승장',
  bear: '하락장',
  bearish: '하락장',
  sideways: '횡보장',
  neutral: '중립',
  risk_off: '리스크 오프',
  risk_on: '리스크 온',
}
