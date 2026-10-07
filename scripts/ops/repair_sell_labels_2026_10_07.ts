/**
 * 2026-10-01 손실 매도의 잘못된 사유 라벨 보정 (한 번만 실행).
 *
 * 수정 전 코드는 매도 사유를 손익 부호로 골라서 손실 매도가 "부분익절"로 기록됐다.
 * 거래 기록(virtual_trades)과 행동 기록(virtual_autotrade_actions) 두 곳을 같이 고친다.
 *
 * - trade 144 · action 1139: 한미약품(128940) 섹터 정리 전량 매도, 손익 −3,181원
 *   (익절 단계 0번 완료, 전량 청산) → sector-rotation-sell
 * - trade 147 · action 1182: S-Oil(010950) 손절선(−7%) 절반 청산, 손익 −111,408원, −8.4%
 *   (현재 손절 규칙의 절반 청산과 수량 8/16 일치) → stop-loss
 *
 * 각 행은 현재 값이 예상한 옛 라벨일 때만 바꾼다(이미 고쳐졌으면 건너뜀).
 * 바꾸기 전 원본은 tmp/repair-sell-labels-2026-10-07/ 에 저장한다.
 *
 * 사용: pnpm exec tsx scripts/ops/repair_sell_labels_2026_10_07.ts            (미리보기, 쓰지 않음)
 *       pnpm exec tsx scripts/ops/repair_sell_labels_2026_10_07.ts --apply    (백업 저장 후 적용)
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = "tmp/repair-sell-labels-2026-10-07";
const OLD_LABEL = "take-profit-partial";

const TRADE_FIXES = [
  { tradeId: 144, newLabel: "sector-rotation-sell" },
  { tradeId: 147, newLabel: "stop-loss" },
] as const;

const ACTION_FIXES = [
  { actionId: 1139, newLabel: "sector-rotation-sell" },
  { actionId: 1182, newLabel: "stop-loss" },
] as const;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(APPLY ? "== 적용 모드" : "== 미리보기 (적용하려면 --apply)");

  const tradeIds = TRADE_FIXES.map((f) => f.tradeId);
  const { data: trades, error: tErr } = await supabase
    .from("virtual_trades")
    .select("id,memo")
    .in("id", tradeIds);
  if (tErr) throw tErr;
  writeFileSync(`${BACKUP_DIR}/virtual_trades.json`, JSON.stringify(trades, null, 2));

  for (const fix of TRADE_FIXES) {
    const row = trades?.find((r) => r.id === fix.tradeId);
    if (!row) {
      console.log(`trade ${fix.tradeId}: 없음 — 건너뜀`);
      continue;
    }
    if (!row.memo?.includes(`event=${OLD_LABEL};note=${OLD_LABEL}`)) {
      console.log(`trade ${fix.tradeId}: 예상한 옛 라벨이 아님(${row.memo}) — 건너뜀`);
      continue;
    }
    const memo = row.memo.replaceAll(`event=${OLD_LABEL};note=${OLD_LABEL}`, `event=${fix.newLabel};note=${fix.newLabel}`);
    console.log(`trade ${fix.tradeId}: ${row.memo} → ${memo}`);
    if (APPLY) {
      const { error } = await supabase.from("virtual_trades").update({ memo }).eq("id", fix.tradeId);
      if (error) throw error;
    }
  }

  const actionIds = ACTION_FIXES.map((f) => f.actionId);
  const { data: actions, error: aErr } = await supabase
    .from("virtual_autotrade_actions")
    .select("id,reason")
    .in("id", actionIds);
  if (aErr) throw aErr;
  writeFileSync(`${BACKUP_DIR}/virtual_autotrade_actions.json`, JSON.stringify(actions, null, 2));

  for (const fix of ACTION_FIXES) {
    const row = actions?.find((r) => r.id === fix.actionId);
    if (!row) {
      console.log(`action ${fix.actionId}: 없음 — 건너뜀`);
      continue;
    }
    if (row.reason !== OLD_LABEL) {
      console.log(`action ${fix.actionId}: reason=${row.reason} — 건너뜀`);
      continue;
    }
    console.log(`action ${fix.actionId}: ${row.reason} → ${fix.newLabel}`);
    if (APPLY) {
      const { error } = await supabase.from("virtual_autotrade_actions").update({ reason: fix.newLabel }).eq("id", fix.actionId);
      if (error) throw error;
    }
  }

  console.log(APPLY ? "완료. 백업: " + BACKUP_DIR : "미리보기 끝. 적용은 --apply.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
