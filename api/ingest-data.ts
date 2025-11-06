// api/ingest-data.ts (이전 수정 + 로그)
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { KRXClient } from "../packages/data/krx-client";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);
const krx = new KRXClient();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (
    req.method !== "POST" ||
    req.headers["x-ingest-secret"] !== process.env.INGEST_SECRET
  ) {
    return res.status(401).send("Unauthorized");
  }

  try {
    // 섹터 데이터 수집 및 upsert
    const sectorsData = await krx.getTopSectorsData(20);
    console.log("Fetched sectors data: " + sectorsData.length); // 로그
    let updatedCount = 0;
    for (const { sector, codes } of sectorsData) {
      const roiData = await krx.getROIForCodes(
        codes.map((c) => c.code),
        180
      );
      const metrics = {
        roi_1m: roiData[0]?.roi || 0,
        roi_3m: roiData[1]?.roi || 0,
        roi_6m: roiData[2]?.roi || 0,
      };
      const score = Math.min(
        metrics.roi_1m * 0.4 + metrics.roi_3m * 0.3 + metrics.roi_6m * 0.3,
        100
      );

      // sectors upsert
      const { error: secError, count } = await supabase.from("sectors").upsert(
        {
          name: sector,
          category: sector.includes("반도체") ? "IT" : "Other",
          metrics,
          score,
        },
        { onConflict: "name" }
      );
      if (secError) {
        console.error(
          "Sector upsert error for " + sector + ": " + secError.message
        );
        continue;
      }
      updatedCount += count || 1;
      console.log("Upserted sector: " + sector + ", score: " + score);

      // stocks upsert
      const { data: sectorRow } = await supabase
        .from("sectors")
        .select("id")
        .eq("name", sector)
        .single();
      if (!sectorRow) continue;
      for (const item of codes.slice(0, 10)) {
        // 상위 10개만
        const { error: stockError } = await supabase.from("stocks").upsert(
          {
            code: item.code,
            name: item.name,
            market: item.code.startsWith("0") ? "KOSPI" : "KOSDAQ",
            sector_id: sectorRow.id,
            market_cap: 0,
            liquidity: item.volume,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "code" }
        );
        if (stockError)
          console.error("Stock upsert error: " + stockError.message);
      }
    }

    // score 재계산 (RPC 또는 직접 업데이트, 임시 스킵)
    // await supabase.rpc("recalculate_scores");

    res
      .status(200)
      .json({
        message: "Ingestion complete",
        updated: updatedCount,
        totalSectors: sectorsData.length,
      });
  } catch (e) {
    console.error("Ingestion error:", e);
    res.status(500).json({ error: String(e) });
  }
}
