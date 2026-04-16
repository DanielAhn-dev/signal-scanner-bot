import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import {
  createWeeklyReportPdf,
  describeWeeklyReportFailure,
} from "../../services/weeklyReportService";
import { ACTIONS, actionButtons } from "../messages/layout";

const REPORT_TOPIC_GUIDE = [
  { command: "주간", aliases: ["주간", "종합", "전체", "full", "weekly"], description: "시장과 포트폴리오를 함께 보는 종합 PDF" },
  { command: "포트폴리오", aliases: ["포트폴리오", "관심", "관심종목", "watchlist", "portfolio"], description: "보유 종목과 최근 거래 중심 PDF" },
  { command: "거시", aliases: ["거시", "경제", "매크로", "economy", "macro"], description: "금리·환율·변동성 중심 PDF" },
  { command: "수급", aliases: ["수급", "자금", "flow"], description: "외국인·기관 자금 흐름 PDF" },
  { command: "섹터", aliases: ["섹터", "업종", "테마", "sector"], description: "섹터 강도 랭킹 PDF" },
] as const;

function normalizeReportTopicInput(topicInput?: string | null): string | null {
  const token = String(topicInput ?? "").trim().toLowerCase();
  if (!token) return null;
  if (["menu", "메뉴", "선택", "list", "목록", "도움", "도움말", "help"].includes(token)) {
    return null;
  }

  const found = REPORT_TOPIC_GUIDE.find((item) => item.aliases.some((alias) => alias === token));
  return found?.command ?? "";
}

function buildReportMenuText(): string {
  return [
    "가능한 리포트 종류입니다.",
    "/리포트 는 이 메뉴를 다시 보여줍니다.",
    "/리포트 주간 — 시장 + 포트폴리오 종합 PDF",
    "/리포트 포트폴리오 — 보유 종목/거래 중심 PDF",
    "/리포트 거시 — 금리·환율·변동성 PDF",
    "/리포트 수급 — 외국인·기관 자금 흐름 PDF",
    "/리포트 섹터 — 섹터 강도 랭킹 PDF",
  ].join("\n");
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function handleReportMenu(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: buildReportMenuText(),
    reply_markup: actionButtons(ACTIONS.reportMenu, 2),
  });
}

export async function handleReportCommand(
  ctx: ChatContext,
  tgSend: any,
  topicInput?: string | null
): Promise<void> {
  const normalizedTopic = normalizeReportTopicInput(topicInput);

  if (normalizedTopic === null) {
    await handleReportMenu(ctx, tgSend);
    return;
  }

  if (!normalizedTopic) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "지원하지 않는 리포트 종류입니다.",
        "아래 메뉴에서 가능한 리포트를 선택하세요.",
        "",
        buildReportMenuText(),
      ].join("\n"),
      reply_markup: actionButtons(ACTIONS.reportMenu, 2),
    });
    return;
  }

  const progressLabel = `${normalizedTopic} 리포트`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${progressLabel} PDF 생성 중입니다. 잠시만 기다려주세요...`,
  });

  const startedAt = Date.now();

  try {
    const report = await createWeeklyReportPdf(supabase, {
      chatId: ctx.chatId,
      topic: normalizedTopic,
    });

    console.log("[report] pdf created", {
      chatId: ctx.chatId,
      fileName: report.fileName,
      byteLength: report.bytes.byteLength,
      elapsedMs: Date.now() - startedAt,
    });

    const form = new FormData();
    form.set("chat_id", String(ctx.chatId));
    form.set("caption", report.caption);
    form.set("disable_content_type_detection", "true");
    form.set("document", new Blob([report.bytes], { type: "application/pdf" }), report.fileName);

    const sendResult = await tgSend("sendDocument", form);

    if (!sendResult?.ok) {
      const sendError = sendResult?.description || "Telegram sendDocument failed";
      console.error("[report] sendDocument failed", {
        chatId: ctx.chatId,
        fileName: report.fileName,
        byteLength: report.bytes.byteLength,
        elapsedMs: Date.now() - startedAt,
        error: sendError,
      });
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: [
          `${report.title} PDF 전송에 실패했습니다.`,
          `사유: ${sendError}`,
          "텍스트 요약으로 대체합니다.",
          "",
          report.summaryText,
        ].join("\n"),
      });
      return;
    }

    console.log("[report] completed", {
      chatId: ctx.chatId,
      fileName: report.fileName,
      elapsedMs: Date.now() - startedAt,
    });

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        report.summaryText,
        "",
        "다른 주제 리포트도 바로 생성할 수 있습니다.",
      ].join("\n"),
      reply_markup: actionButtons(ACTIONS.reportMenu, 2),
    });
  } catch (e: any) {
    const detail = describeWeeklyReportFailure(e);
    console.error("[report] generation failed", {
      chatId: ctx.chatId,
      elapsedMs: Date.now() - startedAt,
      error: detail,
      raw: e,
    });
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        `${progressLabel} 생성에 실패했습니다.`,
        `원인: ${detail}`,
        "잠시 후 다시 시도해주세요.",
      ].join("\n"),
    });
  }
}
