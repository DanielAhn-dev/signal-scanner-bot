import "../src/lib/installTruncationGuard";
/**
 * 리밸런싱 가이드 월 자동 기록 — 실계좌 보유가 있는 사용자마다 이번 달 기록이 없으면 하나 남긴다.
 * 매일 배치 뒤에 돌지만 이미 이번 달 기록이 있으면 건너뛰므로 사실상 그달 첫 거래일에 한 번 기록된다.
 * 사용자가 버튼을 누르지 않아도 "내 선택 돌아보기"의 한 달 전 / 지금 비교가 비지 않게 하는 것이 목적이다.
 * 합산 기록(history)과 계좌별 기록(accounts[키].history)을 따로 남긴다 — 가이드 화면의 계좌별 보기와 같은 계산(src/lib/guideAccountScope.ts).
 *   pnpm exec tsx scripts/income_guide_monthly.ts        # 기록
 *   pnpm exec tsx scripts/income_guide_monthly.ts --dry  # 저장 없이 대상만 출력
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { toKstDateKey } from "../src/lib/krxCalendar";
import { buildIncomeGuideView, DEFAULT_INCOME_GUIDE_SETTINGS, withMonthlyEntry } from "../src/lib/incomeGuide";
import { applyAccountKinds, listGuideAccounts, scopeSettingsToAccount, type AccountGuideMap } from "../src/lib/guideAccountScope";
import { buildGuidePlanSnapshot } from "../src/services/guidePlanSnapshot";
import {
  fetchGuidePrices,
  fetchYieldPctByCode,
  loadAccountPositionRows,
  loadGuideFile,
  loadPlanOverseasPct,
  saveGuideFile,
  toGuideHoldings,
  withPlanOverseas,
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
      const accounts: AccountGuideMap = { ...(file.accounts ?? {}) };
      const all = applyAccountKinds(toGuideHoldings(userRows, prices, realtimeHits).holdings, accounts);
      const month = today.slice(0, 7);
      // 화면과 같은 해외 비중 목표(내 계획 구성이 있으면 그 값) — 계산에만 쓰고 저장은 기록만
      const planned = withPlanOverseas(file.settings, await loadPlanOverseasPct(supabase, chatId).catch(() => null));
      const list = listGuideAccounts(all, accounts, file.settings.cashByAccount);
      // 합산 하나 + 계좌마다 하나. 이미 이번 달 기록이 있는 쪽은 건너뛴다
      const scopes: Array<{ key: string | null; history: typeof file.history }> = [
        { key: null, history: file.history },
        ...list.map((a) => ({ key: a.key, history: accounts[a.key]?.history ?? [] })),
      ].filter((sc) => !sc.history.some((h) => h.date.slice(0, 7) === month));
      if (!scopes.length) {
        skipped += 1;
        continue;
      }
      let history = file.history;
      let added = 0;
      for (const sc of scopes) {
        const holdings = sc.key ? all.filter((h) => h.accountKey === sc.key) : all;
        const settings = sc.key ? scopeSettingsToAccount(planned, accounts, sc.key, list[0]?.key ?? null) : planned;
        // 화면과 같은 분배율·계획으로 — 그달 안내(새 돈 살 곳·더 사지 말 것)와 가격을 기록에 같이 남겨 가이드 따름 판정에 쓴다
        const yieldPctByCode = await fetchYieldPctByCode(holdings, undefined, { supabase, today });
        const view = buildIncomeGuideView({ holdings, settings, today, yieldPctByCode });
        const { advice, entryPrices } = await buildGuidePlanSnapshot({ supabase, file: { ...file, settings, history: sc.history }, view, yieldPctByCode, today, prices });
        const next = withMonthlyEntry(sc.history, view, holdings, { advice, prices: entryPrices });
        if (!next) continue;
        added += 1;
        if (sc.key) accounts[sc.key] = { ...(accounts[sc.key] ?? {}), history: next };
        else history = next;
        if (DRY) console.log(`[dry] ${chatId} ${sc.key ?? "합산"}: ${holdings.length}종목 ${Math.round(view.total).toLocaleString("ko-KR")}원 기록 예정`);
      }
      if (!added) {
        skipped += 1;
        continue;
      }
      if (!DRY) {
        const err = await saveGuideFile(supabase, chatId, { ...file, history, accounts });
        if (err) throw new Error(err);
      }
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
