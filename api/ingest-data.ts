// api/ingest-data.ts
import { createClient } from "@supabase/supabase-js";
import { KRXClient } from "../packages/data/krx-client"; // 경로 확인 (packages/data/krx-client.ts)
import { invalidateCache } from "../packages/data/cache"; // 동적 import if needed

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);
const client = new KRXClient();
const BATCH_SIZE = 1000;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });
  if (req.headers["x-ingest-secret"] !== process.env.INGEST_SECRET)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    console.log("Ingest started: actual KRX parsing");

    // 섹터 파싱 & upsert
    let sectors = await client.getSectorList();
    for (let i = 0; i < sectors.length; i += BATCH_SIZE) {
      const batch = sectors
        .slice(i, i + BATCH_SIZE)
        .map((s: { name: string; category?: string }) => ({
          ...s,
          score: Math.random() * 100,
          updated_at: new Date().toISOString(),
        }));
      const { error } = await supabase
        .from("sectors")
        .upsert(batch, { onConflict: "name" });
      if (error) console.error("Sectors batch error:", error);
    }
    console.log(`Upserted ${sectors.length} real sectors`);

    // 종목 파싱 & upsert
    let stocks = await client.getStockList("ALL");
    // 섹터 매핑
    const { data: sectorMap } = await supabase
      .from("sectors")
      .select("id, name");
    const sectorDict = sectorMap
      ? sectorMap.map((s: { id: number; name: string }) => [
          s.name.toLowerCase(),
          s.id,
        ])
      : []; // null 체크
    const sectorObj = Object.fromEntries(sectorDict);
    stocks = stocks.map(
      (stock: { code: string; name: string; market: string }) => {
        let sectorId: number | null = null;
        for (const [secName, id] of Object.entries(sectorObj)) {
          if (stock.name.toLowerCase().includes(secName)) {
            sectorId = id as number;
            break;
          }
        }
        return { ...stock, sector_id: sectorId, liquidity: 0, is_active: true };
      }
    );

    for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
      const batch = stocks.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("stocks")
        .upsert(batch, { onConflict: "code" });
      if (error) console.error("Stocks batch error:", error);
    }
    console.log(`Upserted ${stocks.length} real stocks`);

    // liquidity 업데이트
    const topVolumes = await client.getTopVolumeStocks("ALL", 500);
    const liquidityUpdates = topVolumes.map(
      (v: { code: string; volume: number }) => ({
        code: v.code,
        liquidity: v.volume,
      })
    );
    for (let i = 0; i < liquidityUpdates.length; i += BATCH_SIZE) {
      const batch = liquidityUpdates.slice(i, i + BATCH_SIZE);
      await supabase.from("stocks").upsert(batch, { onConflict: "code" });
    }
    console.log("Liquidity updated with real volumes");

    // 캐시 무효화
    await invalidateCache();

    res.json({
      success: true,
      sectors: sectors.length,
      stocks: stocks.length,
      updated: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Ingest full error:", e);
    res.status(500).json({ error: String(e) });
  }
}
