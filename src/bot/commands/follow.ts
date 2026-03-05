// src/bot/commands/follow.ts
// /팔로우 /언팔로우 /피드 — 소셜 기능

import type { ChatContext } from "../router";
import {
  followUser,
  unfollowUser,
  getFollowingFeed,
} from "../../services/userService";
import { esc, LINE, fmtInt, fmtPct } from "../messages/format";

export async function handleFollowCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const username = (input || "").trim().replace(/^@/, "");

  if (!username) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /팔로우 @사용자명\n예) /팔로우 @trader123",
    });
  }

  const tgId = ctx.from?.id ?? ctx.chatId;
  const result = await followUser(tgId, username);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: result.message,
  });
}

export async function handleUnfollowCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const username = (input || "").trim().replace(/^@/, "");

  if (!username) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /언팔로우 @사용자명",
    });
  }

  const tgId = ctx.from?.id ?? ctx.chatId;
  const result = await unfollowUser(tgId, username);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: result.message,
  });
}

export async function handleFeedCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const items = await getFollowingFeed(tgId);

  if (!items.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "피드가 비어 있습니다.",
        "",
        "• 아직 아무도 팔로우하지 않았거나",
        "• 팔로우한 사용자가 관심종목을 등록하지 않았습니다.",
        "",
        "/팔로우 @사용자명 으로 다른 트레이더를 팔로우하세요!",
      ].join("\n"),
    });
  }

  // 사용자별 그룹핑
  const groups = new Map<string, any[]>();
  for (const item of items) {
    const key = `${item.chat_id}:${item.displayName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  let msg = `<b>📡 팔로잉 피드</b>\n${LINE}\n`;

  for (const [, stocks] of groups) {
    const name = stocks[0].displayName;
    msg += `\n<b>${esc(name)}</b>\n`;
    for (const s of stocks.slice(0, 5)) {
      const stock = s.stock as any;
      const stockName = stock?.name ?? s.code;
      const close = Number(stock?.close ?? 0);
      const buyPrice = Number(s.buy_price ?? 0);

      let plStr = "";
      if (buyPrice > 0 && close > 0) {
        const plPct = ((close - buyPrice) / buyPrice) * 100;
        plStr = ` ${plPct >= 0 ? "▲" : "▼"} ${fmtPct(plPct)}`;
      }

      msg += `  ${esc(stockName)} <code>${fmtInt(close)}원</code>${plStr}\n`;
    }
    if (stocks.length > 5) {
      msg += `  <i>+${stocks.length - 5}개 더</i>\n`;
    }
  }

  msg += `\n${LINE}\n/랭킹 · /프로필 · /관심`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}
