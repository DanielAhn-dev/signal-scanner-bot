import { runVirtualAutoTradingForChat } from "./virtualAutoTradeService";

const SKIP_REASON_KO: Record<string, string> = {
  "insufficient-cash": "현금부족",
  "no-available-cash": "가용현금없음",
  "cash-reserve-floor": "현금하한도달",
  "strategy-blocked-buy": "전략차단",
  "hold-safe-probe": "안전탐색보류",
  "no-candidates": "후보없음",
  "market-policy-filtered": "시장정책필터",
  "daily-loss-limit-reached": "일손실한도",
};

function resolveCurrentRunCause(action: { buys: number; sells: number; skipped: number }, notes: string[]): string {
  if (action.buys + action.sells > 0) return "체결 조건 충족";
  if (notes.some((note) => /일손실 한도 도달/.test(note))) return "일손실 한도 도달";
  if (notes.some((note) => /선택 전략으로 신규 매수 중지|안전 전략 유지|제한 진입|기존 포지션만 관리/.test(note))) {
    return "전략 제한";
  }
  if (notes.some((note) => /투자 가능 현금 0원|현금 하한 유지 구간|현금 부족으로 매수 스킵/.test(note))) {
    return "현금/사이징 제약";
  }
  if (notes.some((note) => /매수 후보 없음|신규 매수 후보 0건/.test(note))) {
    return "후보 점수·신호 미충족";
  }
  return action.skipped > 0 ? "조건 미충족으로 미체결" : "이상 없음";
}

export async function buildAutoCyclePreviewText(chatId: number): Promise<string | null> {
  try {
    const result = await runVirtualAutoTradingForChat({
      chatId,
      mode: "auto",
      dryRun: true,
      ensureEnabled: false,
    });

    const action = result.action;
    const notes = action.notes || [];
    const topReasons = (result.recentMetrics?.topSkipReasons ?? [])
      .slice(0, 2)
      .map((item) => `${SKIP_REASON_KO[item.reason] ?? item.reason} ${item.count}건`)
      .join(" · ");

    const currentCause = resolveCurrentRunCause(action, notes);
    const recentCause = topReasons || "없음";

    return [
      "<b>자동사이클 사전점검</b>",
      `- 결과: 매수 ${action.buys}건 · 매도 ${action.sells}건 · 미체결 ${action.skipped}건 · 오류 ${action.errors}건`,
      `- 이번회차: ${currentCause} · 최근누적: ${recentCause}`,
      "- 실행: 자동 실행 / 강제 진입: 진입 실행",
    ].join("\n");
  } catch {
    return null;
  }
}
