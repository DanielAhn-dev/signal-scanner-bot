// scripts/fillSectors.ts
// 역할: 기존 sectors 테이블의 category/metrics가 비어 있으면 채워넣음 (stocks는 수정하지 않음)
import "dotenv/config";
import fetch from "node-fetch";

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_ANON_KEY!;
if (!URL || !KEY) throw new Error("SUPABASE_URL & SUPABASE_ANON_KEY required");
const HDR = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const METRIC_KEYS = ["roi_1m", "roi_3m", "roi_6m"] as const;
function defaultMetrics() {
  return { roi_1m: 0, roi_3m: 0, roi_6m: 0 };
}
function needsMetricInit(m: any) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return true;
  return METRIC_KEYS.some(
    (k) => !(k in m) || typeof (m as any)[k] !== "number"
  );
}
function classifyCategory(name: string): string | null {
  if (/(반도체|it|전자|디스플레이|소프트웨어|ai|칩)/i.test(name)) return "IT";
  if (/(2차전지|배터리|태양광|풍력|수소|정유|석유)/i.test(name))
    return "Energy";
  if (/(바이오|제약|의료|헬스케어|진단)/i.test(name)) return "Healthcare";
  if (/(자동차|조선|기계|운송장비|철도|항공|물류)/i.test(name))
    return "Industrial";
  if (/(은행|증권|보험|금융|카드)/i.test(name)) return "Financial";
  if (/(원자재|철강|비철|화학|소재|시멘트|광물)/i.test(name))
    return "Materials";
  if (/(엔터|미디어|게임|유통|소비|음식료|의류|리테일)/i.test(name))
    return "Consumer";
  if (/(통신|telecom)/i.test(name)) return "Telecom";
  if (/(전력|가스|수도|utility)/i.test(name)) return "Utilities";
  if (/(리츠|부동산|real estate)/i.test(name)) return "Real Estate";
  return null;
}

async function fetchAllSectors(batch = 1000) {
  const out: any[] = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(
      `${URL}/rest/v1/sectors?select=id,name,category,metrics&limit=${batch}&offset=${offset}`,
      { headers: HDR }
    );
    if (!r.ok)
      throw new Error(`fetch sectors failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < batch) break;
    offset += rows.length;
  }
  return out;
}

(async function main() {
  console.log("Loading sectors...");
  const sectors = await fetchAllSectors();
  console.log(`Found ${sectors.length} sectors. Patching category/metrics...`);
  const stats = { total: sectors.length, patched: 0, skipped: 0 };
  for (const s of sectors) {
    const needCat = !s.category && !!classifyCategory(s.name);
    const needMet = needsMetricInit(s.metrics);
    if (!needCat && !needMet) {
      stats.skipped++;
      continue;
    }
    const patch: any = {};
    if (needCat) patch.category = classifyCategory(s.name);
    if (needMet) patch.metrics = defaultMetrics();
    const pr = await fetch(`${URL}/rest/v1/sectors?id=eq.${s.id}`, {
      method: "PATCH",
      headers: {
        ...HDR,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    });
    if (pr.ok) {
      stats.patched++;
    } else {
      console.warn(`Failed to patch sector id=${s.id} status=${pr.status}`);
    }
  }
  console.log("Done. stats:", stats);
})();
