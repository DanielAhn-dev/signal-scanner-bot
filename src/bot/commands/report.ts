import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { createWeeklyReportPdf } from "../../services/weeklyReportService";

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

  try {
    const report = await createWeeklyReportPdf(supabase, { chatId: ctx.chatId });

    const form = new FormData();
    form.set("chat_id", String(ctx.chatId));
    form.set("caption", report.caption);
    form.set("disable_content_type_detection", "true");
    form.set("document", new Blob([report.bytes], { type: "application/pdf" }), report.fileName);

    const sendResult = await tgSend("sendDocument", form);

    if (!sendResult?.ok) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: `PDF 전송에 실패하여 텍스트 요약으로 대체합니다.\n\n${report.summaryText}`,
      });
      return;
    }
  } catch (e: any) {
    console.error("report command error:", e);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "리포트 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
}
