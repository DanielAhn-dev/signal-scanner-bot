// src/bot/commands/sector.ts
import type { ChatContext } from "../router";
import { scoreSectors } from "../../lib/sectors";
import { fmtPct, fmtKRW } from "../../lib/normalize";

// 기존 DB/계산 기반 섹터 폴백용
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import {
  getTopSectorsRealtime,
  getTopSectors,
  computeSectorTrends,
} from "../../data/sector";

// 간단한 배지 UI
function badge(grade: "A" | "B" | "C") {
  return grade === "A" ? "🟢A" : grade === "B" ? "🟡B" : "⚪C";
}

function chunk<T>(arr: T[], n = 2) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function handleSectorCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // 1) 새 점수 엔진 시도
  let sectors: any[] = [];
  try {
    sectors = (await scoreSectors(today)) || [];
  } catch {
    sectors = [];
  }

  // 1-1) 새 엔진 결과가 있으면: 텍스트 + 인라인 버튼 형태로 반환
  if (sectors.length > 0) {
    const allZero = sectors.every((s) => s.score === 0);
    const header = allZero ? "📊 섹터 랭킹(완화모드)" : "📊 섹터 랭킹";

    const lines = sectors.map((s) => {
      const flow = `외인 ${fmtKRW(s.flowF5, 0)}/${fmtKRW(
        s.flowF20,
        0
      )} · 기관 ${fmtKRW(s.flowI5, 0)}/${fmtKRW(s.flowI20, 0)}`;
      return `${badge(s.grade as any)} ${s.name} · 점수 ${
        s.score
      } · RS(1/3/6/12M) ${fmtPct(s.rs1M)},${fmtPct(s.rs3M)},${fmtPct(
        s.rs6M
      )},${fmtPct(s.rs12M)} · 거래대금 ▲${fmtPct(s.tv5dChg)}/${fmtPct(
        s.tv20dChg
      )} · 수급 ${flow}`;
    });

    const keyboard = {
      inline_keyboard: chunk(
        sectors.map((s) => [
          {
            text: `${s.name} (${s.score})`,
            callback_data: `sector:${s.id}`,
          },
        ]),
        2
      ),
    };

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [header, ...lines].join("\n"),
      reply_markup: keyboard,
    });
    return;
  }

  // 2) 새 엔진이 비었으면: 기존 DB/계산 섹터 랭킹으로 폴백
  let tops = await getTopSectorsRealtime(8);
  if (!tops?.length) tops = await getTopSectors(8);
  if (!tops?.length) tops = await computeSectorTrends(10);

  if (!tops?.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "섹터 데이터 부족으로 거래대금 상위 종목을 표시합니다.",
    });
    return;
  }

  const buttons = tops.map((s) => ({
    text: `${s.sector} (${s.score}점)`,
    callback_data: `sector:${s.id}`, // 이름 대신 id
  }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "📊 섹터 랭킹(폴백모드)",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
