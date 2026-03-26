import "dotenv/config";
import { getFundamentalSnapshot } from "../src/services/fundamentalService";

async function main() {
  const code = process.argv[2] || "035420";
  try {
    const snapshot = await getFundamentalSnapshot(code);
    console.log(JSON.stringify({ code, snapshot }, null, 2));
  } catch (e) {
    console.error("Error fetching fundamental snapshot:", e);
    process.exit(1);
  }
}

main();
