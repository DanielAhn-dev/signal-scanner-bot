// src/bot/commands/sector.ts
import type { ChatContext } from "../router";
import { scoreSectors, SectorScore, getTopSectors } from "../../lib/sectors";
import { fmtPct, fmtKRW } from "../../lib/normalize";
import { createMultiRowKeyboard } from "../../telegram/keyboards";

function badge(grade: "A" | "B" | "C" | undefined) {
  return grade === "A" ? "🟢A" : grade === "B" ? "🟡B" : "⚪C";
}

export async function handleSectorCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  console.log("[sector] start handleSectorCommand", { today });

  let sectors: SectorScore[] = [];

  try {
    sectors = (await scoreSectors(today)) || [];
    console.log("[sector] scoreSectors ok", { count: sectors.length });
  } catch (e) {
    console.error("[sector] scoreSectors failed:", e);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "섹터 점수 계산 오류가 발생했습니다.",
    });
    return;
  }

  if (!sectors.length) {
    console.log("[sector] no sectors");
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "섹터 데이터가 없습니다. 데이터 수집 상태를 확인해주세요.",
    });
    return;
  }

  const top = getTopSectors(sectors); // minScore 기본값 사용
  console.log("[sector] top sectors", { topCount: top.length });

  if (!top.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text:
        "점수 기준을 만족하는 섹터가 없습니다.\n" +
        "스코어 기준(minScore)을 완화해야 할 수 있습니다.",
    });
    return;
  }

  const header = "📊 섹터 랭킹 (TOP 10)";
  const lines = top.slice(0, 10).map((s) => {
    const rsLine = `RS(1/3/6/12M) ${fmtPct(s.rs1M)}, ${fmtPct(
      s.rs3M
    )}, ${fmtPct(s.rs6M)}, ${fmtPct(s.rs12M)}`;
    const flowLine = `수급: 외인5일 ${fmtKRW(s.flowF5, 0)} / 기관5일 ${fmtKRW(
      s.flowI5,
      0
    )}`;
    return `${badge(s.grade)} ${s.name} · 점수 ${
      s.score
    }\n  └ ${rsLine}\n  └ ${flowLine}`;
  });

  const buttons = top.slice(0, 10).map((s) => ({
    text: `${s.name} (${s.score})`,
    callback_data: `sector:${s.id}`,
  }));

  console.log("[sector] before sendMessage");

  const res = await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [header, ...lines].join("\n\n"),
    reply_markup: createMultiRowKeyboard(2, buttons),
  });

  console.log("[sector] sendMessage result", res);
}
