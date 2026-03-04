import type { ChatContext } from "../router";
import {
  scoreSectors,
  SectorScore,
  getTopSectors,
  getNextSectorCandidates,
} from "../../lib/sectors";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
// normalize.ts에서 유틸리티 import (중복 정의 제거)
import { fmtKRW, fmtPctSafe, getBizDaysAgo } from "../../lib/normalize";

// --- 아이콘 유틸리티 ---
const getRankIcon = (i: number) =>
  i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;

// --- 메시지 빌더 (Markdown) ---
function buildSectorListMessage(title: string, sectors: SectorScore[]): string {
  if (!sectors.length) return "데이터가 없습니다.";

  // 2025.02 데이터 시작을 고려하여 설명 문구 조정 (1년치 데이터 부족 가능성 있음)
  const header = `📊 *${title}* (TOP ${sectors.length})\n💡 _수급(5일) 및 단기 모멘텀(RS) 기준_`;

  const lines = sectors.map((s, idx) => {
    // 수급 요약: 100억 이상인 경우 '억' 단위, 아니면 숫자 그대로 표기되나 보통 포맷터가 처리
    // normalize의 fmtKRW는 (x / 1e8)로 '억' 단위를 반환하므로, 작은 숫자는 0.xx억이 될 수 있음
    // 여기서는 가독성을 위해 10억 이상만 표시하거나, 0이 아닌 값을 표시
    const flows: string[] = [];

    // 절대값이 10억(1e9) 이상인 경우에만 주요 수급으로 표시하거나,
    // 단순히 0이 아니면 표시하되 너무 작은 값은 필터링
    // if (Math.abs(s.flowF5) >= 20_000_000) flows.push(`외 ${fmtKRW(s.flowF5)}`);
    // if (Math.abs(s.flowI5) >= 20_000_000) flows.push(`기 ${fmtKRW(s.flowI5)}`);
    if (s.flowF5 !== 0) flows.push(`외 ${fmtKRW(s.flowF5)}`);
    if (s.flowI5 !== 0) flows.push(`기 ${fmtKRW(s.flowI5)}`);
    const flowStr = flows.length ? flows.join(", ") : "수급 특이 없음";

    // NaN 방지: s.rs1M이 NaN이면 fmtPctSafe가 "-"를 반환함
    // 데이터 시작일(2025.2.27)로 인해 RS 12M 등은 없을 수 있으므로 RS 1M/3M 위주 노출 추천
    const rsDisplay = fmtPctSafe(s.rs1M);

    // 한 줄 구성: [순위] [이름](점수)
    //             └ 🌊[수급] │ 📈RS(1M) [값]
    return [
      `${getRankIcon(idx)} *${s.name}* \`(${s.score.toFixed(0)}점)\``,
      `   └ 🌊${flowStr} │ 📈RS(1M) ${rsDisplay}`,
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
    parse_mode: "Markdown",
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
    parse_mode: "Markdown",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
