import type { ChatContext } from "./routing/types";
import { createClient } from "@supabase/supabase-js";

function resolveAllowedIds(): Set<number> {
  const allowed = new Set<number>();

  const ownerId = Number(process.env.TELEGRAM_OWNER_USER_ID ?? "0");
  if (Number.isFinite(ownerId) && ownerId !== 0) allowed.add(ownerId);

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

const ACCESS_TABLE = "web_advanced_access_users";
const DB_CACHE_TTL_MS = 30_000;

let cachedDbAllowedIds = new Set<number>();
let cachedDbLoadedAt = 0;

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function resolveDbAllowedIds(): Promise<Set<number>> {
  const now = Date.now();
  if (cachedDbLoadedAt > 0 && now - cachedDbLoadedAt < DB_CACHE_TTL_MS) {
    return cachedDbAllowedIds;
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return new Set<number>();

  try {
    const { data, error } = await supabase
      .from(ACCESS_TABLE)
      .select("chat_id,is_enabled")
      .eq("is_enabled", true)
      .limit(5000);

    if (error) return new Set<number>();

    const next = new Set<number>();
    for (const row of data || []) {
      const chatId = Number((row as any).chat_id ?? 0);
      if (Number.isFinite(chatId) && chatId !== 0) next.add(Math.trunc(chatId));
    }
    cachedDbAllowedIds = next;
    cachedDbLoadedAt = now;
    return next;
  } catch {
    return new Set<number>();
  }
}

export function isAccessControlEnabled(): boolean {
  if (String(process.env.TELEGRAM_ACCESS_CONTROL ?? "").toLowerCase() === "off") {
    return false;
  }
  return resolveAllowedIds().size > 0;
}

export async function isAllowedTelegramUser(ctx: ChatContext): Promise<boolean> {
  if (String(process.env.TELEGRAM_ACCESS_CONTROL ?? "").toLowerCase() === "off") {
    return true;
  }

  const allowed = resolveAllowedIds();
  const actorIds = resolveActorIds(ctx);
  if (actorIds.some((id) => allowed.has(id))) return true;

  const dbAllowed = await resolveDbAllowedIds();
  if (dbAllowed.size > 0) {
    return actorIds.some((id) => dbAllowed.has(id));
  }

  if (allowed.size > 0) return false;
  return true;
}

export function buildAccessDeniedMessage(): string {
  return [
    "이 봇은 현재 허용된 사용자만 사용할 수 있습니다.",
    "접근 권한이 필요하면 관리자에게 Telegram ID 등록을 요청해 주세요.",
  ].join("\n");
}
