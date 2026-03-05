// src/bot/commands/ranking.ts
// /랭킹 — 포트폴리오 수익률 순위

import type { ChatContext } from "../router";
import { getPortfolioRanking } from "../../services/userService";
import { esc, LINE, fmtPct } from "../messages/format";

export async function handleRankingCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const rankings = await getPortfolioRanking(15);

  if (!rankings.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "아직 랭킹 데이터가 없습니다.",
        "",
        "관심종목에 매수가를 등록한 사용자가 필요합니다.",
        "/관심추가 종목명 매수가",
      ].join("\n"),
    });
  }

  const myTgId = ctx.from?.id ?? ctx.chatId;
  const myRank = rankings.findIndex((r) => r.tgId === myTgId);

  const lines = rankings.map((r, i) => {
    const medal =
      i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    const plSign = r.plPct >= 0 ? "▲" : "▼";
    const isMe = r.tgId === myTgId;
    const name = isMe
      ? `<b>${esc(r.displayName)}</b> (나)`
      : esc(r.displayName);
    return `${medal} ${name}  ${plSign} ${fmtPct(r.plPct)}  (${r.stockCount}종목)`;
  });

  let msg = [
    `<b>🏆 포트폴리오 랭킹</b>`,
    LINE,
    "",
    ...lines,
  ].join("\n");

  if (myRank >= 0) {
    msg += `\n\n내 순위: ${myRank + 1}위`;
  } else {
    msg += `\n\n💡 /관심추가 종목 매수가 로 참여하세요!`;
  }

  msg += `\n${LINE}\n/프로필 · /관심 · /팔로우 @닉네임`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}
