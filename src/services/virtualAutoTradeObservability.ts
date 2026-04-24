export type AutoTradeSkipReasonStat = {
  code: string;
  label: string;
  count: number;
};

type ActionLike = {
  skipped: number;
  notes: string[];
};

const SKIP_REASON_LABELS: Record<string, string> = {
  out_of_session: "장중 외 시간 스킵",
  duplicate_window: "동일 실행창 중복 스킵",
  daily_loss_limit: "일손실 한도 도달",
  no_deployable_cash: "투자 가능 현금 없음",
  cash_reserve_floor: "현금 하한 유지",
  insufficient_cash: "현금 부족",
  no_buy_slots: "매수 슬롯 없음",
  other: "기타",
};

export function resolveAutoTradeSkipReasonCode(note: string): string | null {
  const value = String(note || "").trim();
  if (!value) return null;
  if (value.includes("동일 실행창") && value.includes("이미 처리됨")) return "duplicate_window";
  if (value.includes("일손실 한도 도달")) return "daily_loss_limit";
  if (value.includes("투자 가능 현금 0원")) return "no_deployable_cash";
  if (value.includes("현금 하한 유지 구간")) return "cash_reserve_floor";
  if (value.includes("현금 부족으로 매수 스킵")) return "insufficient_cash";
  if (value.includes("매수 슬롯 없음") || value.includes("신규 진입 슬롯 없음") || value.includes("추가 매수 슬롯 없음")) return "no_buy_slots";
  return null;
}

export function buildAutoTradeSkipReasonStats(input: {
  actions: ActionLike[];
  extraReasonCodes?: string[];
}): AutoTradeSkipReasonStat[] {
  const counter = new Map<string, number>();

  for (const code of input.extraReasonCodes ?? []) {
    const key = String(code || "").trim();
    if (!key) continue;
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }

  for (const action of input.actions) {
    if (action.skipped <= 0) continue;
    let matched = false;
    for (const note of action.notes ?? []) {
      const code = resolveAutoTradeSkipReasonCode(note);
      if (!code) continue;
      counter.set(code, (counter.get(code) ?? 0) + 1);
      matched = true;
    }
    if (!matched) {
      counter.set("other", (counter.get("other") ?? 0) + action.skipped);
    }
  }

  return Array.from(counter.entries())
    .map(([code, count]) => ({
      code,
      label: SKIP_REASON_LABELS[code] ?? SKIP_REASON_LABELS.other,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
