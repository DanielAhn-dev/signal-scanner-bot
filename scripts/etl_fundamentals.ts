import "dotenv/config";
import fs from "fs";
import path from "path";
import { getFundamentalSnapshot } from "../src/services/fundamentalService";
import fundamentalStore, { FundamentalSnapshot as StoreSnapshot } from "../src/services/fundamentalStore";

const args = process.argv.slice(2);
const defaultCodes = ["035420", "005930", "000660", "035720", "207940"];

async function loadAllCodes(limit?: number) {
  const file = path.resolve(__dirname, "../data/all_krx.json");
  try {
    const txt = fs.readFileSync(file, "utf8");
    const all = JSON.parse(txt) as Array<{ code: string }>;
    const codes = all.map((r) => r.code);
    return typeof limit === "number" ? codes.slice(0, limit) : codes;
  } catch (e) {
    console.error("Failed to load all_krx.json, falling back to defaults:", e);
    return defaultCodes;
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

(async () => {
  let codes: string[];
  if (args.includes("--all")) {
    const idx = args.indexOf("--all");
    const maybeLimit = args[idx + 1] || process.env.BATCH_LIMIT;
    const limit = maybeLimit ? Number(maybeLimit) : undefined;
    codes = await loadAllCodes(Number.isFinite(limit) ? limit : undefined);
  } else if (args.length) {
    codes = args;
  } else {
    codes = defaultCodes;
  }

  const chunkSize = 50;
  for (let i = 0; i < codes.length; i += chunkSize) {
    const chunk = codes.slice(i, i + chunkSize);
    const snapshots: StoreSnapshot[] = [];
    for (const code of chunk) {
      try {
        console.log(`Fetching ${code}...`);
        const s = await getFundamentalSnapshot(code);
        const storeRec: StoreSnapshot = {
          code,
          as_of: new Date().toISOString(),
          period_type: "annual",
          period_end: null,
          sales: s.sales ?? null,
          operating_income: s.opIncome ?? null,
          net_income: s.netIncome ?? null,
          cashflow_oper: null,
          cashflow_free: null,
          per: s.per ?? null,
          pbr: s.pbr ?? null,
          roe: s.roe ?? null,
          debt_ratio: s.debtRatio ?? null,
          computed: {
            salesGrowthPct: s.salesGrowthPct ?? null,
            opIncomeGrowthPct: s.opIncomeGrowthPct ?? null,
            netIncomeGrowthPct: s.netIncomeGrowthPct ?? null,
            qualityScore: s.qualityScore ?? null,
            commentary: s.commentary ?? null,
          },
          raw_rows: null,
          source: "naver-scrape",
        };
        snapshots.push(storeRec);
      } catch (e) {
        console.error(`Error fetching ${code}:`, e);
      }
      await sleep(250);
    }

    if (snapshots.length) {
      console.log(`Upserting ${snapshots.length} snapshots...`);
      const res = await fundamentalStore.bulkUpsertFundamentalSnapshots(snapshots);
      if (!res.ok) {
        console.error("Bulk upsert failed:", res.error);
      } else {
        console.log("Chunk upsert OK");
      }
    }
    // short pause between chunks
    await sleep(2000);
  }

  console.log("ETL complete");
})();
