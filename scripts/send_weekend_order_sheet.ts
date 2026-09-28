/**
 * 금요일 배치 후 다음 주 주문표 발송 — 자동매매가 켜진 계정마다 눌림목 PDF + 텍스트 주문표.
 *   pnpm exec tsx scripts/send_weekend_order_sheet.ts            # 미리보기 (발송 안 함)
 *   pnpm exec tsx scripts/send_weekend_order_sheet.ts --telegram # 텔레그램 발송
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createWeeklyReportPdf } from "../src/services/weeklyReportService";
import { buildOrderSheetLines, formatOrderSheetText } from "../src/services/weekendOrderSheet";
import { sendDocument, tg } from "../src/telegram/api";
import { isKrxTradingDate, previousKrxTradingDate, toKstDateKey } from "../src/lib/krxCalendar";

/** 전략 경쟁 측정이 다음 주에 체결을 재현하도록 주문표를 Storage에 남긴다 (market_snapshot.py와 같은 버킷) */
const SHEET_BUCKET = "market-snapshots";

const SEND = process.argv.includes("--telegram");

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: settings, error } = await supabase
    .from("virtual_autotrade_settings")
    .select("chat_id")
    .eq("is_enabled", true);
  if (error) throw new Error(`settings 조회 실패: ${error.message}`);
  const chatIds = (settings ?? []).map((r: { chat_id: number }) => Number(r.chat_id)).filter(Number.isFinite);

  const today = toKstDateKey();
  const asof = isKrxTradingDate(today) ? today : previousKrxTradingDate(today);
  let saved = false;

  for (const chatId of chatIds) {
    const report = await createWeeklyReportPdf(supabase, { chatId, topic: "pullback" });
    const lines = buildOrderSheetLines((report.pullbackCandidates ?? []) as any[]);
    const text = formatOrderSheetText({
      dateLabel: report.pullbackMeta?.rangeLabel ?? "-",
      cashLabel: report.pullbackMeta?.availableCashLabel ?? "-",
      lines,
    });
    console.log(`\n=== chat ${chatId} ===\n${text}`);
    if (!SEND) continue;
    if (!saved) {
      // 첫 계정 주문표 하나만 저장 — 측정은 종목·가격만 쓰고 비중은 균등이라 계정별 수량 차이는 무관
      const { error: upErr } = await supabase.storage
        .from(SHEET_BUCKET)
        .upload(`order-sheets/${asof}.json`, JSON.stringify({ asof, lines }), {
          upsert: true,
          contentType: "application/json",
        });
      if (upErr) console.warn(`주문표 저장 실패: ${upErr.message}`);
      else saved = true;
    }
    const doc = await sendDocument({ chat_id: chatId, bytes: report.bytes, filename: report.fileName, caption: report.caption });
    if (!doc.ok) console.warn(`PDF 발송 실패 chat=${chatId}: ${doc.description}`);
    const msg = await tg("sendMessage", { chat_id: chatId, text });
    if (!msg.ok) console.warn(`주문표 발송 실패 chat=${chatId}: ${msg.description}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
