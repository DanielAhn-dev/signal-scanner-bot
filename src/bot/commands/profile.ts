// src/bot/commands/profile.ts
// /프로필 — 내 사용 통계

import type { ChatContext } from "../router";
import { getUserProfile } from "../../services/userService";
import { esc, LINE } from "../messages/format";

export async function handleProfileCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const p = await getUserProfile(tgId);

  if (!p.user) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "프로필 정보가 없습니다.\n/start 로 먼저 등록해주세요.",
    });
  }

  const name = p.user.first_name || p.user.username || "사용자";
  const username = p.user.username ? `@${p.user.username}` : "미설정";
  const joined = p.user.created_at
    ? new Date(p.user.created_at).toLocaleDateString("ko-KR")
    : "—";
  const lastActive = p.user.last_active_at
    ? timeAgo(new Date(p.user.last_active_at))
    : "—";
  const prefs = (p.user.prefs || {}) as Record<string, unknown>;
  const riskProfile =
    prefs.risk_profile === "balanced"
      ? "균형형"
      : prefs.risk_profile === "active"
        ? "공격형"
        : "안전형";

  const msg = [
    `<b>👤 ${esc(name)} 프로필</b>`,
    LINE,
    "",
    `  사용자명  ${esc(username)}`,
    `  가입일    ${joined}`,
    `  최근활동  ${lastActive}`,
    `  투자성향  ${riskProfile}`,
    "",
    `  📊 명령어 사용  <code>${p.commandCount}</code>회`,
    `  ⭐ 관심종목     <code>${p.watchlistCount}</code>개`,
    `  👥 팔로워       <code>${p.followerCount}</code>명`,
    `  👤 팔로잉       <code>${p.followingCount}</code>명`,
    "",
    LINE,
    `/랭킹 · /팔로우 @닉네임 · /관심`,
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}일 전`;
}
