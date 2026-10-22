import type { Weights } from '../../lib/mix'
import type { SimAssetClass } from '../../data/simData'

/**
 * 구성 예시 — 섞어보기 예시와 모아가기 1번 예시를 합친 것. 순서는 단순한 것부터(순위 아님).
 * 과거 수익으로 고른 조합은 넣지 않는다(나스닥100 단독 등은 직접 정하기로만).
 */
export const SIM_MIX_PRESETS: Array<{ key: string; label: string; weights: Weights; note: string }> = [
  { key: 'kospi', label: '코스피200만', weights: { kospi200: 100 }, note: '기준선' },
  { key: 'half', label: '국내·해외 반반', weights: { kospi200: 50, sp500: 50 }, note: '코스피200 50 · S&P500 50' },
  { key: 'three', label: '셋 같은 비중', weights: { kospi200: 34, sp500: 33, nasdaq100: 33 }, note: '코스피200 · S&P500 · 나스닥100' },
  { key: 'kospi-bond', label: '코스피200 60 · 국고채 40', weights: { kospi200: 60, kbond10: 40 }, note: '국내 자산만 섞은 안정형' },
  { key: 'domestic-aw', label: '국내형 올웨더 근사', weights: { kospi200: 40, kbond10: 40, gold: 20 }, note: '코스피200 40 · 국고채 40 · 금 20' },
  { key: 'mix4', label: '한국 상장 4종', weights: { kospi200: 30, nasdaq100: 30, kbond10: 25, gold: 15 }, note: '코스피 30 · 나스닥 30 · 국고채 25 · 금 15' },
  { key: 'nps', label: '국민연금형(근사)', weights: { kospi200: 20.8, sp500: 34.7, kbond10: 23.1, usbond20: 7.4 }, note: '대체투자(약 14%)는 뺀 근사' },
  { key: 'us-aw', label: '미국 올웨더 근사', weights: { sp500: 30, usbond20: 55, gold: 15 }, note: '주식 30 · 장기채 55 · 금 15' },
]

export const CLASS_LABEL: Record<SimAssetClass, string> = { equity: '주식', bond: '채권', cash: '현금', gold: '금', reit: '리츠' }
export const CLASS_ORDER: SimAssetClass[] = ['equity', 'bond', 'cash', 'gold', 'reit']

/** 비교 구성 이름 — 색과 함께 그래프·표에서 같은 순서로 쓴다 */
export const SLOT_NAMES = ['A', 'B', 'C'] as const
export const MAX_SLOTS = 3

export function sameWeights(a: Weights, b: Weights): boolean {
  const norm = (w: Weights) => {
    const t = Object.values(w).reduce((s, v) => s + Math.max(0, v), 0)
    return Object.entries(w).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round((v / t) * 1000)] as const).sort()
  }
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

export function presetKeyOf(w: Weights): string | null {
  return SIM_MIX_PRESETS.find((p) => sameWeights(p.weights, w))?.key ?? null
}
