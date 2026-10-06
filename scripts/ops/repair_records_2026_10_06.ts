/**
 * 2026-10-06 운영 점검에서 찾은 오염 기록 보정 (한 번만 실행).
 *
 * 1) forward-test/bot-equity/2026-10-01.json — 실계좌 동기화 버그로 현금 0(기대 7,194,674원)인 채 기록돼
 *    평가액 12,714,100원 → 봇 계좌 최대낙폭이 -36.06%로 오염. 현금을 더해 19,908,774원으로 바로잡는다.
 * 2) 목표 트래커(관리자) 2026-10-01 기록도 같은 값으로.
 * 3) scores 2026-10-02 — 10/05 대체공휴일 재실행에서 엔진 팩터가 남아 있는데도 score_source가
 *    legacy_fallback으로 강등된 행을 legacy_score+engine_factors로 되돌린다(점수·신호·팩터 값은 그대로).
 *
 * 사용: pnpm exec tsx scripts/ops/repair_records_2026_10_06.ts            (미리보기, 쓰지 않음)
 *       pnpm exec tsx scripts/ops/repair_records_2026_10_06.ts --apply    (백업 저장 후 적용)
 * 백업: tmp/repair-2026-10-06/ 에 원본을 저장한다.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const BAD_TOTAL = 12_714_100;
const MISSING_CASH = 7_194_674;
const BACKUP_DIR = "tmp/repair-2026-10-06";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const bucket = supabase.storage.from("market-snapshots");

async function download(path: string): Promise<string> {
  const { data, error } = await bucket.download(path);
  if (error) throw new Error(`${path} 읽기 실패: ${error.message}`);
  return await data.text();
}

async function upload(path: string, value: unknown) {
  const { error } = await bucket.upload(path, JSON.stringify(value), { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`${path} 저장 실패: ${error.message}`);
}

async function main() {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) throw new Error("TELEGRAM_ADMIN_CHAT_ID가 필요합니다.");
  mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(APPLY ? "== 적용 모드" : "== 미리보기 (적용하려면 --apply)");

  // 1) 봇 평가액
  const bePath = "forward-test/bot-equity/2026-10-01.json";
  const beRaw = await download(bePath);
  writeFileSync(`${BACKUP_DIR}/bot-equity-2026-10-01.json`, beRaw);
  const be = JSON.parse(beRaw);
  if (be.total === BAD_TOTAL) {
    const fixed = { ...be, total: BAD_TOTAL + MISSING_CASH, note: "2026-10-06 보정: 현금 0으로 기록된 값에 기대 현금 7,194,674원을 더함" };
    console.log(`봇 평가액 10/01: ${be.total} → ${fixed.total}`);
    if (APPLY) await upload(bePath, fixed);
  } else {
    console.log(`봇 평가액 10/01: ${be.total} (이미 보정됐거나 예상과 다름 — 건너뜀)`);
  }

  // 2) 목표 트래커
  const goalPath = `goal-tracker/${chatId}.json`;
  const goalRaw = await download(goalPath);
  writeFileSync(`${BACKUP_DIR}/goal-tracker-${chatId}.json`, goalRaw);
  const goal = JSON.parse(goalRaw);
  const point = (goal.history ?? []).find((p: { date: string }) => p.date === "2026-10-01");
  if (point && point.total === BAD_TOTAL) {
    console.log(`목표 트래커 10/01: ${point.total} → ${BAD_TOTAL + MISSING_CASH}`);
    point.total = BAD_TOTAL + MISSING_CASH;
    if (APPLY) await upload(goalPath, goal);
  } else {
    console.log(`목표 트래커 10/01: ${point ? point.total : "기록 없음"} — 건너뜀`);
  }

  // 3) 점수 출처 표시
  const { data, error } = await supabase.from("scores").select("*").eq("asof", "2026-10-02").limit(1000);
  if (error) throw new Error(`scores 조회 실패: ${error.message}`);
  writeFileSync(`${BACKUP_DIR}/scores-2026-10-02.json`, JSON.stringify(data));
  const targets = ((data ?? []) as Array<{ code: string; asof: string; factors: Record<string, unknown> }>).filter(
    (r) => r.factors?.score_source === "legacy_fallback" && r.factors?.vol_ratio != null
  );
  console.log(`점수 10/02: 엔진 팩터가 있는데 legacy_fallback인 행 ${targets.length}개 → legacy_score+engine_factors`);
  if (APPLY) {
    for (const r of targets) {
      const { error: e } = await supabase
        .from("scores")
        .update({ factors: { ...r.factors, score_source: "legacy_score+engine_factors" } })
        .eq("code", r.code)
        .eq("asof", r.asof);
      if (e) throw new Error(`${r.code} 갱신 실패: ${e.message}`);
    }
  }
  console.log(`백업: ${BACKUP_DIR}/`);
  if (APPLY) console.log("완료. 웹 전략 결과(latest.json)는 다음 일일 배치에서 다시 계산됩니다.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
