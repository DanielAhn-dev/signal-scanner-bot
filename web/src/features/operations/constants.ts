// 이벤트 → 한국어
export const EVENT_LABEL_MAP: Record<string, string> = {
  'new-buy': '신규 매수',
  'add-on-buy': '추가 매수',
  'take-profit': '익절 매도',
  'take-profit-partial': '일부 익절',
  'stop-loss': '손절 매도',
  'rebalance': '리밸런싱',
  'rebalance-sell': '리밸런싱 매도',
  'rebalance-buy': '리밸런싱 매수',
  'manual': '수동 거래',
  'legacy': '수동 거래',
}

// 전략 ID → 한국어
export const STRATEGY_LABEL_MAP: Record<string, string> = {
  'core.autotrade.v1': '자동매매',
  'core.plan.v1': '관심종목 계획',
  'ops.adjustment.v1': '수동 조정',
  'legacy.unknown': '기타',
}
