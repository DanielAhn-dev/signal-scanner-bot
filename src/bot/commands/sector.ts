import type { ChatContext } from "../router";
import {
  scoreSectors,
  SectorScore,
  getTopSectors,
  getNextSectorCandidates,
} from "../../lib/sectors";
import { createMultiRowKeyboard } from "../../telegram/keyboards";

// --- 포맷팅 유틸리티 ---
const fmtKRW = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 100_000_000) return `${(n / 100_000_000).toFixed(0)}억`;
  if (abs >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return `${n}`;
};

const fmtPct = (n?: number) =>
  typeof n === "number" ? `${n > 0 ? "+" : ""}${n.toFixed(1)}%` : "-";

const getRankIcon = (i: number) =>
  i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;

// --- 메시지 빌더 (Markdown) ---
function buildSectorListMessage(title: string, sectors: SectorScore[]): string {
  if (!sectors.length) return "데이터가 없습니다.";

  const header = `📊 *${title}* (TOP ${sectors.length})\n💡 _수급(5일) 및 모멘텀(RS) 기준_`;

  const lines = sectors.map((s, idx) => {
    // 수급 요약: 0이 아닌 것만 표시, 너무 길면 자름
    const flows = [];
    if (Math.abs(s.flowF5) > 10_000_000) flows.push(`외 ${fmtKRW(s.flowF5)}`);
    if (Math.abs(s.flowI5) > 10_000_000) flows.push(`기 ${fmtKRW(s.flowI5)}`);
    const flowStr = flows.length ? flows.join(", ") : "수급 미미";

    // 한 줄 구성: [순위] [이름](점수)
    //             └ 🌊[수급] │ 📈RS [1M]
    return [
      `${getRankIcon(idx)} *${s.name}* \`(${s.score}점)\``,
      `   └ 🌊${flowStr} │ 📈RS(1M) ${fmtPct(s.rs1M)}`,
    ].join("\n");
  });

  return [header, ...lines].join("\n\n");
}

const CALLBACK_MAX = 60;

// --- 메인 핸들러: /sector ---
export async function handleSectorCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  let sectors: SectorScore[] = [];

  try {
    sectors = (await scoreSectors(today)) || [];
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

  const top = getTopSectors(sectors).slice(0, 10); // TOP 10만
  if (!top.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 기준을 만족하는 유망 섹터가 없습니다.",
    });
  }

  // 메시지 생성
  const text = buildSectorListMessage("주도 섹터 랭킹", top);

  // 버튼 생성 (유효성 검사 포함)
  const buttons = top
    .filter((s) => s.id && Buffer.byteLength(s.id, "utf8") <= CALLBACK_MAX)
    .map((s) => ({
      text: `${s.name}`, // 버튼은 심플하게 이름만
      callback_data: s.id,
    }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text,
    parse_mode: "Markdown", // 마크다운 필수
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}

// --- 메인 핸들러: /nextsector ---
export async function handleNextSectorCommand(
  ctx: ChatContext,
  tgSend: any,
  minFlow: number = 10_000_000_000 // 기본 100억
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
      text: "⚠️ 현재 강한 수급(100억↑)이 유입되는 섹터가 없습니다.\n(/sector 명령어로 전체 랭킹을 확인하세요)",
    });
  }

  // 메시지 생성
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
    parse_mode: "Markdown",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
