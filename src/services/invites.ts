/**
 * 초대 전용 가입 — UI_INVITE_ONLY=true일 때만 켜진다 (꺼져 있으면 기존처럼 로그인 즉시 가입).
 *
 * 규칙
 *  - 이미 web_user_profiles가 있는 계정은 기존 회원이다. 관리자(UI_ADMIN_CLIENT_IDS)는 항상 통과한다.
 *  - 새 회원은 가입 즉시 초대권 1장을 받는다. 초대권은 1회용이고 14일 뒤 소멸한다.
 *  - 초대받은 사람이 7일 이상 쓰면서 시작 설정을 마치면(= "활동 인정") 초대한 사람에게 새 초대권 1장이 생긴다.
 *  - 쓰지 않아 초대권이 모두 사라진 회원에게는 마지막 발급 30일 뒤 1장이 다시 생긴다.
 *  - 한 사람이 동시에 가질 수 있는 초대권은 최대 MAX_OPEN_INVITES장이다.
 *  - 관리자는 가입 중단 스위치·전체 회원 상한·초대권 직접 발급/회수·가입 신청 승인 권한이 있다.
 */
import { randomBytes } from "node:crypto";
import { ensureWebAccountChatId } from "./webAccount";

type SupabaseClientAny = any;

export const INVITE_TTL_DAYS = 14;
export const MAX_OPEN_INVITES = 2;
export const ACTIVATION_DAYS = 7;
export const REFILL_DAYS = 30;

const DAY_MS = 86_400_000;
// 헷갈리는 글자(0/O, 1/I/L)를 뺀 32자
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function isInviteOnly(): boolean {
  return ["1", "true", "yes"].includes(String(process.env.UI_INVITE_ONLY || "").trim().toLowerCase());
}

export function isEnvAdminClient(clientId: string | null | undefined): boolean {
  if (!clientId) return false;
  const raw = String(process.env.UI_ADMIN_CLIENT_IDS || process.env.UI_ADMIN_CLIENT_ID || "");
  return raw.split(",").map((v) => v.trim()).filter(Boolean).includes(clientId);
}

/** 사람이 옮겨 적기 쉬운 10자 코드 (XXXXX-XXXXX) */
export function generateInviteCode(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** 입력값(공백·소문자·하이픈 누락)을 저장 형식으로 맞춘다. 형식이 틀리면 null */
export function normalizeInviteCode(raw: unknown): string | null {
  const compact = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 10) return null;
  if ([...compact].some((ch) => !CODE_ALPHABET.includes(ch))) return null;
  return `${compact.slice(0, 5)}-${compact.slice(5)}`;
}

export type InviteRow = {
  id: string;
  code: string;
  inviter_client_id: string | null;
  status: "open" | "used" | "revoked";
  created_at: string;
  expires_at: string;
  used_by_client_id: string | null;
  used_at: string | null;
  rewarded_at: string | null;
};

export function isInviteUsable(row: Pick<InviteRow, "status" | "expires_at">, now = Date.now()): boolean {
  return row.status === "open" && new Date(row.expires_at).getTime() > now;
}

/** 초대받은 사람이 "활동 인정"을 받았는지: 가입 후 ACTIVATION_DAYS 경과 + 시작 설정(prefs) 저장 */
export function isInviteeActivated(usedAt: string | null, hasSetup: boolean, now = Date.now()): boolean {
  if (!usedAt || !hasSetup) return false;
  return now - new Date(usedAt).getTime() >= ACTIVATION_DAYS * DAY_MS;
}

/**
 * 지금 새로 발급해야 할 초대권 수.
 *  - 아직 한 번도 못 받았으면 1장 (가입 직후)
 *  - 쓸 수 있는 초대권이 없고 마지막 발급이 REFILL_DAYS 이전이면 1장 (월 보충)
 */
export function planRefill(args: { openCount: number; lastIssuedAt: string | null; now?: number }): number {
  const now = args.now ?? Date.now();
  if (args.openCount >= MAX_OPEN_INVITES) return 0;
  if (!args.lastIssuedAt) return 1;
  if (args.openCount > 0) return 0;
  return now - new Date(args.lastIssuedAt).getTime() >= REFILL_DAYS * DAY_MS ? 1 : 0;
}

export function nextRefillAt(lastIssuedAt: string | null): string | null {
  if (!lastIssuedAt) return null;
  return new Date(new Date(lastIssuedAt).getTime() + REFILL_DAYS * DAY_MS).toISOString();
}

// ── 운영 설정 ────────────────────────────────────────────────────────────
export type InviteConfig = { signupsOpen: boolean; maxMembers: number | null };

export async function readConfig(supabase: SupabaseClientAny): Promise<InviteConfig> {
  const { data } = await supabase.from("web_invite_config").select("key,value");
  const map = new Map<string, unknown>((data ?? []).map((r: any) => [r.key, r.value]));
  const max = Number(map.get("max_members"));
  return {
    signupsOpen: map.get("signups_open") !== false,
    maxMembers: Number.isFinite(max) && max > 0 ? Math.trunc(max) : null,
  };
}

