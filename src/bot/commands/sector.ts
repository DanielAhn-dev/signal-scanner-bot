import type { ChatContext } from "../router";
import { scoreSectors, SectorScore } from "../../lib/sectors";
import { fmtPct, fmtKRW } from "../../lib/normalize";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { createClient } from "@supabase/supabase-js";

const supa = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });

function badge(grade: "A" | "B" | "C" | undefined) {
  return grade === "A" ? "🟢A" : grade === "B" ? "🟡B" : "⚪C";
}

export async function handleSectorCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  let sectors: SectorScore[] = [];

  try {
    sectors = (await scoreSectors(today)) || [];
  } catch (e) {
    console.error("scoreSectors failed:", e);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "섹터 점수 계산 중 오류가 발생했습니다.",
    });
    return;
  }

  if (sectors.length === 0) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "현재 유의미한 섹터 데이터가 없습니다. 데이터 수집 상태를 확인해주세요.",
    });
    return;
  }

  // 3. (DB 업데이트) 계산된 점수를 public.sectors 테이블에 업데이트
  const updates = sectors.map((s) =>
    supa()
      .from("sectors")
      .update({ score: s.score, updated_at: new Date().toISOString() })
      .eq("id", s.id)
  );

  try {
    const results = await Promise.all(updates);
    results.forEach((result) => {
      if (result.error)
        console.error("Failed to update a sector score:", result.error);
    });
  } catch (e) {
    console.error("Exception during Promise.all for sector updates:", e);
  }

  // 4. (JOBS 등록) 점수 상위 5개 섹터를 'WATCH_SECTOR' 잡으로 등록
  const topSectors = sectors.slice(0, 5);
  const now = new Date();
  const jobsToUpsert = topSectors.map((sector) => ({
    // 변수명 변경
    type: "WATCH_SECTOR",
    payload: {
      sectorId: sector.id,
      sectorName: sector.name,
      score: sector.score,
    },
    status: "queued",
    created_at: now,
    // dedup_key는 unique 제약조건이므로 upsert의 기준이 됨
    dedup_key: `${sector.id}-${today}`,
  }));

  // ✅ insert -> upsert 로 변경
  const { error: jobError } = await supa().from("jobs").upsert(jobsToUpsert, {
    onConflict: "type, dedup_key", // 중복 검사 기준 컬럼 명시
  });

  if (jobError) {
    // 중복 에러는 무시하고, 다른 에러만 로깅
    if (jobError.code !== "23505") {
      console.error("Failed to upsert sector watch jobs:", jobError);
    }
  } else {
    console.log(`Upserted ${topSectors.length} sector watch jobs.`);
  }

  // 5. 텔레그램 메시지 생성 및 전송
  const allZero = sectors.every((s) => s.score === 0);
  const header = allZero ? "📊 섹터 랭킹(완화모드)" : "📊 섹터 랭킹 (TOP 10)";
  const lines = sectors.slice(0, 10).map((s) => {
    // 5일/20일 외인/기관 순매수 (억원 단위)
    const flow = `\n  └ 수급: 외인(${fmtKRW(s.flowF5, 0)}/${fmtKRW(
      s.flowF20,
      0
    )}) · 기관(${fmtKRW(s.flowI5, 0)}/${fmtKRW(s.flowI20, 0)})`;

    // ✅ return 문에 flow 추가
    return `${badge(s.grade)} ${s.name} · 점수 ${
      s.score
    } · RS(1/3/6/12M) ${fmtPct(s.rs1M)},${fmtPct(s.rs3M)},${fmtPct(
      s.rs6M
    )},${fmtPct(s.rs12M)}, ${flow}`; // 여기에 flow 변수 추가
  });

  const buttons = topSectors.map((s) => ({
    text: `${s.name} (${s.score})`,
    callback_data: `sector:${s.id}`,
  }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [header, ...lines].join("\n\n"),
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
