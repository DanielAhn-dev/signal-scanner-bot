/**
 * 실계좌 "수량·평단 맞추기"로 채운 추정 매수의 메모 표시.
 * 체결가가 그 구간의 평균이라 건별 체결 위치를 보는 분석(가격 차이·추격 등)에는 쓰지 않는다.
 * 수량·평단·손익·예수금 같은 합계는 실제 돈이므로 그대로 센다.
 */
export const BULK_ESTIMATE_MEMO = 'bulk-estimate'

export function isBulkEstimateMemo(memo: string | null | undefined): boolean {
  return String(memo ?? '').trim().startsWith(BULK_ESTIMATE_MEMO)
}
