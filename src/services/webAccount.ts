/**
 * 웹 전용 계정 — 텔레그램 없이 구글 로그인만으로 쓰는 사용자.
 *
 * 계좌·설정·매매 기록은 전부 chat_id(users.tg_id) 기준이라, 텔레그램 ID가 없는 로그인 계정에는
 * 예약 번호대의 고유 ID를 만들어 web_user_profiles.telegram_id에 넣고 chat_id처럼 쓴다.
 * 실제 텔레그램 사용자 ID는 아직 100억(1e10) 미만이라 9조(9e12) 이상은 겹치지 않는다.
 * 이 ID로 가는 텔레그램 메시지는 src/telegram/api.ts에서 FCM 푸시로 대신 보낸다.
 */
import { createHash } from "node:crypto";

type SupabaseClientAny = any;

export const WEB_ACCOUNT_ID_BASE = 9_000_000_000_000;
const WEB_ACCOUNT_ID_SPAN = 1_000_000_000_000;

export function isWebOnlyChatId(chatId: unknown): boolean {
  const n = Number(chatId);
  return Number.isFinite(n) && n >= WEB_ACCOUNT_ID_BASE && n < WEB_ACCOUNT_ID_BASE + WEB_ACCOUNT_ID_SPAN;
}

/** 로그인 계정(client_id)마다 항상 같은 ID — 여러 요청이 동시에 만들어도 같은 값으로 수렴한다 */
export function webAccountIdFor(clientId: string): number {
  const hex = createHash("sha256").update(`web-account:${clientId}`).digest("hex").slice(0, 12);
  return WEB_ACCOUNT_ID_BASE + (parseInt(hex, 16) % WEB_ACCOUNT_ID_SPAN);
}

/**
 * 로그인 계정의 chat_id를 돌려준다. 텔레그램 ID가 연결돼 있으면 그대로, 없으면 웹 전용 ID를 만들어 연결한다.
 * users 행도 함께 만든다 — 설정 저장이 users.update(eq tg_id)라 행이 없으면 0건 갱신으로 조용히 사라진다.
 */
export async function ensureWebAccountChatId(supabase: SupabaseClientAny, clientId: string): Promise<number | null> {
  if (!clientId) return null;
  const { data: profile, error } = await supabase
    .from("web_user_profiles")
    .select("telegram_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return null;
  const linked = Number(profile?.telegram_id);
  if (Number.isFinite(linked) && linked > 0) return linked;

  const chatId = webAccountIdFor(clientId);
  const write = profile
    ? await supabase.from("web_user_profiles").update({ telegram_id: chatId }).eq("client_id", clientId)
    : await supabase.from("web_user_profiles").insert({ client_id: clientId, telegram_id: chatId });
  if (write.error) return null;
  await ensureWebAccountUserRow(supabase, chatId);
  return chatId;
}

/** users 행이 없으면 만든다 (있으면 건드리지 않는다) */
export async function ensureWebAccountUserRow(supabase: SupabaseClientAny, chatId: number): Promise<void> {
  await supabase
    .from("users")
    .upsert(
      { tg_id: chatId, first_name: "web", language_code: "ko", is_active: true, last_active_at: new Date().toISOString() },
      { onConflict: "tg_id", ignoreDuplicates: true }
    );
}

/** chat_id → 로그인 계정(client_id). FCM 토큰이 client_id 기준이라 푸시를 보낼 때 쓴다 */
export async function clientIdForChatId(supabase: SupabaseClientAny, chatId: number): Promise<string | null> {
  const { data } = await supabase.from("web_user_profiles").select("client_id").eq("telegram_id", chatId).limit(1);
  return (data as Array<{ client_id: string }> | null)?.[0]?.client_id ?? null;
}
