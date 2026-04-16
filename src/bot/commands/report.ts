import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import {
  createWeeklyReportPdf,
  describeWeeklyReportFailure,
} from "../../services/weeklyReportService";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function handleReportCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "주간 리포트 PDF 생성 중입니다. 잠시만 기다려주세요...",
  });

  const startedAt = Date.now();

  try {
    const report = await createWeeklyReportPdf(supabase, { chatId: ctx.chatId });

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
          "주간 리포트 PDF 전송에 실패했습니다.",
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
        "리포트 생성에 실패했습니다.",
        `원인: ${detail}`,
        "잠시 후 다시 시도해주세요.",
      ].join("\n"),
    });
  }
}
