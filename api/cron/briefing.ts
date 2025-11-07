// api/cron-briefing.ts (08:30 브리핑: 실시간 섹터/종목 전송, Supabase 연동)
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID!;

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse
) {
  try {
    // 상위 섹터 + 해당 종목 fetch (실시간 데이터)
    const { data: tops } = await supabase
      .from("sectors")
      .select(
        `
        name, score, category,
        stocks!inner (
          code, name, liquidity
        )
      `
      )
      .order("score", { ascending: false })
      .limit(5)
      .gte("score", 50); // 유망 섹터만

    if (!tops || tops.length === 0) {
      return res.status(200).send("No data for briefing");
    }

    // 메시지 구성: 섹터 점수 + 상위 3종목
    const messageLines = tops
      .map((s: any) => {
        const emoji =
          s.category === "IT"
            ? "💻"
            : s.category === "Energy"
            ? "⚡"
            : s.category === "Healthcare"
            ? "🏥"
            : "📊";
        const sectorLine = `${emoji} ${s.name}: ${s.score.toFixed(1)}점`;
        const stocks = s.stocks
          ?.slice(0, 3)
          .map((st: any) => `${st.name} (${st.code})`) || ["종목 없음"];
        return [sectorLine, `  • 후보: ${stocks.join(", ")}`].join("\n");
      })
      .join("\n\n");

    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: `☀️ 08:30 실시간 브리핑:\n\n${messageLines}\n\n(유동성 상위 기준, 매일 업데이트)`,
      }),
    });
    console.log("Briefing sent successfully");
    res.status(200).send("Briefing sent");
  } catch (e) {
    console.error("Briefing error:", e);
    res.status(500).send(`Error: ${String(e)}`);
  }
}
