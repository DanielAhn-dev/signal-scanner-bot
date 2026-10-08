export function buildAccountKey(brokerName?: string | null, accountName?: string | null): string {
  return `${String(brokerName || '').trim()}|||${String(accountName || '').trim()}`
}

export function accountLabel(brokerName?: string | null, accountName?: string | null): string {
  const broker = String(brokerName || '').trim()
  const account = String(accountName || '').trim()
  const label = [broker, account].filter(Boolean).join(' / ')
  return label || '계좌 미지정'
}

export function isVirtualPositionRow(row: any): boolean {
  // 엄격 기준: 서버가 판정한 account_kind 값만 사용
  return String(row?.account_kind || '').toLowerCase() === 'virtual'
}

export const holdingAccountKey = (r: any) => `${String(r?.broker_name || '').trim()}|||${String(r?.account_name || '').trim()}`
export const holdingValue = (r: any) => Number(r?.quantity || 0) * Number(r?.stock?.close || r?.avg_price || 0)
