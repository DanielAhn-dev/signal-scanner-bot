import type { ChatContext } from "../routing/types";
import { fetchRecentScanRunDailySummary } from "../../services/scanRunLogService";
import { buildMessage, divider, header, section } from "../messages/layout";

function parseDaysArg(input: string): number {
  const n = Number(String(input ?? "").trim());
  if (!Number.isFinite(n)) return 7;
  return Math.max(3, Math.min(30, Math.floor(n)));
}

export async function handleScanLogCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const days = parseDaysArg(input);

  const rows = await fetchRecentScanRunDailySummary({
    chatId: ctx.chatId,
    days,
  }).catch(() => []);

  if (!rows.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "최근 스캔 로그가 없습니다.\n먼저 /스캔 실행 후 다시 시도해주세요.",
    });
    return;
  }

  const lines = rows.slice(0, 10).map((row) => {
    const filteredPct = Math.round(row.avgFilteredRatio * 100);
    const finalPct = Math.round(row.avgFinalRatio * 100);
    return `${row.date} · 실행 ${row.runCount}회 · 필터통과 ${filteredPct}% · 최종선정 ${finalPct}% · 장중가중치 x${row.avgRealtimeWeight.toFixed(2)}`;
  });

  const message = buildMessage([
    header("스캔 로그", `최근 ${days}일 요약`),
    section("일별 추세", lines),
    divider(),
    "팁: /스캔로그 14 처럼 일수를 주면 더 길게 볼 수 있습니다.",
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}
