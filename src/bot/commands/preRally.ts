import type { ChatContext } from "../router";
import { esc, fmtPctFixed, LINE } from "../messages/format";
import { getLatestPreRallyReport } from "../../services/preRallyReportService";

function parseHorizonArg(input: string): 20 | 40 | 60 {
  const n = Number((input || "").trim());
  if (n === 20 || n === 40 || n === 60) return n;
  return 40;
}

function fmtMoney(v: number): string {
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

export async function handlePreRallyCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any,
): Promise<void> {
  const horizon = parseHorizonArg(input);
  const loaded = getLatestPreRallyReport(horizon);

  if (!loaded) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        `<b>프리랠리 요약 (${horizon}거래일)</b>`,
        LINE,
        "리포트를 찾지 못했습니다.",
        "운영 서버에서 analyze:pre-rally 실행 후 다시 조회해 주세요.",
      ].join("\n"),
      parse_mode: "HTML",
    });
    return;
  }

  const data = loaded.data;
  const patterns = (data.stablePatterns ?? []).slice(0, 3);
  const principal = 5_000_000;

  const lines: string[] = [
    `<b>프리랠리 요약 (${horizon}거래일)</b>`,
    LINE,
    `리포트: <code>${esc(loaded.fileName)}</code>`,
    `생성시각: ${esc(String(data.generatedAt || "-"))}`,
    `라벨 표본: ${(data.dataset?.labeledRows ?? 0).toLocaleString("ko-KR")}건`,
    `기준 승률(test): ${fmtPctFixed(Number(data.baseline?.testWinRatePct ?? 0), 1)}%`,
    `안정 패턴 수: ${(data.stablePatterns?.length ?? 0).toLocaleString("ko-KR")}개`,
    "",
  ];

  if (!patterns.length) {
    lines.push("안정 패턴이 아직 없습니다.", "분석 기간 확장 또는 데이터 보강 후 재실행이 필요합니다.");
  } else {
    lines.push("<b>상위 안정 패턴 TOP 3</b>");
    patterns.forEach((item, index) => {
      const expected = principal * (item.avgForwardReturnPct / 100);
      lines.push(
        [
          `${index + 1}. <b>${esc(item.name)}</b>`,
          `   승률 ${fmtPctFixed(item.winRatePct, 1)}% · Lift ${fmtPctFixed(item.liftVsBasePct, 1)}% · 샘플 ${item.samples}`,
          `   평균수익 ${fmtPctFixed(item.avgForwardReturnPct, 2)}% · 평균MDD ${fmtPctFixed(item.avgMaxDrawdownPct, 2)}%`,
          `   가정손익(500만원): ${expected >= 0 ? "+" : ""}${fmtMoney(expected)}`,
        ].join("\n"),
      );
    });
  }

  if ((data.notes ?? []).length > 0) {
    lines.push("", `<b>메모</b> ${esc(data.notes!.join(" | "))}`);
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: lines.join("\n"),
    parse_mode: "HTML",
  });
}
