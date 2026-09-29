/**
 * 알림 받을 곳 — 텔레그램이 연결된 계정도 브라우저(PWA) 푸시로 받을 수 있게 계정별로 고른다.
 *
 * - users.prefs.notify_channel: "telegram"(기본) | "push". 한 곳으로만 보내 같은 알림이 두 번 오지 않는다.
 * - 텔레그램에서 명령을 입력해 받는 답장, [승인][보류] 같은 버튼 메시지는 항상 텔레그램으로 (src/telegram/api.ts).
 * - 웹 전용 계정(텔레그램 미연결)은 설정과 무관하게 푸시 (webAccount.ts).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@supabase/supabase-js";

export type NotifyChannel = "telegram" | "push";

export function normalizeNotifyChannel(raw: unknown): NotifyChannel {
  return raw === "push" ? "push" : "telegram";
}

/** 텔레그램 명령·버튼을 처리하는 동안이면 true — 이때 보내는 메시지는 답장이라 텔레그램으로 간다 */
const replyContext = new AsyncLocalStorage<boolean>();

export function runAsTelegramReply<T>(fn: () => Promise<T>): Promise<T> {
  return replyContext.run(true, fn);
}

export function isTelegramReplyContext(): boolean {
  return replyContext.getStore() === true;
}

const CACHE_MS = 60 * 1000;
const cache = new Map<number, { at: number; channel: NotifyChannel }>();

/** 계정의 알림 채널 (1분 캐시, 조회 실패는 텔레그램) */
export async function resolveNotifyChannel(chatId: number): Promise<NotifyChannel> {
  if (!Number.isFinite(chatId) || chatId <= 0) return "telegram";
  const hit = cache.get(chatId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.channel;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!url || !key) return "telegram";
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await supabase.from("users").select("prefs").eq("tg_id", chatId).maybeSingle();
    const channel = normalizeNotifyChannel((data?.prefs as Record<string, unknown> | null)?.notify_channel);
    cache.set(chatId, { at: Date.now(), channel });
    return channel;
  } catch {
    return "telegram";
  }
}

/** 버튼(inline keyboard)이 달린 메시지는 푸시로 옮기면 버튼이 사라진다 */
export function hasInlineKeyboard(replyMarkup: unknown): boolean {
  let markup = replyMarkup;
  if (typeof markup === "string") {
    try {
      markup = JSON.parse(markup);
    } catch {
      return false;
    }
  }
  const rows = (markup as { inline_keyboard?: unknown[] } | null)?.inline_keyboard;
  return Array.isArray(rows) && rows.length > 0;
}
