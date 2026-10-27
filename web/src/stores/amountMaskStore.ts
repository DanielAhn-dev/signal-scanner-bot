import { useMemo } from 'react'
import { create } from 'zustand'
import { formatKrw, formatKrwCompact } from '../lib/format'

/** 금액 가리기 — 옆에서 화면이 보여도 금액·손익이 읽히지 않게 한다. 기기마다 기억한다. */
const STORAGE_KEY = 'amount-mask:v1'
export const AMOUNT_MASK = '•••'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

type AmountMaskState = {
  hidden: boolean
  toggle: () => void
}

export const useAmountMaskStore = create<AmountMaskState>((set, get) => ({
  hidden: readStored(),
  toggle: () => {
    const next = !get().hidden
    try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* 저장 불가 환경은 이번 세션만 */ }
    set({ hidden: next })
  },
}))

/** 가리기 상태를 따르는 금액 포맷터. 손익 색(오름·내림)도 가릴 때는 빼야 하니 hidden을 같이 준다. */
export function useAmountMask() {
  const hidden = useAmountMaskStore((s) => s.hidden)
  return useMemo(() => ({
    hidden,
    krw: (value: unknown) => (hidden ? AMOUNT_MASK : formatKrw(value)),
    compact: (value: unknown, options?: { showPositiveSign?: boolean }) => (hidden ? AMOUNT_MASK : formatKrwCompact(value, options)),
    /** 이미 만들어진 문자열(비율·부호 포함 손익 등)을 가릴 때 */
    text: (value: string) => (hidden ? AMOUNT_MASK : value),
    /** 오름·내림 색 클래스는 가릴 때 중립으로 */
    tone: (cls: string) => (hidden ? '' : cls),
  }), [hidden])
}
