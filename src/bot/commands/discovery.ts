import type { ChatContext } from "../router";
import { discoverMultibaggerCandidates } from "../../services/discoveryService";
import { esc, fmtInt, fmtPctFixed, LINE } from "../messages/format";
import {
  actionButtons,
  ACTIONS,
  buildRecommendationActionButtons,
  type RecommendationActionTarget,
} from "../messages/layout";

function fmtEok(v: number): string {
  const eok = Math.round(v / 100_000_000);
  return `${eok.toLocaleString("ko-KR")}억`;
}

export async function handleDiscoveryCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const parsed = Number((input || "").trim());
  const topN = Number.isFinite(parsed) ? Math.max(5, Math.min(30, Math.floor(parsed))) : 20;

  const picks = await discoverMultibaggerCandidates(topN);
  if (!picks.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>발굴 결과가 없습니다.</b>",
        LINE,
        "필터: PBR &lt; 2.0, ROE &gt; 8%, 시총 500억+, 최근 2분기 성장",
        "재무/수급 데이터 적재 상태를 점검해 주세요.",
      ].join("\n"),
      parse_mode: "HTML",
    });
    return;
  }

  const lines: string[] = [
    `<b>파이어족 12억 멀티배거 발굴 TOP ${topN}</b>`,
    LINE,
    "필터: PBR&lt;2.0 · ROE&gt;8% · 시총500억+ · 최근2분기 성장",
    "",
  ];

  const targets: RecommendationActionTarget[] = [];

  picks.forEach((p, idx) => {
    const smartRatio = p.smartMoneyRatioPct != null ? `${fmtPctFixed(p.smartMoneyRatioPct, 2)}` : "-";
    lines.push(
      [
        `${idx + 1}. <b>${esc(p.name)}</b> <code>${p.code}</code> · <b>${p.score.totalScore.toFixed(1)}점</b>`,
        `   가치 ${p.score.valueScore.toFixed(1)} | 모멘텀 ${p.score.momentumScore.toFixed(1)} | 수급 ${p.score.smartMoneyScore.toFixed(1)} | 섹터 ${p.score.sectorScore.toFixed(1)}`,
        `   PBR ${p.pbr?.toFixed(2) ?? "-"} · ROE ${p.roe?.toFixed(1) ?? "-"}% · PER ${p.per?.toFixed(1) ?? "-"}`,
        `   매출QoQ ${fmtPctFixed(Number(p.revQoq ?? 0), 1)} · 영익QoQ ${fmtPctFixed(Number(p.opQoq ?? 0), 1)} · 12주 수급 ${fmtEok(p.smartMoney12w)} (${smartRatio})`,
        `   시총 ${fmtEok(p.marketCap)}`,
      ].join("\n")
    );

    if (idx < 6) {
      targets.push({
        code: p.code,
        label: `${idx + 1}위 ${p.name}`,
      });
    }
  });

  lines.push("", LINE, "버튼으로 종목 상세 분석을 이어가세요.");

  const buttons = buildRecommendationActionButtons(targets, [
    ...ACTIONS.recommendationFollowupCompact,
    { text: "다시 발굴", callback_data: "cmd:discovery" },
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: lines.join("\n"),
    parse_mode: "HTML",
    reply_markup: actionButtons(buttons, 2),
  });
}