export async function writeConfig(supabase: SupabaseClientAny, patch: Partial<InviteConfig>): Promise<void> {
  const rows: Array<{ key: string; value: unknown; updated_at: string }> = [];
  const now = new Date().toISOString();
  if (patch.signupsOpen !== undefined) rows.push({ key: "signups_open", value: patch.signupsOpen, updated_at: now });
  if (patch.maxMembers !== undefined) rows.push({ key: "max_members", value: patch.maxMembers ?? 0, updated_at: now });
  if (rows.length) await supabase.from("web_invite_config").upsert(rows, { onConflict: "key" });
}

// ── 회원 판정 ────────────────────────────────────────────────────────────
export async function isMember(supabase: SupabaseClientAny, clientId: string): Promise<boolean> {
  if (isEnvAdminClient(clientId)) return true;
  const { data } = await supabase.from("web_user_profiles").select("client_id").eq("client_id", clientId).maybeSingle();
  return !!data;
}

/** 초대 전용 모드에서 이 로그인 계정에 회원 계정을 새로 만들어도 되는가 (기존 회원·관리자만 true) */
export async function mayCreateAccount(supabase: SupabaseClientAny, clientId: string): Promise<boolean> {
  if (!isInviteOnly()) return true;
  return isMember(supabase, clientId);
}

export async function countMembers(supabase: SupabaseClientAny): Promise<number> {
  const { count } = await supabase.from("web_user_profiles").select("client_id", { count: "exact", head: true });
  return count ?? 0;
}

/** 회원으로 들인다. 부부 연결 코드 가입(src/services/household.ts)도 이걸 쓴다 */
export async function admit(
  supabase: SupabaseClientAny,
  clientId: string,
  via: { inviterClientId: string | null; joinedVia: "invite" | "approved" | "couple" },
): Promise<number | null> {
  const chatId = await ensureWebAccountChatId(supabase, clientId);
  if (!chatId) return null;
  await supabase
    .from("web_user_profiles")
    .update({ invited_by_client_id: via.inviterClientId, joined_via: via.joinedVia })
    .eq("client_id", clientId);
  // 가입 직후 초대권 1장
  await issueInvites(supabase, clientId, 1);
  return chatId;
}

// ── 초대권 발급·사용 ─────────────────────────────────────────────────────
export async function issueInvites(supabase: SupabaseClientAny, inviterClientId: string | null, count: number): Promise<InviteRow[]> {
  const out: InviteRow[] = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from("web_invites")
        .insert({
          code: generateInviteCode(),
          inviter_client_id: inviterClientId,
          expires_at: new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS).toISOString(),
        })
        .select("*")
        .maybeSingle();
      if (!error && data) {
        out.push(data as InviteRow);
        break;
      }
      // 코드 충돌(unique)이면 다시 뽑는다
    }
  }
  return out;
}

export type RedeemResult =
  | { ok: true; chatId: number }
  | { ok: false; reason: "invalid_code" | "used_or_expired" | "signups_closed" | "full" | "own_code" | "server_error" };

export async function redeemInvite(supabase: SupabaseClientAny, clientId: string, rawCode: unknown): Promise<RedeemResult> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: "invalid_code" };

  const config = await readConfig(supabase);
  if (!config.signupsOpen) return { ok: false, reason: "signups_closed" };
  if (config.maxMembers && (await countMembers(supabase)) >= config.maxMembers) return { ok: false, reason: "full" };

  const { data: row } = await supabase.from("web_invites").select("*").eq("code", code).maybeSingle();
  if (!row) return { ok: false, reason: "invalid_code" };
  if (row.inviter_client_id && row.inviter_client_id === clientId) return { ok: false, reason: "own_code" };

  // 조건부 갱신 — 동시에 두 명이 같은 코드를 눌러도 한 명만 통과한다
  const nowIso = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("web_invites")
    .update({ status: "used", used_by_client_id: clientId, used_at: nowIso })
    .eq("id", row.id)
    .eq("status", "open")
    .gt("expires_at", nowIso)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, reason: "used_or_expired" };

  const chatId = await admit(supabase, clientId, { inviterClientId: row.inviter_client_id ?? null, joinedVia: "invite" });
  if (!chatId) {
    // 가입 처리에 실패했으면 초대권을 되돌린다
    await supabase
      .from("web_invites")
      .update({ status: "open", used_by_client_id: null, used_at: null })
      .eq("id", row.id)
      .eq("used_by_client_id", clientId);
    return { ok: false, reason: "server_error" };
  }
  await supabase.from("web_signup_requests").update({ status: "approved", decided_at: nowIso }).eq("client_id", clientId).eq("status", "pending");
  return { ok: true, chatId };
}

