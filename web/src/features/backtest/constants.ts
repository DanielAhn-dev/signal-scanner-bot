export const ANALYZE_PENDING_CODE_KEY = 'analyze_pending_code'
export const BACKTEST_PENDING_CODE_KEY = 'backtest_pending_code'
export const EXECUTION_GUIDE_PENDING_KEY = 'execution_guide_pending_v1'

export const HORIZONS = [20, 40, 60, 90, 120] as const
export const DEFAULT_VISIBLE_HORIZONS = [20, 40, 60] as const
export const EXTENDED_HORIZONS = [90, 120] as const
export type Horizon = typeof HORIZONS[number]

export const STEPS = ['종목 수집', '이벤트 탐색', '특징 분석', '결과 계산']
export const STEP_THRESHOLDS = [4, 10, 18, 26]
export const TOTAL_SECONDS = 30
