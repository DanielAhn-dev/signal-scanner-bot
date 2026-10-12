export function signalCls(signal: string): string {
  const u = signal.toUpperCase()
  if (u.includes('BUY')) return 'bt-table-signal bt-table-signal--buy'
  if (u.includes('SELL')) return 'bt-table-signal bt-table-signal--sell'
  if (u.includes('WATCH')) return 'bt-table-signal bt-table-signal--watch'
  return 'bt-table-signal'
}

export function isBuySignal(signal: string | null): boolean {
  if (!signal) return false
  const u = signal.toUpperCase()
  return ['BUY', 'STRONG_BUY', 'ACCUMULATE', '매수'].some((s) => u.includes(s))
}
