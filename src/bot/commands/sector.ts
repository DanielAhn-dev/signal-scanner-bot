import type { ChatContext } from "../router";
import { scoreSectors, SectorScore } from "../../lib/sectors"; // SectorScore 타입도 import
import { fmtPct, fmtKRW } from "../../lib/normalize";
import { createMultiRowKeyboard } from "../../telegram/keyboards";

// Supabase 클라이언트 import
import { createClient } from "@supabase/supabase-js";
const supa = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });

// 간단한 배지 UI
function badge(grade: "A" | "B" | "C" | undefined) {
  return grade === "A" ? "🟢A" : grade === "B" ? "🟡B" : "⚪C";
}

// --- handleSectorCommand: DB 업데이트 및 jobs 등록 로직 추가 ---
export async function handleSectorCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  let sectors: SectorScore[] = [];

  try {
    // 1. 새 점수 엔진으로 섹터 스코어 계산
    sectors = (await scoreSectors(today)) || [];
  } catch (e) {
    console.error("scoreSectors failed:", e);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "섹터 점수 계산 중 오류가 발생했습니다.",
    });
    return;
  }

  // 2. 점수가 없으면 폴백 없이 바로 종료 (데이터 수집이 우선)
  if (sectors.length === 0) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "현재 유의미한 섹터 데이터가 없습니다. 데이터 수집 상태를 확인해주세요.",
    });
    return;
  }

  // 3. (DB 업데이트) 계산된 점수를 public.sectors 테이블에 업데이트
  const updates = sectors.map((s) => ({ id: s.id, score: s.score }));
  const { error: updateError } = await supa().from("sectors").upsert(updates);
  if (updateError)
    console.error("Failed to update sector scores:", updateError);

  // 4. (JOBS 등록) 점수 상위 5개 섹터를 'WATCH_SECTOR' 잡으로 등록
  const topSectors = sectors.slice(0, 5);
  const now = new Date();

  const jobsToInsert = topSectors.map((sector) => ({
    type: "WATCH_SECTOR",
    payload: {
      sectorId: sector.id,
      sectorName: sector.name,
      score: sector.score,
    },
    status: "queued", // DB 기본값이 'queued'이므로 맞춰주기
    created_at: now,
    started_at: now, // 스케줄링이 아니라 즉시 시작 개념으로
    dedup_key: `${sector.id}-${today}`, // 오늘 날짜 + 섹터 id로 중복 방지
  }));

  const { error: jobError } = await supa().from("jobs").insert(jobsToInsert);
  if (jobError) console.error("Failed to insert sector watch jobs:", jobError);
  else console.log(`Inserted ${topSectors.length} sector watch jobs.`);

  // 5. 텔레그램 메시지 생성 및 전송
  const allZero = sectors.every((s) => s.score === 0);
  const header = allZero ? "📊 섹터 랭킹(완화모드)" : "📊 섹터 랭킹 (TOP 10)";

  const lines = sectors.slice(0, 10).map((s) => {
    const flow = `외인 ${fmtKRW(s.flowF5, 0)}/${fmtKRW(
      s.flowF20,
      0
    )} · 기관 ${fmtKRW(s.flowI5, 0)}/${fmtKRW(s.flowI20, 0)}`;
    return `${badge(s.grade)} ${s.name} · 점수 ${
      s.score
    } · RS(1/3/6/12M) ${fmtPct(s.rs1M)},${fmtPct(s.rs3M)},${fmtPct(
      s.rs6M
    )},${fmtPct(s.rs12M)}`;
  });

  const buttons = topSectors.map((s) => ({
    text: `${s.name} (${s.score})`,
    callback_data: `sector:${s.id}`, // /stocks <sector_id> 를 호출하게 될 콜백
  }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [header, ...lines.join("\n")].join("\n\n"),
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
