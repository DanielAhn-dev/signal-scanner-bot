import type { ChatContext } from "../routing/types";
import { generateAutoTradeDiagnosticReport } from "../../services/virtualAutoTradeService";

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function fmtPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export async function handleAutoReportCommand(
  ctx: ChatContext,
  tgSend: (...args: unknown[]) => Promise<unknown>
): Promise<void> {
  const chatId = ctx.chatId;

  await tgSend("sendMessage", {
    chat_id: chatId,
    text: "자동매매 진단 리포트를 생성 중입니다...",
  });

  let report;
  try {
    report = await generateAutoTradeDiagnosticReport(chatId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await tgSend("sendMessage", {
      chat_id: chatId,
      text: `리포트 생성 실패: ${message}`,
    });
    return;
  }

  const lines: string[] = [];
  const { metrics, backtest, settings, holdingCount, availableCash, marketMode, marketModeReason } =
    report;

  // ── 실행 현황 ──────────────────────────────────────────────
  lines.push("[자동매매 진단 리포트] — 최근 7일");
  lines.push("");
  lines.push("■ 실행 현황");
  if (metrics) {
    lines.push(
      `- 총 실행: ${metrics.runCount}회 (활성일: ${metrics.activeDays}일)`
    );
    lines.push(
      `- 매수: ${metrics.buyActions}건 | 매도: ${metrics.sellActions}건 | 건너뜀: ${metrics.skipActions}건 | 오류: ${metrics.errorActions}건`
    );
  } else {
    lines.push("- 실행 데이터 없음");
  }

  // ── 건너뜀 주요 원인 ────────────────────────────────────────
  if (metrics && metrics.topSkipReasons.length > 0) {
    lines.push("");
    lines.push("■ 건너뜀 주요 원인");
    for (const item of metrics.topSkipReasons) {
      lines.push(`- ${item.reason}: ${item.count}건`);
    }
  }

  // ── 손익 현황 (3개월) ────────────────────────────────────────
  lines.push("");
  lines.push("■ 손익 현황 (최근 3개월)");
  if (backtest && backtest.sellTrades > 0) {
    lines.push(`- 매도 체결: ${backtest.sellTrades}건`);
    lines.push(`- 승률: ${fmtPct(backtest.winRatePct)}`);
    lines.push(
      `- 손익비(PF): ${backtest.profitFactor > 0 ? backtest.profitFactor.toFixed(2) : "—"}`
    );
    lines.push(
      `- 평균 수익: +${fmtKrw(backtest.avgWin)} | 평균 손실: -${fmtKrw(backtest.avgLoss)}`
    );
    lines.push(
      `- 실현 손익 합계: ${backtest.realizedPnl >= 0 ? "+" : ""}${fmtKrw(backtest.realizedPnl)}`
    );
  } else {
    lines.push("- 매도 이력 없음");
  }

  // ── 현재 포지션 ─────────────────────────────────────────────
  lines.push("");
  lines.push("■ 현재 포지션");
  lines.push(`- 보유: ${holdingCount}종목`);
  lines.push(`- 가용현금: ${fmtKrw(availableCash)}`);
  const modeLabel =
    marketMode === "large-cap-defense"
      ? "대형주 방어"
      : marketMode === "rotation"
      ? "로테이션"
      : "균형";
  lines.push(`- 시장 모드: ${modeLabel}`);
  if (marketModeReason) {
    lines.push(`  (${marketModeReason})`);
  }

  // ── 자동매매 설정 ─────────────────────────────────────────────
  lines.push("");
  lines.push("■ 자동매매 설정");
  if (settings) {
    lines.push(`- 자동매매: ${settings.isEnabled ? "ON" : "OFF"}`);
    lines.push(`- 섀도우 모드: ${settings.isShadow ? "ON (실제 체결 없음)" : "OFF"}`);
    lines.push(`- 진입 기준 점수: ${settings.minBuyScore}점`);
    lines.push(`- 손절: -${fmtPct(settings.stopLossPct)} | 익절: +${fmtPct(settings.takeProfitPct)}`);
  } else {
    lines.push("- 설정 정보 없음 (자동매매 미설정)");
  }

  await tgSend("sendMessage", {
    chat_id: chatId,
    text: lines.join("\n"),
  });
}
