import type { VercelRequest, VercelResponse } from "@vercel/node";

const SECRET = process.env.TELEGRAM_BOT_SECRET!;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const secretHeader = req.headers["x-telegram-bot-api-secret-token"] as string;
  if (!secretHeader || secretHeader !== SECRET) {
    console.error("Invalid secret token");
    return res.status(401).send("Unauthorized");
  }

  const update = req.body;
  const message = update?.message;

  if (!message) {
    return res.status(200).send("OK");
  }

  const text: string = message.text || "";
  const chatId = message.chat.id;
  const userId = message.from.id;

  console.log(`[Telegram] User ${userId} → ${text}`);

  const sendMessage = async (text: string) => {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: "Markdown",
          }),
        }
      );

      const result = await response.json();
      console.log(
        `[Telegram] Message sent:`,
        result.ok ? "SUCCESS" : `FAILED: ${result.description}`
      );
      return result;
    } catch (error) {
      console.error("[Telegram] Failed to send message:", error);
    }
  };

  // 명령어 라우팅
  if (text.startsWith("/start")) {
    await sendMessage(
      `✅ *시그널 스캐너 봇 시작*\n\n` +
        `📊 *사용 가능한 명령어:*\n` +
        `/sector - 상위 섹터 조회\n` +
        `/stocks - 추천 종목 Top 10\n` +
        `/score <종목코드> - 점수 확인\n` +
        `/buy <종목코드> - 매수 타이밍 분석\n\n` +
        `⏰ *자동 알림:*\n` +
        `• 08:30 - 장전 브리핑\n` +
        `• 09:00~15:30 - 실시간 신호\n` +
        `• 15:40 - 마감 요약`
    );
  } else if (text.startsWith("/sector")) {
    await sendMessage("📊 *상위 섹터 분석*\n\n(개발 중...)");
  } else if (text.startsWith("/stocks")) {
    await sendMessage("📈 *추천 종목 Top 10*\n\n(개발 중...)");
  } else if (text.startsWith("/score")) {
    const args = text.split(" ");
    const ticker = args[1];

    if (!ticker) {
      await sendMessage("❌ 사용법: `/score 005930` (삼성전자)");
      return res.status(200).send("OK");
    }

    console.log(`[Telegram] Score request for ${ticker}`);
    await sendMessage("🔍 분석 중...");

    try {
      // 1. 데이터 동기화
      console.log(`[Telegram] Syncing data for ${ticker}`);
      const syncResponse = await fetch(`${BASE_URL}/api/data/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          startDate: "2024-01-01",
          endDate: "2024-10-31",
          useMock: true,
        }),
      });

      const syncData = await syncResponse.json();
      console.log(`[Telegram] Sync result: ${syncData.records} records`);

      // 2. 점수 계산
      console.log(`[Telegram] Calculating score for ${ticker}`);
      const scoreResponse = await fetch(`${BASE_URL}/api/score/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });

      const result = await scoreResponse.json();
      console.log(
        `[Telegram] Score response:`,
        JSON.stringify(result).slice(0, 200)
      );

      if (scoreResponse.ok && result.score !== undefined) {
        const emoji =
          result.signal === "buy"
            ? "🟢"
            : result.signal === "sell"
            ? "🔴"
            : "🟡";
        const message =
          `${emoji} *${ticker} 분석 결과*\n\n` +
          `📊 종합 점수: *${result.score}점*\n` +
          `📈 신호: *${result.signal.toUpperCase()}*\n\n` +
          `*세부 점수:*\n` +
          `• 20일선: ${result.factors.sma20}점\n` +
          `• 50일선: ${result.factors.sma50}점\n` +
          `• 200일선: ${result.factors.sma200}점\n` +
          `• RSI(14): ${result.factors.rsi14}점\n` +
          `• ROC(14): ${result.factors.roc14}점\n` +
          `• AVWAP: ${result.factors.avwap_support}점\n\n` +
          `💡 *추천:* ${result.recommendation}`;

        await sendMessage(message);
      } else {
        await sendMessage(`❌ 분석 실패: ${result.error || "알 수 없는 오류"}`);
      }
    } catch (error) {
      console.error("[Telegram] Score error:", error);
      await sendMessage(
        `❌ 분석 중 오류가 발생했습니다: ${
          error instanceof Error ? error.message : "알 수 없는 오류"
        }`
      );
    }
  } else if (text.startsWith("/buy")) {
    const args = text.split(" ");
    const ticker = args[1];

    if (!ticker) {
      await sendMessage("❌ 사용법: `/buy 005930`");
    } else {
      await sendMessage(`💰 *${ticker} 매수 신호*\n\n(개발 중...)`);
    }
  } else {
    await sendMessage(
      "📱 *사용 가능한 명령어:*\n\n" +
        "/start - 시작\n" +
        "/sector - 섹터 분석\n" +
        "/stocks - 추천 종목\n" +
        "/score <코드> - 점수 확인\n" +
        "/buy <코드> - 매수 신호"
    );
  }

  return res.status(200).send("OK");
}
