import "../src/lib/installTruncationGuard";
/**
 * 리밸런싱 가이드 월 자동 기록 — 실계좌 보유가 있는 사용자마다 이번 달 기록이 없으면 하나 남긴다.
 * 매일 배치 뒤에 돌지만 이미 이번 달 기록이 있으면 건너뛰므로 사실상 그달 첫 거래일에 한 번 기록된다.
 * 사용자가 버튼을 누르지 않아도 "내 선택 돌아보기"의 한 달 전 / 지금 비교가 비지 않게 하는 것이 목적이다.
 *   pnpm exec tsx scripts/income_guide_monthly.ts        # 기록
 *   pnpm exec tsx scripts/income_guide_monthly.ts --dry  # 저장 없이 대상만 출력
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { toKstDateKey } from "../src/lib/krxCalendar";
import { buildIncomeGuideView, DEFAULT_INCOME_GUIDE_SETTINGS, withMonthlyEntry } from "../src/lib/incomeGuide";
import {
  fetchGuidePrices,
  loadAccountPositionRows,
  loadGuideFile,
  saveGuideFile,
  toGuideHoldings,
} from "../src/services/incomeGuideStore";

const DRY = process.argv.includes("--dry");

async function main() {
  const started = Date.now();
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const today = toKstDateKey();
  const rows = await loadAccountPositionRows(supabase);
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) {
    const id = String(r.chat_id ?? "");
    if (!id) continue;
    byUser.set(id, [...(byUser.get(id) ?? []), r]);
  }
  // 시세는 모든 사용자 종목을 한 번에 받는다
  const { prices, realtimeHits } = await fetchGuidePrices(supabase, rows.map((r) => r.code));

  let saved = 0;
  let skipped = 0;
  let failed = 0;
  for (const [chatId, userRows] of byUser) {
    try {
      const file = (await loadGuideFile(supabase, chatId)) ?? { settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS }, history: [] };
      const { holdings } = toGuideHoldings(userRows, prices, realtimeHits);
      const view = buildIncomeGuideView({ holdings, settings: file.settings, today });
      const next = withMonthlyEntry(file.history, view, holdings);
      if (!next) {
        skipped += 1;
        continue;
      }
      if (DRY) {
        console.log(`[dry] ${chatId}: ${holdings.length}종목 ${Math.round(view.total).toLocaleString("ko-KR")}원 기록 예정`);
        saved += 1;
        continue;
      }
      const err = await saveGuideFile(supabase, chatId, { ...file, history: next });
      if (err) throw new Error(err);
      saved += 1;
    } catch (e) {
      failed += 1;
      console.warn(`[income_guide_monthly] ${chatId} 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(
    `[income_guide_monthly] ${today} 사용자 ${byUser.size}명 · 기록 ${saved} · 이미 있음 ${skipped} · 실패 ${failed} · ${((Date.now() - started) / 1000).toFixed(1)}초`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