// ── 가입 신청(대기열) ────────────────────────────────────────────────────
export async function submitSignupRequest(
  supabase: SupabaseClientAny,
  clientId: string,
  email: string | null,
  note: string | null,
): Promise<{ status: "pending" | "approved" | "rejected" }> {
  const { data: existing } = await supabase.from("web_signup_requests").select("status").eq("client_id", clientId).maybeSingle();
  // 거절된 신청은 다시 넣을 수 없다 (같은 계정으로 계속 두드리는 것 방지)
  if (existing) return { status: existing.status };
  await supabase.from("web_signup_requests").insert({
    client_id: clientId,
    email: email ? String(email).slice(0, 200) : null,
    note: note ? String(note).slice(0, 300) : null,
  });
  return { status: "pending" };
}

/** 승인된 신청자는 다음 접속 때 회원으로 들인다 */
export async function admitIfApproved(supabase: SupabaseClientAny, clientId: string): Promise<boolean> {
  const { data } = await supabase.from("web_signup_requests").select("status").eq("client_id", clientId).maybeSingle();
  if (data?.status !== "approved") return false;
  const config = await readConfig(supabase);
  if (!config.signupsOpen) return false;
  return (await admit(supabase, clientId, { inviterClientId: null, joinedVia: "approved" })) !== null;
}

// ── 내 초대권 현황 (조회 시점에 만료 정리·보상·월 보충을 함께 처리) ────────────
export type MyInvites = {
  open: Array<{ code: string; expiresAt: string }>;
  invited: Array<{ joinedAt: string; activated: boolean; activatesAt: string }>;
  nextRefillAt: string | null;
  maxOpen: number;
  ttlDays: number;
  activationDays: number;
};

async function inviteeHasSetup(supabase: SupabaseClientAny, inviteeClientId: string): Promise<boolean> {
  const { data: profile } = await supabase.from("web_user_profiles").select("telegram_id").eq("client_id", inviteeClientId).maybeSingle();
  const chatId = Number(profile?.telegram_id);
  if (!Number.isFinite(chatId) || chatId <= 0) return false;
  const { data: user } = await supabase.from("users").select("prefs").eq("tg_id", chatId).maybeSingle();
  const prefs = user?.prefs;
  return !!prefs && typeof prefs === "object" && Object.keys(prefs).length > 0;
}

export async function getMyInvites(supabase: SupabaseClientAny, clientId: string): Promise<MyInvites> {
  const now = Date.now();
  const { data: mineRaw } = await supabase.from("web_invites").select("*").eq("inviter_client_id", clientId).order("created_at", { ascending: false }).limit(200);
  let mine = (mineRaw ?? []) as InviteRow[];

  // 1) 초대받은 사람의 활동 인정 → 보상 초대권
  for (const inv of mine.filter((r) => r.status === "used" && !r.rewarded_at && r.used_by_client_id)) {
    const openNow = mine.filter((r) => isInviteUsable(r, now)).length;
    if (openNow >= MAX_OPEN_INVITES) break; // 가득 찼으면 다음 조회 때 다시 본다
    if (!isInviteeActivated(inv.used_at, await inviteeHasSetup(supabase, inv.used_by_client_id!), now)) continue;
    const { data: marked } = await supabase
      .from("web_invites")
      .update({ rewarded_at: new Date(now).toISOString() })
      .eq("id", inv.id)
      .is("rewarded_at", null)
      .select("id")
      .maybeSingle();
    if (marked) mine = [...(await issueInvites(supabase, clientId, 1)), ...mine];
  }

  // 2) 월 보충 / 첫 지급
  const openCount = mine.filter((r) => isInviteUsable(r, now)).length;
  const lastIssuedAt = mine.length ? mine.reduce((a, r) => (r.created_at > a ? r.created_at : a), mine[0].created_at) : null;
  const refill = planRefill({ openCount, lastIssuedAt, now });
  if (refill > 0) mine = [...(await issueInvites(supabase, clientId, refill)), ...mine];

  const newest = mine.length ? mine.reduce((a, r) => (r.created_at > a ? r.created_at : a), mine[0].created_at) : null;
  return {
    open: mine.filter((r) => isInviteUsable(r, now)).map((r) => ({ code: r.code, expiresAt: r.expires_at })),
    invited: mine
      .filter((r) => r.status === "used" && r.used_at)
      .map((r) => ({
        joinedAt: r.used_at!,
        activated: !!r.rewarded_at,
        activatesAt: new Date(new Date(r.used_at!).getTime() + ACTIVATION_DAYS * DAY_MS).toISOString(),
      })),
    nextRefillAt: nextRefillAt(newest),
    maxOpen: MAX_OPEN_INVITES,
    ttlDays: INVITE_TTL_DAYS,
    activationDays: ACTIVATION_DAYS,
  };
}
