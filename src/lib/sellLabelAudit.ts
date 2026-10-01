/**
 * 매도 사유 기록 검산 — 익절(take-profit-*)로 기록됐는데 수수료·세금 뺀 실제 손익이 마이너스인 매도를 찾는다.
 * 익절은 +8%부터 작동하므로 정상이면 나올 수 없다. 2026-10-01 섹터 정리 매도(+0.1%, 실제 −3,181원)가
 * "자동 익절 완료"로 기록됐는데 원장 금액은 맞아서 무결성 점검이 잡지 못했다 — 금액뿐 아니라 사유도 검산한다.
 */
export type SellActionRow = {
  chat_id: number | string;
  code: string | null;
  reason: string | null;
  created_at: string | null;
  detail: Record<string, unknown> | null;
};

export function findMislabeledSells(rows: SellActionRow[]): Array<{ chatId: number; code: string; reason: string; pnl: number; at: string }> {
  const out: Array<{ chatId: number; code: string; reason: string; pnl: number; at: string }> = [];
  for (const row of rows) {
    const reason = String(row.reason ?? "");
    if (reason !== "take-profit-partial" && reason !== "take-profit-final") continue;
    const pnl = Number(row.detail?.pnl);
    if (!Number.isFinite(pnl) || pnl >= 0) continue;
    out.push({ chatId: Number(row.chat_id), code: String(row.code ?? ""), reason, pnl, at: String(row.created_at ?? "").slice(0, 10) });
  }
  return out;
}
