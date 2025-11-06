// scripts/cleanBadSectors.mjs
import "dotenv/config";
import fetch from "node-fetch";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const HDR = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};
const dryRun = false;

// "배, %, 원, 억, 천" 등 숫자형 문자열로 구성된 sector name 필터
function isBadName(name) {
  if (!name) return false;
  const t = name.toString().trim();
  return /^-?\d+(\.\d+)?\s*(배|x|倍|%|％)?$/i.test(t);
}

(async () => {
  console.log("🔍 Fetching bad sectors...");
  const r = await fetch(`${URL}/rest/v1/sectors?select=id,name&limit=5000`, {
    headers: HDR,
  });
  const sectors = await r.json();
  const bad = sectors.filter((s) => isBadName(s.name));

  console.log(`Found ${bad.length} bad sectors.`);
  if (bad.length > 0) console.log("Examples:", bad.slice(0, 10));

  if (!dryRun && bad.length > 0) {
    // 먼저 stocks의 sector_id 해제
    for (const b of bad) {
      await fetch(`${URL}/rest/v1/stocks?sector_id=eq.${b.id}`, {
        method: "PATCH",
        headers: HDR,
        body: JSON.stringify({ sector_id: null }),
      });
      console.log(`→ Unlinked stocks from sector_id=${b.id} (${b.name})`);
      await new Promise((r) => setTimeout(r, 80));
    }

    // 그 다음 sectors 삭제
    for (const b of bad) {
      const resp = await fetch(`${URL}/rest/v1/sectors?id=eq.${b.id}`, {
        method: "DELETE",
        headers: HDR,
      });
      console.log(
        resp.ok
          ? `✅ Deleted bad sector [${b.id}] ${b.name}`
          : `⚠️ Failed delete ${b.name}`
      );
      await new Promise((r) => setTimeout(r, 80));
    }
  }
})();
