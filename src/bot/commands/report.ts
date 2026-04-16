import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import {
  createWeeklyReportPdf,
  describeWeeklyReportFailure,
} from "../../services/weeklyReportService";
import { ACTIONS, actionButtons } from "../messages/layout";

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
    text: [
      "리포트 종류를 선택하세요.",
      "종합 리포트는 표지 포함, 개별 리포트는 주제만 PDF로 출력됩니다.",
      "텍스트 명령으로는 /리포트 종합, /리포트 포트폴리오, /리포트 거시, /리포트 수급, /리포트 섹터 형태도 가능합니다.",
    ].join("\n"),
    reply_markup: actionButtons(ACTIONS.reportMenu, 2),
  });
}

export async function handleReportCommand(
  ctx: ChatContext,
  tgSend: any,
  topicInput?: string | null
): Promise<void> {
  const topicLabel = String(topicInput ?? "").trim();

  if (["menu", "메뉴", "선택", "list"].includes(topicLabel.toLowerCase())) {
    await handleReportMenu(ctx, tgSend);
    return;
  }

  const progressLabel = topicLabel ? `${topicLabel} 리포트` : "주간 증시 리포트";

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${progressLabel} PDF 생성 중입니다. 잠시만 기다려주세요...`,
  });

  const startedAt = Date.now();

  try {
    const report = await createWeeklyReportPdf(supabase, {
      chatId: ctx.chatId,
      topic: topicInput,
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
