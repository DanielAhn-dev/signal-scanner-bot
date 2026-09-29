/**
 * FCM 웹 푸시 — 서버(크론·자동매매)에서 사용자에게 알림을 보낸다.
 * 웹 전용 계정(src/services/webAccount.ts)은 텔레그램이 없어서 src/telegram/api.ts가 이 경로로 돌린다.
 * 표시는 서비스워커가 전담하므로 data-only로 보낸다 (handlers/ui/push-send.ts와 같은 규칙).
 */
import { createClient } from "@supabase/supabase-js";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { clientIdForChatId } from "./webAccount";

function getFirebaseAdmin() {
  if (getApps().length) return getApps()[0]!;
  let raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1);
  return initializeApp({ credential: cert(JSON.parse(raw)) });
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/** 텔레그램용 HTML/마크다운 흔적을 걷어 낸 알림 본문 */
export function toPushText(text: string, max = 300): string {
  const plain = String(text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export async function sendPushToChatId(
  chatId: number,
  message: { title?: string; body: string; path?: string }
): Promise<{ ok: boolean; sent: number; description?: string }> {
  const supabase = getSupabase();
  const app = getFirebaseAdmin();
  if (!supabase || !app) return { ok: false, sent: 0, description: "push not configured" };
  const clientId = await clientIdForChatId(supabase, chatId);
  if (!clientId) return { ok: false, sent: 0, description: "no web account for chat" };
  const { data: rows } = await supabase.from("push_tokens").select("token").eq("client_id", clientId);
  const tokens = ((rows ?? []) as Array<{ token: string }>).map((r) => r.token);
  if (tokens.length === 0) return { ok: false, sent: 0, description: "no push tokens" };

  const lines = toPushText(message.body).split("\n");
  const title = message.title || lines[0] || "Signal Scanner";
  const body = message.title ? lines.join("\n") : lines.slice(1).join("\n") || lines[0] || "";
  const data: Record<string, string> = { title, body };
  if (message.path) data.path = message.path;

  const messaging = getMessaging(app);
  const results = await Promise.allSettled(tokens.map((token) => messaging.send({ token, data })));
  const stale = tokens.filter((_, i) => {
    const r = results[i];
    const code = r.status === "rejected" ? (r.reason as { code?: string })?.code : null;
    return code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token";
  });
  if (stale.length) await supabase.from("push_tokens").delete().in("token", stale);
  const sent = results.filter((r) => r.status === "fulfilled").length;
  return { ok: sent > 0, sent };
}
