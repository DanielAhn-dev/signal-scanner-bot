import type { ChatContext } from "./routing/types";

function parseIdSet(raw: string | undefined): Set<number> {
  const result = new Set<number>();
  for (const token of String(raw ?? "").split(/[\s,]+/).filter(Boolean)) {
    const id = Number(token);
    if (Number.isFinite(id) && id !== 0) result.add(id);
  }
  return result;
}

function mergeInto(target: Set<number>, source: Set<number>): void {
  for (const id of source) target.add(id);
}

function resolveAllowedIds(): Set<number> {
  const allowed = new Set<number>();

  mergeInto(allowed, parseIdSet(process.env.TELEGRAM_ALLOWED_USER_IDS));
  mergeInto(allowed, parseIdSet(process.env.TELEGRAM_OPS_CHAT_IDS));

  const ownerId = Number(process.env.TELEGRAM_OWNER_USER_ID ?? "0");
  if (Number.isFinite(ownerId) && ownerId !== 0) allowed.add(ownerId);

  const adminChatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID ?? "0");
  if (Number.isFinite(adminChatId) && adminChatId !== 0) allowed.add(adminChatId);

  const alertChatId = Number(process.env.AUTO_TRADE_ALERT_CHAT_ID ?? "0");
  if (Number.isFinite(alertChatId) && alertChatId !== 0) allowed.add(alertChatId);

  return allowed;
}

function resolveActorIds(ctx: ChatContext): number[] {
  const actorId = Number((ctx.from as any)?.id ?? 0);
  const chatId = Number(ctx.chatId);
  const ids: number[] = [];
  if (Number.isFinite(actorId) && actorId !== 0) ids.push(actorId);
  if (Number.isFinite(chatId) && chatId !== 0) ids.push(chatId);
  return ids;
}

export function isAccessControlEnabled(): boolean {
  if (String(process.env.TELEGRAM_ACCESS_CONTROL ?? "").toLowerCase() === "off") {
    return false;
  }
  return resolveAllowedIds().size > 0;
}

export function isAllowedTelegramUser(ctx: ChatContext): boolean {
  const allowed = resolveAllowedIds();
  if (allowed.size === 0) return true;

  const actorIds = resolveActorIds(ctx);
  return actorIds.some((id) => allowed.has(id));
}

export function buildAccessDeniedMessage(): string {
  return [
    "이 봇은 현재 허용된 사용자만 사용할 수 있습니다.",
    "접근 권한이 필요하면 관리자에게 Telegram ID 등록을 요청해 주세요.",
  ].join("\n");
}
