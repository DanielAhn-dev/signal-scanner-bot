import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { tg } from "../../src/telegram/api";
import { createWeeklyReportPdf } from "../../src/services/weeklyReportService";

const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const config = {
  maxDuration: 60,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  if (!ADMIN_CHAT_ID) return res.status(500).send("Missing ADMIN_CHAT_ID");

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("tg_id")
      .eq("is_active", true);

    if (usersError) {
      console.error("사용자 조회 실패:", usersError);
    }

    const recipients =
      users && users.length > 0
        ? users.map((u: { tg_id: number }) => Number(u.tg_id)).filter((id) => Number.isFinite(id))
        : [Number(ADMIN_CHAT_ID)];

    let sent = 0;
    let failed = 0;

    for (const chatId of recipients) {
      try {
        const report = await createWeeklyReportPdf(supabase, { chatId });
        const form = new FormData();
        form.set("chat_id", String(chatId));
        form.set("caption", report.caption);
        form.set("document", new Blob([report.bytes], { type: "application/pdf" }), report.fileName);

        const docResp = await tg("sendDocument", form);
        if (!docResp.ok) {
          throw new Error(docResp.description || "sendDocument failed");
        }
        sent++;
      } catch (e: any) {
        failed++;
        const msg = e?.message || String(e);
        console.warn(`주간 리포트 발송 실패 chat_id=${chatId}: ${msg}`);

        await tg("sendMessage", {
          chat_id: chatId,
          text: `주간 PDF 발송에 실패하여 텍스트 요약으로 대체합니다.\n\n${msg}`,
        }).catch(() => {});

        if (String(msg).includes("bot was blocked by the user")) {
          supabase
            .from("users")
            .update({ is_active: false })
            .eq("tg_id", chatId)
            .then(() => {}, () => {});
        }
      }

      await sleep(50);
    }

    console.log(`주간 리포트 발송 완료: 성공 ${sent}명, 실패 ${failed}명`);
    return res.status(200).json({ success: true, sent, failed });
  } catch (error: any) {
    console.error("Weekly Report Error:", error);
    await tg("sendMessage", {
      chat_id: Number(ADMIN_CHAT_ID),
      text: `⚠️ 주간 리포트 생성 실패: ${error.message}`,
    }).catch(() => {});
    return res.status(500).send(error.message);
  }
}
