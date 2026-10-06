/**
 * 부부(배우자) 연결 — 두 사람이 각자 계정을 유지한 채, 서로 허락한 것만 함께 본다.
 *
 * 규칙 (2026-10-06 사용자 요청: "서로 경제를 같이 만들어 간다")
 *  - 한 사람은 동시에 한 명과만 연결된다(household_members 기본키).
 *  - 연결 코드는 1회용, COUPLE_CODE_TTL_DAYS일 뒤 못 쓴다. 새 코드를 만들면 이전 대기 코드는 무효.
 *  - 아직 가입하지 않은 사람은 코드로 가입하면서 바로 연결된다(초대 전용 모드여도 초대권 없이). 이미 가입한 사람은 코드 입력 즉시 연결.
 *  - 무엇을 보여 줄지(지출·투자·자녀)는 각자 자기 것만 정한다. 기본은 모두 공유.
 *  - 서로의 데이터는 복사하지 않고 연결된 동안 읽기만 한다. 고치거나 지우는 건 자기 기록만. 끊으면 바로 안 보인다.
 */
import { admit, countMembers, generateInviteCode, isMember, normalizeInviteCode, readConfig } from "./invites";

type SupabaseClientAny = any;

export const COUPLE_CODE_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

export type ShareScope = "spending" | "investing" | "children";
export type Shares = Record<ShareScope, boolean>;
export const SHARE_SCOPES: ShareScope[] = ["spending", "investing", "children"];
export const DEFAULT_SHARES: Shares = { spending: true, investing: true, children: true };

export function normalizeShares(raw: unknown): Shares {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { spending: src.spending !== false, investing: src.investing !== false, children: src.children !== false };
}

/** 부분 변경 입력 검증: 알려진 키, 불리언만. 틀리면 null */
export function parseSharesPatch(raw: unknown): Partial<Shares> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Partial<Shares> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SHARE_SCOPES.includes(k as ShareScope) || typeof v !== "boolean") return null;
    out[k as ShareScope] = v;
  }
  return Object.keys(out).length ? out : null;
}

type LinkRow = {
  id: string;
  code: string;
  inviter_client_id: string;
  invitee_client_id: string | null;
  status: "pending" | "active" | "ended" | "cancelled";
  inviter_shares: unknown;
  invitee_shares: unknown;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};

export function isCodeUsable(row: Pick<LinkRow, "status" | "expires_at">, now = Date.now()): boolean {
  return row.status === "pending" && new Date(row.expires_at).getTime() > now;
}

/** 연결된 링크 행에서 나와 상대를 가른다 */
export function sidesOf(row: Pick<LinkRow, "inviter_client_id" | "invitee_client_id" | "inviter_shares" | "invitee_shares">, me: string) {
  const iAmInviter = row.inviter_client_id === me;
  return {
    partnerClientId: (iAmInviter ? row.invitee_client_id : row.inviter_client_id) ?? null,
    myShares: normalizeShares(iAmInviter ? row.inviter_shares : row.invitee_shares),
    partnerShares: normalizeShares(iAmInviter ? row.invitee_shares : row.inviter_shares),
    myColumn: iAmInviter ? "inviter_shares" : "invitee_shares",
  } as const;
}

async function activeLink(supabase: SupabaseClientAny, clientId: string): Promise<LinkRow | null> {
  const { data: member } = await supabase.from("household_members").select("link_id").eq("client_id", clientId).maybeSingle();
  if (!member?.link_id) return null;
  const { data } = await supabase.from("household_links").select("*").eq("id", member.link_id).eq("status", "active").maybeSingle();
  return (data as LinkRow) ?? null;
}

export type HouseholdView =
  | { status: "none"; ttlDays: number }
  | { status: "pending"; code: string; expiresAt: string; ttlDays: number }
  | { status: "active"; partnerClientId: string; since: string; myShares: Shares; partnerShares: Shares };

export async function getHousehold(supabase: SupabaseClientAny, clientId: string, now = Date.now()): Promise<HouseholdView> {
  const link = await activeLink(supabase, clientId);
  if (link) {
    const sides = sidesOf(link, clientId);
    if (sides.partnerClientId) {
      return { status: "active", partnerClientId: sides.partnerClientId, since: link.accepted_at ?? link.created_at, myShares: sides.myShares, partnerShares: sides.partnerShares };
    }
  }
  const { data } = await supabase.from("household_links").select("code,status,expires_at")
    .eq("inviter_client_id", clientId).eq("status", "pending").order("created_at", { ascending: false }).limit(1);
  const pending = (data as Array<Pick<LinkRow, "code" | "status" | "expires_at">> | null)?.[0];
  if (pending && isCodeUsable(pending, now)) return { status: "pending", code: pending.code, expiresAt: pending.expires_at, ttlDays: COUPLE_CODE_TTL_DAYS };
  return { status: "none", ttlDays: COUPLE_CODE_TTL_DAYS };
}

/** 상대가 이 범위를 나에게 보여 주고 있으면 상대 client_id, 아니면 null. 다른 핸들러가 읽기 권한을 확인할 때 쓴다 */
export async function partnerSharing(supabase: SupabaseClientAny, clientId: string, scope: ShareScope): Promise<string | null> {
  const link = await activeLink(supabase, clientId);
  if (!link) return null;
  const sides = sidesOf(link, clientId);
  return sides.partnerClientId && sides.partnerShares[scope] ? sides.partnerClientId : null;
}

export type CoupleResult =
  | { ok: true; code?: string; expiresAt?: string }
  | { ok: false; reason: "already_linked" | "invalid_code" | "used_or_expired" | "own_code" | "not_linked" | "signups_closed" | "full" | "server_error" };

