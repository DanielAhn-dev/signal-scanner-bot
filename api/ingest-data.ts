// api/ingest-data.ts
import { createClient } from "@supabase/supabase-js";
import { KRXClient } from "../packages/data/krx-client";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);
const krx = new KRXClient();

export default async function handler(req, res) {
  if (
    req.method !== "POST" ||
    req.headers["x-ingest-secret"] !== process.env.INGEST_SECRET
  ) {
    return res.status(401).send("Unauthorized");
  }

  try {
    // 섹터 데이터 수집 및 upsert
    const sectorsData = await krx.getTopSectorsData(20);
    for (const { sector, codes } of sectorsData) {
      const roiData = await krx.getROIForCodes(
        codes.map((c) => c.code),
        180
      ); // 6M ROI 예시
      const metrics = {
        roi_1m: roiData[0]?.roi || 0, // 첫 종목 기준, 평균으로 확장 가능
        roi_3m: roiData[1]?.roi || 0,
        roi_6m: roiData[2]?.roi || 0,
      };
      const score = Math.min(
        metrics.roi_1m * 0.4 + metrics.roi_3m * 0.3 + metrics.roi_6m * 0.3,
        100
      );

      // sectors upsert
      const { error: secError } = await supabase.from("sectors").upsert(
        {
          name: sector,
          category: sector.includes("반도체") ? "IT" : "Other",
          metrics,
          score,
        },
        { onConflict: "name" }
      );
      if (secError) throw secError;

      // stocks upsert (섹터 ID 매핑)
      const { data: sectorRow } = await supabase
        .from("sectors")
        .select("id")
        .eq("name", sector)
        .single();
      for (const item of codes) {
        await supabase.from("stocks").upsert(
          {
            code: item.code,
            name: item.name,
            market: item.code.startsWith("0") ? "KOSPI" : "KOSDAQ",
            sector_id: sectorRow?.id,
            market_cap: 0,
            liquidity: item.volume,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "code" }
        );
      }
    }

    // score 재계산 트리거 (sectors 업데이트)
    await supabase.rpc("recalculate_scores"); // 나중: PostgreSQL 함수로 구현

    res
      .status(200)
      .json({ message: "Ingestion complete", updated: sectorsData.length });
  } catch (e) {
    console.error("Ingestion error:", e);
    res.status(500).json({ error: String(e) });
  }
}
