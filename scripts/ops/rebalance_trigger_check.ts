// 읽기 전용: 실계좌 보유 + 리밸런싱 가이드 설정으로, 주식이 x% 빠지면 언제 ±10%p 선을 넘는지 계산한다(DB 쓰기 없음).
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { fetchGuidePrices, loadAccountPositionRows, loadGuideFile, toGuideHoldings } from "../../src/services/incomeGuideStore";
import { buildIncomeGuideView, classifyHolding, DEFAULT_INCOME_GUIDE_SETTINGS, type GuideHolding } from "../../src/lib/incomeGuide";
import { kstDateKey } from "../../src/services/virtualAutoTradeTiming";

const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID!;
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const won = (v: number) => `${Math.round(v / 10_000).toLocaleString()}만원`;

async function main() {
  const file = await loadGuideFile(sb, chatId);
  const settings = file?.settings ?? DEFAULT_INCOME_GUIDE_SETTINGS;
  const rows = await loadAccountPositionRows(sb, chatId);
  const { prices, realtimeHits } = await fetchGuidePrices(sb, rows.map((r) => r.code));
  const { holdings } = toGuideHoldings(rows, prices, realtimeHits);
  const today = kstDateKey();
  const pastCashPcts = (file?.history ?? []).map((h) => h.groups?.find((g) => g.group === "cash")?.actualPct ?? 0);
  const view = (hs: GuideHolding[]) => buildIncomeGuideView({ holdings: hs, settings, today, pastCashPcts });

  const v0 = view(holdings);
  console.log(`설정 있음: ${!!file} · 목표 출처 ${v0.targetSource} · 단계 ${v0.stage.key} · 해외 목표 ${settings.overseasPct}% · 위성 상한 ${settings.satelliteCapPct}% · incomeMode ${settings.incomeMode ?? "-"}`);
  console.log(`총액 ${won(v0.total)} (종목 ${v0.holdingCount}개)`);
  for (const g of v0.groups) console.log(`  ${g.label}: ${g.actualPct.toFixed(1)}% (목표 ${g.targetPct.toFixed(1)}%, 선 ${(g.targetPct - 10).toFixed(1)}~${(g.targetPct + 10).toFixed(1)}%) ${won(g.value)}`);
  console.log(`  성장 안 해외 ${v0.growthSplit.globalPct.toFixed(1)}% (목표 ${v0.growthSplit.targetGlobalPct ?? settings.overseasPct}%)`);
  console.log(`  지금 리밸런싱 필요: ${v0.rebalance.needed} — ${v0.rebalance.reason}`);
  const byBucket = new Map<string, number>();
  for (const h of v0.holdings) byBucket.set(h.bucket, (byBucket.get(h.bucket) ?? 0) + h.value);
  console.log("  바구니:", [...byBucket].map(([b, v]) => `${b} ${won(v)}`).join(", "));

  const isOverseas = (h: GuideHolding) => /미국|글로벌|나스닥|S&P|선진|다우|해외|차이나|인도|일본|월드/.test(h.name);
  const isEquity = (h: GuideHolding) => classifyHolding(h.code, h.name) !== "bond_cash";
  // 하락 배수: 1 = 지수만큼, 0.5 = 지수의 절반만 빠짐
  const isIncome = (h: GuideHolding) => ["dividend", "covered_call", "reit_infra"].includes(classifyHolding(h.code, h.name));
  const scenarios: Array<[string, (h: GuideHolding) => number]> = [
    ["모든 주식형이 같이 하락(채권·현금 그대로)", (h) => (isEquity(h) ? 1 : 0)],
    ["분배형(배당·커버드콜·리츠)은 지수의 절반만 하락", (h) => (!isEquity(h) ? 0 : isIncome(h) ? 0.5 : 1)],
    ["국내 지수·개별주만 하락, 분배형 그대로", (h) => (isEquity(h) && !isIncome(h) && !isOverseas(h) ? 1 : 0)],
  ];
  const groupOut = (v: ReturnType<typeof view>) => v.groups.filter((g) => Math.abs(g.diffPct) > 10);
  for (const [label, beta] of scenarios) {
    let found = false;
    for (let x = 1; x <= 70; x++) {
      const hs = holdings.map((h) => ({ ...h, price: h.price * (1 - (beta(h) * x) / 100) }));
      const v = view(hs);
      if (groupOut(v).length > 0) {
        console.log(`\n[${label}] ${x}% 빠지면 선을 넘음 → ${v.rebalance.reason}`);
        for (const m of v.rebalance.moves) console.log(`   옮기기: ${m.from} → ${m.to} ${won(m.amount)}`);
        if (v.rebalance.growthShift) console.log(`   성장 안 조정: ${v.rebalance.growthShift.to} ${won(v.rebalance.growthShift.amount)}`);
        for (const g of v.groups) console.log(`   ${g.label} ${g.actualPct.toFixed(1)}% (목표 ${g.targetPct.toFixed(1)}%)`);
        found = true;
        break;
      }
    }
    if (!found) console.log(`\n[${label}] 70%까지 빠져도 선을 넘지 않음`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
