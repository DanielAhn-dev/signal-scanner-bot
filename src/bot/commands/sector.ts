import type { ChatContext } from "../router";
import {
  scoreSectors,
  SectorScore,
  getTopSectors,
  getNextSectorCandidates,
} from "../../lib/sectors";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { fmtKRW, fmtPctSafe, getBizDaysAgo } from "../../lib/normalize";
import { esc, LINE } from "../messages/format";

// --- 메시지 빌더 (HTML) ---
function buildSectorListMessage(title: string, sectors: SectorScore[]): string {
  if (!sectors.length) return "데이터가 없습니다.";

  const header = `<b>${esc(title)}</b>  TOP ${sectors.length}\n<i>수급(5일) · 단기 모멘텀(RS) 기준</i>`;

  const lines = sectors.map((s, idx) => {
    const rank = idx + 1;
    const flows: string[] = [];
    if (s.flowF5 !== 0) flows.push(`외 ${fmtKRW(s.flowF5)}`);
    if (s.flowI5 !== 0) flows.push(`기 ${fmtKRW(s.flowI5)}`);
    const flowStr = flows.length ? flows.join(", ") : "수급 특이 없음";
    const rsDisplay = fmtPctSafe(s.rs1M);

    return [
      `${rank}. <b>${esc(s.name)}</b>  <code>${s.score.toFixed(0)}점</code>`,
      `   ${flowStr} · RS(1M) ${rsDisplay}`,
    ].join("\n");
  });

  return [header, LINE, ...lines].join("\n");
}

const CALLBACK_MAX = 60;

// --- 메인 핸들러: /sector ---
export async function handleSectorCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  let sectors: SectorScore[] = [];

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const refDate = getBizDaysAgo(todayStr, 1); // 전 영업일
    sectors = await scoreSectors(refDate); // ✅ 재선언 없이 대입만
  } catch (e) {
    console.error("[sector] error:", e);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 섹터 분석 중 오류가 발생했습니다.",
    });
  }

  if (!sectors.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 분석된 섹터 데이터가 없습니다.",
    });
  }

  const top = getTopSectors(sectors).slice(0, 10);

  if (!top.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 기준을 만족하는 유망 섹터가 없습니다.",
    });
  }

  const text = buildSectorListMessage("주도 섹터 랭킹", top);

  const buttons = top
    .filter((s) => s.id && Buffer.byteLength(s.id, "utf8") <= CALLBACK_MAX)
    .map((s) => ({
      text: s.name,
      callback_data: s.id,
    }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text,
    parse_mode: "HTML",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}

// --- 메인 핸들러: /nextsector ---
export async function handleNextSectorCommand(
  ctx: ChatContext,
  tgSend: any,
  minFlow: number = 5_000_000_000 // 기본 50억 (순환매 초기에는 수급 작을 수 있음)
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  let sectors: SectorScore[] = [];

  try {
    sectors = (await scoreSectors(today)) || [];
  } catch (e) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 수급 분석 중 오류가 발생했습니다.",
    });
  }

  const next = getNextSectorCandidates(sectors, minFlow).slice(0, 10);

  if (!next.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 현재 수급이 유입되는 순환매 후보 섹터가 없습니다.",
    });
  }

  const text = buildSectorListMessage("수급 급등(Next) 섹터", next);

  const buttons = next
    .filter((s) => s.id && Buffer.byteLength(s.id, "utf8") <= CALLBACK_MAX)
    .map((s) => ({
      text: s.name,
      callback_data: s.id,
    }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text,
    parse_mode: "HTML",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
