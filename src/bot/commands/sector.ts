// src/bot/commands/sector.ts
import type { ChatContext } from "../router";
import { scoreSectors } from "../../lib/sectors";
import { fmtPct, fmtKRW } from "../../lib/normalize";

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
  const sectors = await scoreSectors(today);

  // 최소 10개 보장 로직은 scoreSectors 내부에서 처리됨
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
}
