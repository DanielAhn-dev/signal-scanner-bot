/**
 * 카드 명세서로 갈아끼울 때 지울 세부 기록.
 * 이전에는 한 결제를 품목별로 쪼개 적은 기록이 많아, 명세서를 붙여넣으면 금액이 달라 중복으로 걸러지지 않고 이중으로 세어진다.
 * 그래서 그 달의 "카드로 낸 일반 지출"을 먼저 지우고 명세서를 붙인다. 아래는 남긴다:
 *  - 현금으로 낸 기록(paidWith=cash): 카드 명세서에 없다
 *  - 환급·포인트(payment이 cash가 아닌 것): 카드 이용금액 합계 밖이다
 *  - 배우자가 적은 기록(mine=false): 내 화면에서 한꺼번에 지우지 않는다
 */
export type BulkEntry = { id: string; mine?: boolean; payment: string; paidWith?: string; amount: number }

export function cardDetailToReplace<T extends BulkEntry>(entries: T[]): T[] {
  return entries.filter((e) => e.mine !== false && e.payment === 'cash' && e.paidWith !== 'cash')
}
