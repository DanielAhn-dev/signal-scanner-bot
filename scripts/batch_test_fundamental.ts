import "dotenv/config";
import { getFundamentalSnapshot } from "../src/services/fundamentalService";
import fs from "fs";
import path from "path";

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

(async () => {
  let codes: string[];
  if (args.includes("--all")) {
    // Optional second arg is limit or env BATCH_LIMIT
    const idx = args.indexOf("--all");
    const maybeLimit = args[idx + 1] || process.env.BATCH_LIMIT;
    const limit = maybeLimit ? Number(maybeLimit) : undefined;
    codes = await loadAllCodes(Number.isFinite(limit) ? limit : undefined);
  } else if (args.length) {
    codes = args;
  } else {
    codes = defaultCodes;
  }

  const results: any[] = [];
  for (const code of codes) {
    try {
      console.log(`Fetching ${code}...`);
      const snapshot = await getFundamentalSnapshot(code);
      console.log(`OK ${code}: sector=${snapshot.sectorName ?? "-"} profile=${snapshot.profileLabel ?? "-"} PER=${snapshot.per ?? "-"} PBR=${snapshot.pbr ?? "-"} ROE=${snapshot.roe ?? "-"} Q=${snapshot.qualityScore}`);
      results.push({ code, snapshot });
    } catch (e) {
      console.error(`Error ${code}:`, e);
      results.push({ code, error: String(e) });
    }
  }
  const outPath = path.resolve(__dirname, "fundamental_results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Saved ${outPath}`);
})();
