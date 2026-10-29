/**
 * 실험 계좌(개별주 몫 100%)는 매매 표본을 모으는 것이 목적이라, 성과·저장 게이트가 '제한'하는 것(슬롯 감소·최소 점수 상향·매수 차단)은 건너뛴다.
 * 2026-10: 하락장 손절이 몰리며 저장 게이트가 '중단 후보'가 되자 신규 매수가 0이 되었고, 매수가 없으니 성과가 회복되지 않아
 * 실험 계좌가 22일 넘게 표본을 못 쌓았다. 게이트가 '완화'하는 방향(슬롯 유지·점수 하향)은 그대로 둔다.
 * 시장 방어 모드·분기 손실 한도·경제 이벤트 중지·데이터 품질 게이트는 이 함수의 대상이 아니다(별도 안전장치).
 */
export type GateResult = { requestedSlots: number; baseMinBuyScore: number; note?: string };

export function bypassGateRestriction<T extends GateResult>(
  before: { requestedSlots: number; baseMinBuyScore: number },
  result: T,
  bypass: boolean
): T {
  if (!bypass) return result;
  const restricts = result.requestedSlots < before.requestedSlots || result.baseMinBuyScore > before.baseMinBuyScore;
  if (!restricts) return result;
  const label = result.note ? result.note.split(":")[0].trim() : "게이트";
  return {
    ...result,
    requestedSlots: before.requestedSlots,
    baseMinBuyScore: before.baseMinBuyScore,
    note: `[실험 모드] ${label} 건너뜀 — 표본 수집 우선`,
  };
}