export async function createCoupleCode(supabase: SupabaseClientAny, clientId: string, now = Date.now()): Promise<CoupleResult> {
  if (await activeLink(supabase, clientId)) return { ok: false, reason: "already_linked" };
  // 이전 대기 코드는 무효로 — 한 번에 하나만 살아 있게
  await supabase.from("household_links").update({ status: "cancelled", ended_at: new Date(now).toISOString() })
    .eq("inviter_client_id", clientId).eq("status", "pending");
  const expiresAt = new Date(now + COUPLE_CODE_TTL_DAYS * DAY_MS).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    // 친구 초대 코드와 같은 형식이라, 가입 화면이 한 칸으로 둘 다 받는다. 두 표에서 겹치지 않게 확인한다
    const { data: clash } = await supabase.from("web_invites").select("id").eq("code", code).maybeSingle();
    if (clash) continue;
    const { data, error } = await supabase.from("household_links")
      .insert({ code, inviter_client_id: clientId, expires_at: expiresAt }).select("code,expires_at").maybeSingle();
    if (!error && data) return { ok: true, code: data.code, expiresAt: data.expires_at };
  }
  return { ok: false, reason: "server_error" };
}

export async function cancelCoupleCode(supabase: SupabaseClientAny, clientId: string): Promise<void> {
  await supabase.from("household_links").update({ status: "cancelled", ended_at: new Date().toISOString() })
    .eq("inviter_client_id", clientId).eq("status", "pending");
}

async function callRpc(supabase: SupabaseClientAny, fn: string, args: Record<string, unknown>): Promise<CoupleResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data || typeof data !== "object") return { ok: false, reason: "server_error" };
  if (data.ok === true) return { ok: true };
  const reason = String(data.reason);
  return { ok: false, reason: (["already_linked", "invalid_code", "used_or_expired", "own_code", "not_linked"].includes(reason) ? reason : "server_error") as any };
}

/** 이미 가입한 사람이 코드를 넣어 연결 */
export async function acceptCoupleCode(supabase: SupabaseClientAny, clientId: string, rawCode: unknown): Promise<CoupleResult> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: "invalid_code" };
  return callRpc(supabase, "accept_household_link", { p_code: code, p_client_id: clientId });
}

export async function endCouple(supabase: SupabaseClientAny, clientId: string): Promise<CoupleResult> {
  return callRpc(supabase, "end_household_link", { p_client_id: clientId });
}

export async function setMyShares(supabase: SupabaseClientAny, clientId: string, patch: Partial<Shares>): Promise<CoupleResult & { shares?: Shares }> {
  const link = await activeLink(supabase, clientId);
  if (!link) return { ok: false, reason: "not_linked" };
  const sides = sidesOf(link, clientId);
  const shares = { ...sides.myShares, ...patch };
  const { error } = await supabase.from("household_links").update({ [sides.myColumn]: shares }).eq("id", link.id).eq("status", "active");
  if (error) return { ok: false, reason: "server_error" };
  return { ok: true, shares };
}

/** 가입 화면에서 받은 코드가 부부 연결 코드인가 (친구 초대 코드와 같은 형식이라 먼저 가려 본다) */
export async function isCoupleCode(supabase: SupabaseClientAny, rawCode: unknown): Promise<boolean> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return false;
  const { data } = await supabase.from("household_links").select("id").eq("code", code).maybeSingle();
  return !!data;
}

/**
 * 아직 회원이 아닌 사람이 부부 연결 코드로 가입. 초대권은 필요 없지만 가입 중단·정원은 따른다.
 * 먼저 연결을 잡고(동시에 둘이 쓰지 못하게) 회원으로 들인다. 가입 처리에 실패하면 연결을 되돌린다.
 */
export async function redeemCoupleSignup(supabase: SupabaseClientAny, clientId: string, rawCode: unknown): Promise<CoupleResult & { chatId?: number }> {
  if (await isMember(supabase, clientId)) return acceptCoupleCode(supabase, clientId, rawCode);
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, reason: "invalid_code" };
  const config = await readConfig(supabase);
  if (!config.signupsOpen) return { ok: false, reason: "signups_closed" };
  if (config.maxMembers && (await countMembers(supabase)) >= config.maxMembers) return { ok: false, reason: "full" };
  const { data: link } = await supabase.from("household_links").select("inviter_client_id").eq("code", code).maybeSingle();
  const accepted = await callRpc(supabase, "accept_household_link", { p_code: code, p_client_id: clientId });
  if (!accepted.ok) return accepted;
  const chatId = await admit(supabase, clientId, { inviterClientId: link?.inviter_client_id ?? null, joinedVia: "couple" });
  if (!chatId) {
    await endCouple(supabase, clientId);
    return { ok: false, reason: "server_error" };
  }
  return { ok: true, chatId };
}

export const COUPLE_REASON_MESSAGE: Record<string, string> = {
  already_linked: "이미 다른 사람과 연결되어 있습니다. 먼저 연결을 끊어야 합니다.",
  invalid_code: "연결 코드가 올바르지 않습니다. 코드를 다시 확인해 주세요.",
  used_or_expired: "이미 사용했거나 기간이 지난 연결 코드입니다. 상대에게 새 코드를 받아 주세요.",
  own_code: "내가 만든 연결 코드는 직접 쓸 수 없습니다. 상대가 입력해야 합니다.",
  not_linked: "연결된 사람이 없습니다.",
  signups_closed: "지금은 신규 가입을 받지 않습니다.",
  full: "지금은 정원이 가득 차 가입할 수 없습니다.",
  server_error: "처리 중 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.",
};
