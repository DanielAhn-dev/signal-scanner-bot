import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getCachedOHLCV } from "../../packages/data/cache";
import { calculateScore } from "../../packages/scoring/engine";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { ticker } = req.body;

  if (!ticker) {
    return res.status(400).json({ error: "Missing ticker" });
  }

  try {
    console.log(`[Score] Calculating score for ${ticker}`);

    // 🔥 고정된 날짜 범위 사용 (Mock 데이터와 일치)
    const startDate = "2024-01-01";
    const endDate = "2024-10-31";

    const data = await getCachedOHLCV(ticker, startDate, endDate);

    console.log(`[Score] Found ${data.length} records for ${ticker}`);

    if (data.length === 0) {
      return res.status(404).json({
        error: "No data found. Please sync data first.",
        hint: `POST /api/data/sync with {"ticker":"${ticker}","startDate":"${startDate}","endDate":"${endDate}","useMock":true}`,
      });
    }

    const score = calculateScore(data);

    if (!score) {
      return res.status(400).json({
        error: "Insufficient data for scoring",
        records: data.length,
        required: 200,
      });
    }

    console.log(`[Score] Score: ${score.score}, Signal: ${score.signal}`);

    return res.status(200).json(score);
  } catch (error) {
    console.error("[Score] Error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
