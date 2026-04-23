// src/services/userService.ts
// 사용자 등록 · 활동 추적 · 팔로우 · 랭킹

import { createClient } from "@supabase/supabase-js";

let supabaseWriteClient: any = null;
let supabaseReadClient: any = null;

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function getSupabaseWriteClient(): any {
  if (supabaseWriteClient) return supabaseWriteClient;
  supabaseWriteClient = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
  );
  return supabaseWriteClient;
}

function getSupabaseReadClient(): any {
  if (supabaseReadClient) return supabaseReadClient;
  const url = getRequiredEnv("SUPABASE_URL");
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = anonKey || serviceRoleKey;

  if (!key) {
    throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  supabaseReadClient = createClient(url, key);
  return supabaseReadClient;
}

const supabase: any = new Proxy({}, {
  get(_target, prop) {
    const client = getSupabaseWriteClient() as unknown as Record<string, unknown>;
    const value = client[prop as string];
    if (typeof value === "function") {
      return (value as Function).bind(client);
    }
    return value;
  },
});

const supabaseRead: any = new Proxy({}, {
  get(_target, prop) {
    const client = getSupabaseReadClient() as unknown as Record<string, unknown>;
    const value = client[prop as string];
    if (typeof value === "function") {
      return (value as Function).bind(client);
    }
    return value;
  },
});

export interface TelegramFrom {
  id: number;
  first_name?: string;
  username?: string;
  language_code?: string;
}

export type InvestmentPrefs = {
  capital_krw?: number;
  split_count?: number;
  virtual_sell_split_count?: number;
  target_profit_pct?: number;
  risk_profile?: "safe" | "balanced" | "active";
  virtual_seed_capital?: number;
  virtual_cash?: number;
  virtual_realized_pnl?: number;
  virtual_target_positions?: number;
  virtual_fee_rate?: number;
  virtual_tax_rate?: number;
  daily_loss_limit_pct?: number;
  pacing_target_annual_pct?: number;
  pacing_target_monthly_pct?: number;
  pacing_state?: "behind" | "on-track" | "ahead";
  pacing_last_updated_at?: string;
  fallback_relax_level?: 0 | 1 | 2;
  trade_freeze_reason?: string;
  weekly_copilot_last_run_at?: string;
  weekly_copilot_last_mode?: "normal" | "forced";
  weekly_copilot_last_status?: "success" | "partial";
};

function resolveDefaultAutoTradeStrategy(
  riskProfile?: InvestmentPrefs["risk_profile"]
): string {
  if (riskProfile === "active") return "POSITION_CORE";
  if (riskProfile === "balanced") return "SWING";
  return "HOLD_SAFE";
}

// ─── 사용자 등록/업데이트 ───

/** 모든 명령어 실행 시 호출 — upsert + last_active 갱신 */
export async function ensureUser(from: TelegramFrom): Promise<void> {
  try {
    await supabase.from("users").upsert(
      {
        tg_id: from.id,
        username: from.username || null,
        first_name: from.first_name || null,
        language_code: from.language_code || "ko",
        last_active_at: new Date().toISOString(),
        is_active: true,
      },
      { onConflict: "tg_id", ignoreDuplicates: false }
    );
  } catch (e) {
    console.error("ensureUser error:", e);
  }
}

export async function getUserInvestmentPrefs(
  tgId: number
): Promise<InvestmentPrefs> {
  const { data } = await supabaseRead
    .from("users")
    .select("prefs")
    .eq("tg_id", tgId)
    .single();

  const prefs = (data?.prefs || {}) as Record<string, unknown>;
  const out: InvestmentPrefs = {};

  const cap = Number(prefs.capital_krw);
  const split = Number(prefs.split_count);
  const virtualSellSplitCount = Number(prefs.virtual_sell_split_count);
  const target = Number(prefs.target_profit_pct);
  const riskProfile = typeof prefs.risk_profile === "string" ? prefs.risk_profile : undefined;
  const virtualSeed = Number(prefs.virtual_seed_capital);
  const virtualCash = Number(prefs.virtual_cash);
  const virtualRealizedPnl = Number(prefs.virtual_realized_pnl);
  const virtualTargetPositions = Number(prefs.virtual_target_positions);
  const virtualFeeRate = Number(prefs.virtual_fee_rate);
  const virtualTaxRate = Number(prefs.virtual_tax_rate);
  const dailyLossLimitPct = Number(prefs.daily_loss_limit_pct);
  const pacingTargetAnnualPct = Number(prefs.pacing_target_annual_pct);
  const pacingTargetMonthlyPct = Number(prefs.pacing_target_monthly_pct);
  const fallbackRelaxLevel = Number(prefs.fallback_relax_level);
  const pacingState = typeof prefs.pacing_state === "string" ? prefs.pacing_state : undefined;
  const pacingLastUpdatedAt =
    typeof prefs.pacing_last_updated_at === "string" ? prefs.pacing_last_updated_at : undefined;
  const tradeFreezeReason =
    typeof prefs.trade_freeze_reason === "string" ? prefs.trade_freeze_reason : undefined;
  const weeklyCopilotLastRunAt =
    typeof prefs.weekly_copilot_last_run_at === "string"
      ? prefs.weekly_copilot_last_run_at
      : undefined;
  const weeklyCopilotLastMode =
    prefs.weekly_copilot_last_mode === "forced" || prefs.weekly_copilot_last_mode === "normal"
      ? prefs.weekly_copilot_last_mode
      : undefined;
  const weeklyCopilotLastStatus =
    prefs.weekly_copilot_last_status === "success" ||
    prefs.weekly_copilot_last_status === "partial"
      ? prefs.weekly_copilot_last_status
      : undefined;

  if (Number.isFinite(cap) && cap > 0) out.capital_krw = cap;
  if (Number.isFinite(split) && split > 0) out.split_count = Math.floor(split);
  if (Number.isFinite(virtualSellSplitCount) && virtualSellSplitCount > 0) {
    out.virtual_sell_split_count = Math.floor(virtualSellSplitCount);
  }
  if (Number.isFinite(target) && target > 0) out.target_profit_pct = target;
  if (riskProfile === "safe" || riskProfile === "balanced" || riskProfile === "active") {
    out.risk_profile = riskProfile;
  }
  if (Number.isFinite(virtualSeed) && virtualSeed >= 0) out.virtual_seed_capital = virtualSeed;
  if (Number.isFinite(virtualCash) && virtualCash >= 0) out.virtual_cash = virtualCash;
  if (Number.isFinite(virtualRealizedPnl)) out.virtual_realized_pnl = virtualRealizedPnl;
  if (Number.isFinite(virtualTargetPositions) && virtualTargetPositions > 0) {
    out.virtual_target_positions = Math.floor(virtualTargetPositions);
  }
  if (Number.isFinite(virtualFeeRate) && virtualFeeRate >= 0) out.virtual_fee_rate = virtualFeeRate;
  if (Number.isFinite(virtualTaxRate) && virtualTaxRate >= 0) out.virtual_tax_rate = virtualTaxRate;
  if (Number.isFinite(dailyLossLimitPct) && dailyLossLimitPct > 0) {
    out.daily_loss_limit_pct = dailyLossLimitPct;
  }
  if (Number.isFinite(pacingTargetAnnualPct) && pacingTargetAnnualPct > 0) {
    out.pacing_target_annual_pct = pacingTargetAnnualPct;
  }
  if (Number.isFinite(pacingTargetMonthlyPct) && pacingTargetMonthlyPct > 0) {
    out.pacing_target_monthly_pct = pacingTargetMonthlyPct;
  }
  if (pacingState === "behind" || pacingState === "on-track" || pacingState === "ahead") {
    out.pacing_state = pacingState;
  }
  if (pacingLastUpdatedAt) {
    out.pacing_last_updated_at = pacingLastUpdatedAt;
  }
  if (Number.isFinite(fallbackRelaxLevel) && fallbackRelaxLevel >= 0 && fallbackRelaxLevel <= 2) {
    out.fallback_relax_level = Math.floor(fallbackRelaxLevel) as 0 | 1 | 2;
  }
  if (tradeFreezeReason) {
    out.trade_freeze_reason = tradeFreezeReason;
  }
  if (weeklyCopilotLastRunAt) {
    out.weekly_copilot_last_run_at = weeklyCopilotLastRunAt;
  }
  if (weeklyCopilotLastMode) {
    out.weekly_copilot_last_mode = weeklyCopilotLastMode;
  }
  if (weeklyCopilotLastStatus) {
    out.weekly_copilot_last_status = weeklyCopilotLastStatus;
  }

  return out;
}

export async function setUserInvestmentPrefs(
  tgId: number,
  patch: InvestmentPrefs
): Promise<{ ok: boolean; prefs?: InvestmentPrefs; message?: string }> {
  const { data: userRow } = await supabase
    .from("users")
    .select("prefs")
    .eq("tg_id", tgId)
    .single();

  const currentPrefs = ((userRow?.prefs as Record<string, unknown>) || {}) as Record<
    string,
    unknown
  >;
  const merged = {
    ...currentPrefs,
    ...patch,
  };

  const { error } = await supabase
    .from("users")
    .update({ prefs: merged, last_active_at: new Date().toISOString() })
    .eq("tg_id", tgId);

  if (error) {
    console.error("setUserInvestmentPrefs error:", error);
    return { ok: false, message: "투자금 설정 저장 중 오류가 발생했습니다." };
  }

  if (
    patch.risk_profile === "safe" ||
    patch.risk_profile === "balanced" ||
    patch.risk_profile === "active"
  ) {
    const selectedStrategy = resolveDefaultAutoTradeStrategy(patch.risk_profile);
    const { error: strategySyncError } = await supabase
      .from("virtual_autotrade_settings")
      .upsert(
        {
          chat_id: tgId,
          selected_strategy: selectedStrategy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "chat_id" }
      );

    if (strategySyncError) {
      console.error("setUserInvestmentPrefs strategy sync error:", strategySyncError);
    }
  }

  return {
    ok: true,
    prefs: {
      capital_krw: Number(merged.capital_krw || 0) || undefined,
      split_count: Number(merged.split_count || 0) || undefined,
      virtual_sell_split_count: Number(merged.virtual_sell_split_count || 0) || undefined,
      target_profit_pct: Number(merged.target_profit_pct || 0) || undefined,
      risk_profile:
        merged.risk_profile === "safe" ||
        merged.risk_profile === "balanced" ||
        merged.risk_profile === "active"
          ? (merged.risk_profile as "safe" | "balanced" | "active")
          : undefined,
      virtual_seed_capital:
        Number.isFinite(Number(merged.virtual_seed_capital))
          ? Number(merged.virtual_seed_capital)
          : undefined,
      virtual_cash:
        Number.isFinite(Number(merged.virtual_cash))
          ? Number(merged.virtual_cash)
          : undefined,
      virtual_realized_pnl:
        Number.isFinite(Number(merged.virtual_realized_pnl))
          ? Number(merged.virtual_realized_pnl)
          : undefined,
      virtual_target_positions:
        Number.isFinite(Number(merged.virtual_target_positions))
          ? Math.floor(Number(merged.virtual_target_positions))
          : undefined,
      virtual_fee_rate:
        Number.isFinite(Number(merged.virtual_fee_rate))
          ? Number(merged.virtual_fee_rate)
          : undefined,
      virtual_tax_rate:
        Number.isFinite(Number(merged.virtual_tax_rate))
          ? Number(merged.virtual_tax_rate)
          : undefined,
      daily_loss_limit_pct:
        Number.isFinite(Number(merged.daily_loss_limit_pct))
          ? Number(merged.daily_loss_limit_pct)
          : undefined,
      pacing_target_annual_pct:
        Number.isFinite(Number(merged.pacing_target_annual_pct))
          ? Number(merged.pacing_target_annual_pct)
          : undefined,
      pacing_target_monthly_pct:
        Number.isFinite(Number(merged.pacing_target_monthly_pct))
          ? Number(merged.pacing_target_monthly_pct)
          : undefined,
      pacing_state:
        merged.pacing_state === "behind" ||
        merged.pacing_state === "on-track" ||
        merged.pacing_state === "ahead"
          ? (merged.pacing_state as "behind" | "on-track" | "ahead")
          : undefined,
      pacing_last_updated_at:
        typeof merged.pacing_last_updated_at === "string"
          ? merged.pacing_last_updated_at
          : undefined,
      fallback_relax_level:
        Number.isFinite(Number(merged.fallback_relax_level))
          ? (Math.max(0, Math.min(2, Math.floor(Number(merged.fallback_relax_level)))) as 0 | 1 | 2)
          : undefined,
      trade_freeze_reason:
        typeof merged.trade_freeze_reason === "string"
          ? merged.trade_freeze_reason
          : undefined,
      weekly_copilot_last_run_at:
        typeof merged.weekly_copilot_last_run_at === "string"
          ? merged.weekly_copilot_last_run_at
          : undefined,
      weekly_copilot_last_mode:
        merged.weekly_copilot_last_mode === "forced" ||
        merged.weekly_copilot_last_mode === "normal"
          ? (merged.weekly_copilot_last_mode as "normal" | "forced")
          : undefined,
      weekly_copilot_last_status:
        merged.weekly_copilot_last_status === "success" ||
        merged.weekly_copilot_last_status === "partial"
          ? (merged.weekly_copilot_last_status as "success" | "partial")
          : undefined,
    },
  };
}

/** 명령어 사용 로그 */
export async function logActivity(
  tgId: number,
  command: string,
  args?: string
): Promise<void> {
  try {
    await supabase.from("user_activity").insert({
      tg_id: tgId,
      command,
      args: args || null,
    });
  } catch (e) {
    console.error("logActivity error:", e);
  }
}

// ─── 프로필 ───

export async function getUserProfile(tgId: number) {
  const [userRes, activityRes, watchRes, followersRes, followingRes] =
    await Promise.all([
      supabaseRead.from("users").select("*").eq("tg_id", tgId).single(),
      supabaseRead
        .from("user_activity")
        .select("id", { count: "exact", head: true })
        .eq("tg_id", tgId),
      supabaseRead
        .from("watchlist")
        .select("id", { count: "exact", head: true })
        .eq("chat_id", tgId),
      supabaseRead
        .from("follows")
        .select("id", { count: "exact", head: true })
        .eq("following_tg_id", tgId),
      supabaseRead
        .from("follows")
        .select("id", { count: "exact", head: true })
        .eq("follower_tg_id", tgId),
    ]);

  return {
    user: userRes.data,
    commandCount: activityRes.count ?? 0,
    watchlistCount: watchRes.count ?? 0,
    followerCount: followersRes.count ?? 0,
    followingCount: followingRes.count ?? 0,
  };
}

// ─── 포트폴리오 랭킹 ───

export async function getPortfolioRanking(limit = 15) {
  const { data: items } = await supabaseRead
    .from("watchlist")
    .select("chat_id, buy_price, stock:stocks!inner(close)")
    .not("buy_price", "is", null)
    .gt("buy_price", 0);

  if (!items?.length) return [];

  // chat_id 별 집계
  const map = new Map<
    number,
    { cost: number; value: number; count: number }
  >();

  for (const item of items) {
    const chatId = item.chat_id as number;
    const buyPrice = Number(item.buy_price);
    const close = Number((item.stock as any)?.close ?? 0);
    if (!close || !buyPrice) continue;

    const entry = map.get(chatId) || { cost: 0, value: 0, count: 0 };
    entry.cost += buyPrice;
    entry.value += close;
    entry.count += 1;
    map.set(chatId, entry);
  }

  // 수익률 정렬
  const rankings = Array.from(map.entries())
    .map(([chatId, { cost, value, count }]) => ({
      tgId: chatId,
      stockCount: count,
      plPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
    }))
    .sort((a, b) => b.plPct - a.plPct)
    .slice(0, limit);

  // 사용자 정보 조회
  const tgIds = rankings.map((r) => r.tgId);
  const { data: users } = await supabaseRead
    .from("users")
    .select("tg_id, username, first_name")
    .in("tg_id", tgIds);

  const userMap = new Map(
    (users || []).map((u: any) => [u.tg_id, u])
  );

  return rankings.map((r) => {
    const u = userMap.get(r.tgId) as any;
    return {
      ...r,
      displayName: u?.first_name || u?.username || `User${r.tgId}`,
      username: (u?.username as string) || null,
    };
  });
}

// ─── 팔로우 / 언팔로우 ───

export async function followUser(
  myTgId: number,
  targetUsername: string
): Promise<{ ok: boolean; message: string }> {
  const clean = targetUsername.replace(/^@/, "");
  const { data: target } = await supabaseRead
    .from("users")
    .select("tg_id, username, first_name")
    .eq("username", clean)
    .single();

  if (!target)
    return { ok: false, message: "해당 사용자를 찾을 수 없습니다.\n텔레그램 @사용자명을 확인해주세요." };
  if (target.tg_id === myTgId)
    return { ok: false, message: "자기 자신은 팔로우할 수 없습니다." };

  const { error } = await supabase.from("follows").upsert(
    { follower_tg_id: myTgId, following_tg_id: target.tg_id },
    { onConflict: "follower_tg_id,following_tg_id" }
  );

  if (error) {
    console.error("follow error:", error);
    return { ok: false, message: "팔로우 처리 중 오류가 발생했습니다." };
  }

  const name = target.first_name || target.username || "사용자";
  return { ok: true, message: `✅ ${name}님을 팔로우합니다.\n/피드 로 보유 포트폴리오를 확인하세요.` };
}

export async function unfollowUser(
  myTgId: number,
  targetUsername: string
): Promise<{ ok: boolean; message: string }> {
  const clean = targetUsername.replace(/^@/, "");
  const { data: target } = await supabaseRead
    .from("users")
    .select("tg_id, first_name, username")
    .eq("username", clean)
    .single();

  if (!target)
    return { ok: false, message: "해당 사용자를 찾을 수 없습니다." };

  const { error, count } = await supabase
    .from("follows")
    .delete({ count: "exact" })
    .eq("follower_tg_id", myTgId)
    .eq("following_tg_id", target.tg_id);

  if (error)
    return { ok: false, message: "언팔로우 처리 중 오류가 발생했습니다." };
  if (!count)
    return { ok: false, message: "팔로우 관계가 없습니다." };

  const name = target.first_name || target.username || "사용자";
  return { ok: true, message: `${name}님을 언팔로우했습니다.` };
}

// ─── 팔로잉 피드 ───

export async function getFollowingFeed(myTgId: number) {
  const { data: follows } = await supabaseRead
    .from("follows")
    .select("following_tg_id")
    .eq("follower_tg_id", myTgId);

  if (!follows?.length) return [];

  const tgIds = follows.map((f: any) => f.following_tg_id);

  const { data: items } = await supabaseRead
    .from("watchlist")
    .select("chat_id, code, buy_price, buy_date, stock:stocks!inner(name, close)")
    .in("chat_id", tgIds)
    .order("created_at", { ascending: false })
    .limit(30);

  const { data: users } = await supabaseRead
    .from("users")
    .select("tg_id, username, first_name")
    .in("tg_id", tgIds);

  const userMap = new Map(
    (users || []).map((u: any) => [u.tg_id, u])
  );

  return (items || []).map((item: any) => {
    const u = userMap.get(item.chat_id) as any;
    return {
      ...item,
      displayName: u?.first_name || u?.username || "User",
    };
  });
}
