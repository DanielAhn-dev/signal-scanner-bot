/**
 * 사용자가 직접 바꾼 자동매매 설정(켜기·끄기, 방식 전환, 매매 기준)을 서버에 남긴다 — 가설 H16(수동 개입의 비용) 측정용.
 * 그때의 보유는 virtual_trades 이력으로 다시 만들 수 있으므로 시각과 바뀐 값만 기록한다.
 * virtual_autotrade_actions에 run_id 없이 action_type 'HOLD', reason 'user-…'로 넣는다. 봇 지표 집계는 'user-' 행을 뺀다.
 * 기록 실패는 설정 저장을 막지 않는다.
 */
export const USER_DECISION_REASON_PREFIX = 'user-'

export async function logUserDecision(
  supabase: { from: (table: string) => any },
  chatId: number,
  kind: 'settings' | 'mode-switch',
  detail: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('virtual_autotrade_actions').insert({
      run_id: null,
      chat_id: chatId,
      code: null,
      action_type: 'HOLD',
      reason: `${USER_DECISION_REASON_PREFIX}${kind}`,
      detail,
    })
  } catch {
    /* 기록은 부가 기능 */
  }
}

/** 이전·새 설정에서 실제로 바뀐 항목만 { 이름: [이전, 새] }로 */
export function changedFields(prev: Record<string, unknown> | null | undefined, next: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || k === 'chat_id') continue
    const before = prev?.[k] ?? null
    if (String(before) !== String(v)) out[k] = [before, v]
  }
  return out
}
