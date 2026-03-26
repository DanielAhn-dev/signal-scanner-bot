import "dotenv/config";
import { getFundamentalSnapshot } from "../src/services/fundamentalService";
import fs from "fs";

const args = process.argv.slice(2);
const defaultCodes = ["035420", "005930", "000660", "035720", "207940"];
const codes = args.length ? args : defaultCodes;

(async () => {
  const results: any[] = [];
  for (const code of codes) {
    try {
      console.log(`Fetching ${code}...`);
      const snapshot = await getFundamentalSnapshot(code);
      console.log(`OK ${code}: PER=${snapshot.per ?? "-"} PBR=${snapshot.pbr ?? "-"} ROE=${snapshot.roe ?? "-"} Q=${snapshot.qualityScore}`);
      results.push({ code, snapshot });
    } catch (e) {
      console.error(`Error ${code}:`, e);
      results.push({ code, error: String(e) });
    }
  }
  const outPath = "scripts/fundamental_results.json";
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Saved ${outPath}`);
})();
