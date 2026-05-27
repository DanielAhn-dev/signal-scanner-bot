import { createClient } from "@supabase/supabase-js";
import type { ChatContext } from "../router";
import { actionButtons } from "../messages/layout";
import { discoverMultibaggerCandidates } from "../../services/discoveryService";
import { parseStrategyMemo } from "../../lib/strategyMemo";
import { getUserInvestmentPrefs, setUserInvestmentPrefs } from "../../services/userService";

type DiscoveryProfile = "BLEND" | "HIGHLIGHT" | "PULLBACK" | "MULTIBAGGER" | "BACKTEST_EDGE";

type HighlightRow = {
  code: string;
  total_score?: number | null;
  signal?: string | null;
  stock?: {
    name?: string | null;
  } | null;
};

type PullbackRow = {
  code: string;
  entry_grade?: string | null;
  entry_score?: number | null;
  stock?: {
    name?: string | null;
  } | null;
};

type BacktestEdgeRow = {
  id?: number | null;
  code?: string | null;
  pnl_amount?: number | null;
  memo?: string | null;
  traded_at?: string | null;
};

type BacktestEdgeStat = {
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  avgHoldDays: number;
  score: number;
};

type DailyIndicatorFlowRow = {
  code?: string | null;
  trade_date?: string | null;
  close?: number | null;
  volume?: number | null;
  value_traded?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  rsi14?: number | null;
  roc14?: number | null;
  roc21?: number | null;
};

type FlowSignalProfile = {
  todayBuyScore: number;
  holdExtensionScore: number;
  immediateExcludeSignal: boolean;
  reason: string;
};

const VALID_DISCOVERY_PROFILES: DiscoveryProfile[] = [
  "BLEND",
  "HIGHLIGHT",
  "PULLBACK",
  "MULTIBAGGER",
  "BACKTEST_EDGE",
];

const PROFILE_LABEL: Record<DiscoveryProfile, string> = {
  BLEND: "혼합(추천)",
  HIGHLIGHT: "하이라이트(기본점수)",
  PULLBACK: "눌림목 우선",
  MULTIBAGGER: "멀티배거 우선",
  BACKTEST_EDGE: "백테스트 우선",
};

const PROFILE_DESC: Record<DiscoveryProfile, string> = {
  BLEND: "눌림목 + 멀티배거 + 백테스트 우수 종목을 혼합 반영",
  HIGHLIGHT: "기본 점수 상위(구 하이라이트) 중심",
  PULLBACK: "눌림목/매집 전환 후보를 우선 선별",
  MULTIBAGGER: "중장기 성장 발굴 후보를 우선 선별",
  BACKTEST_EDGE: "내 최근 우수 체결 종목군을 재활용해 우선 선별",
};

function normalizeDiscoveryProfile(value: unknown): DiscoveryProfile {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (VALID_DISCOVERY_PROFILES.includes(normalized as DiscoveryProfile)) {
    return normalized as DiscoveryProfile;
  }
  return "BLEND";
}

function resolveSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or key");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function toTopLine(code: string, name: string | null | undefined, extra?: string): string {
  const safeName = String(name ?? code).trim() || code;
  return extra ? `- ${safeName}(${code}) · ${extra}` : `- ${safeName}(${code})`;
}

function parseProfileInput(input: string): DiscoveryProfile | null {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (!normalized) return null;

  if (["blend", "혼합", "추천", "기본"].includes(normalized)) return "BLEND";
  if (["highlight", "하이라이트", "점수", "기본점수"].includes(normalized)) return "HIGHLIGHT";
  if (["pullback", "눌림목", "눌림"].includes(normalized)) return "PULLBACK";
  if (["multibagger", "멀티배거", "발굴"].includes(normalized)) return "MULTIBAGGER";
  if (["backtest", "백테스트", "edge", "우수"].includes(normalized)) return "BACKTEST_EDGE";

  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentileRank(values: number[], target: number): number {
  if (!values.length || !Number.isFinite(target)) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const belowOrEqual = sorted.filter((value) => value <= target).length;
  return belowOrEqual / sorted.length;
}

function daysBetweenIso(laterIso: string, earlierIso: string): number {
  const later = Date.parse(laterIso);
  const earlier = Date.parse(earlierIso);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return 0;
  return Math.max(0, later - earlier) / (24 * 60 * 60 * 1000);
}

function buildFlowSignalProfile(series: DailyIndicatorFlowRow[]): FlowSignalProfile {
  if (!series.length) {
    return {
      todayBuyScore: 0,
      holdExtensionScore: 0,
      immediateExcludeSignal: false,
      reason: "수급데이터 없음",
    };
  }

  const latest = series[series.length - 1] ?? {};
  const valueSeries = series.map((row) => Math.max(0, toNumber(row.value_traded, 0))).filter((v) => v > 0);
  const volumeSeries = series.map((row) => Math.max(0, toNumber(row.volume, 0))).filter((v) => v > 0);
  const closeSeries = series.map((row) => Math.max(0, toNumber(row.close, 0))).filter((v) => v > 0);
  const recent20Value = valueSeries.slice(-20);
  const recent20Volume = volumeSeries.slice(-20);
  const recent5Close = closeSeries.slice(-5);
  const recent3Value = valueSeries.slice(-3);

  const latestValue = Math.max(0, toNumber(latest.value_traded, 0));
  const latestVolume = Math.max(0, toNumber(latest.volume, 0));
  const latestClose = Math.max(0, toNumber(latest.close, 0));
  const sma20 = Math.max(0, toNumber(latest.sma20, 0));
  const sma50 = Math.max(0, toNumber(latest.sma50, 0));
  const rsi14 = toNumber(latest.rsi14, 50);
  const roc14 = toNumber(latest.roc14, 0);
  const roc21 = toNumber(latest.roc21, 0);

  const valuePercentile = percentileRank(recent20Value, latestValue);
  const avg20Value = mean(recent20Value);
  const avg20Volume = mean(recent20Volume);
  const valueRatio = avg20Value > 0 ? latestValue / avg20Value : 1;
  const volumeRatio = avg20Volume > 0 ? latestVolume / avg20Volume : 1;
  const priorHigh5 = recent5Close.length >= 2 ? Math.max(...recent5Close.slice(0, -1)) : latestClose;
  const breakoutHeld = latestClose > 0 && priorHigh5 > 0 ? latestClose >= priorHigh5 * 0.998 : false;
  const stableTrend = (sma20 <= 0 || latestClose >= sma20) && (sma50 <= 0 || latestClose >= sma50 * 0.985);
  const recentValueStreak = recent3Value.filter((value) => avg20Value > 0 && value >= avg20Value * 1.2).length;

  let todayBuyScore = 0;
  if (valuePercentile >= 0.8) todayBuyScore += 22;
  else if (valuePercentile >= 0.65) todayBuyScore += 12;
  if (valueRatio >= 1.8) todayBuyScore += 18;
  else if (valueRatio >= 1.3) todayBuyScore += 12;
  if (volumeRatio >= 1.8) todayBuyScore += 16;
  else if (volumeRatio >= 1.3) todayBuyScore += 10;
  if (recentValueStreak >= 2) todayBuyScore += 12;
  if (breakoutHeld) todayBuyScore += 12;
  if (stableTrend) todayBuyScore += 10;
  if (rsi14 >= 48 && rsi14 <= 72) todayBuyScore += 6;
  if (roc14 > 0) todayBuyScore += 6;
  if (roc21 > 0) todayBuyScore += 6;
  todayBuyScore = clamp(Math.round(todayBuyScore), 0, 100);

  let holdExtensionScore = 0;
  holdExtensionScore += Math.round(todayBuyScore * 0.45);
  if (valueRatio >= 1.2) holdExtensionScore += 12;
  if (volumeRatio >= 1.1) holdExtensionScore += 10;
  if (stableTrend) holdExtensionScore += 16;
  if (rsi14 >= 45 && rsi14 <= 70) holdExtensionScore += 10;
  if (roc14 > 0 && roc21 > 0) holdExtensionScore += 12;
  holdExtensionScore = clamp(holdExtensionScore, 0, 100);

  const breakdown = latestClose > 0 && sma20 > 0 ? latestClose < sma20 * 0.97 : false;
  const flowDry = valueRatio < 0.65 && volumeRatio < 0.7;
  const momentumFail = roc14 < -1.5 && roc21 < -2.5;
  const immediateExcludeSignal = breakdown || flowDry || momentumFail;

  const reason = immediateExcludeSignal
    ? "즉시제외: 추세이탈/수급둔화"
    : todayBuyScore >= 80
    ? "오늘매수 강신호"
    : todayBuyScore >= 65
    ? "오늘매수 후보"
    : "관찰";

  return {
    todayBuyScore,
    holdExtensionScore,
    immediateExcludeSignal,
    reason,
  };
}

async function fetchFlowSignalProfilesByCode(input: {
  supabase: any;
  codes: string[];
}): Promise<Map<string, FlowSignalProfile>> {
  const codeSet = Array.from(new Set(input.codes.map((code) => String(code ?? "").trim()).filter(Boolean)));
  const out = new Map<string, FlowSignalProfile>();
  if (!codeSet.length) return out;

  const fromDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const grouped = new Map<string, DailyIndicatorFlowRow[]>();

  for (let i = 0; i < codeSet.length; i += 200) {
    const chunk = codeSet.slice(i, i + 200);
    const { data } = await input.supabase
      .from("daily_indicators")
      .select("code,trade_date,close,volume,value_traded,sma20,sma50,rsi14,roc14,roc21")
      .in("code", chunk)
      .gte("trade_date", fromDate)
      .order("trade_date", { ascending: true })
      .limit(8000);

    for (const row of (data ?? []) as DailyIndicatorFlowRow[]) {
      const code = String(row.code ?? "").trim();
      if (!code) continue;
      const list = grouped.get(code) ?? [];
      list.push(row);
      grouped.set(code, list);
    }
  }

  for (const code of codeSet) {
    out.set(code, buildFlowSignalProfile(grouped.get(code) ?? []));
  }

  return out;
}

function formatFlowSignalBadge(profile?: FlowSignalProfile): string {
  if (!profile) return "수급 n/a";
  const base = `수급 T${profile.todayBuyScore}/H${profile.holdExtensionScore}`;
  const exclude = profile.immediateExcludeSignal ? " · 즉시제외" : "";
  return `${base}${exclude} · ${profile.reason}`;
}

async function buildBacktestEdgeRanking(input: {
  supabase: any;
  tgId: number;
  limit: number;
}): Promise<{
  codes: string[];
  statsByCode: Map<string, BacktestEdgeStat>;
  regimeScale: number;
}> {
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const tradesResp = await input.supabase
    .from("trades")
    .select("id,code,pnl_amount,memo,traded_at")
    .eq("chat_id", input.tgId)
    .eq("side", "SELL")
    .is("broker_name", null)
    .is("account_name", null)
    .gte("traded_at", since)
    .order("traded_at", { ascending: false })
    .limit(1200);

  const trades = ((tradesResp.data ?? []) as BacktestEdgeRow[]).filter(
    (row) => parseStrategyMemo(row.memo).strategyId === "core.autotrade.v1"
  );
  if (!trades.length) {
    return { codes: [], statsByCode: new Map(), regimeScale: 1 };
  }

  const tradeById = new Map<number, { code: string; tradedAt: string }>();
  for (const row of trades) {
    const id = Math.floor(toNumber(row.id, 0));
    const code = String(row.code ?? "").trim();
    const tradedAt = String(row.traded_at ?? "").trim();
    if (id > 0 && code && tradedAt) {
      tradeById.set(id, { code, tradedAt });
    }
  }

  const tradeIds = Array.from(tradeById.keys()).slice(0, 1000);
  const holdByTradeId = new Map<number, { weightedDays: number; qty: number }>();
  if (tradeIds.length > 0) {
    const lotMatchResp = await input.supabase
      .from("virtual_trade_lot_matches")
      .select("trade_id,lot_id,quantity")
      .in("trade_id", tradeIds)
      .limit(5000);
    const lotMatches = (lotMatchResp.data ?? []) as Array<{
      trade_id?: number | null;
      lot_id?: number | null;
      quantity?: number | null;
    }>;
    const lotIds = Array.from(
      new Set(lotMatches.map((row) => Math.floor(toNumber(row.lot_id, 0))).filter((id) => id > 0))
    ).slice(0, 5000);
    const lotAcquiredAt = new Map<number, string>();
    if (lotIds.length > 0) {
      const lotsResp = await input.supabase
        .from("virtual_trade_lots")
        .select("id,acquired_at")
        .in("id", lotIds)
        .limit(5000);
      for (const lot of (lotsResp.data ?? []) as Array<{ id?: number | null; acquired_at?: string | null }>) {
        const lotId = Math.floor(toNumber(lot.id, 0));
        const acquiredAt = String(lot.acquired_at ?? "").trim();
        if (lotId > 0 && acquiredAt) {
          lotAcquiredAt.set(lotId, acquiredAt);
        }
      }
    }

    for (const row of lotMatches) {
      const tradeId = Math.floor(toNumber(row.trade_id, 0));
      const lotId = Math.floor(toNumber(row.lot_id, 0));
      const qty = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
      if (tradeId <= 0 || lotId <= 0 || qty <= 0) continue;
      const tradeMeta = tradeById.get(tradeId);
      const acquiredAt = lotAcquiredAt.get(lotId);
      if (!tradeMeta || !acquiredAt) continue;
      const holdDays = daysBetweenIso(tradeMeta.tradedAt, acquiredAt);
      const prev = holdByTradeId.get(tradeId) ?? { weightedDays: 0, qty: 0 };
      holdByTradeId.set(tradeId, {
        weightedDays: prev.weightedDays + holdDays * qty,
        qty: prev.qty + qty,
      });
    }
  }

  const aggByCode = new Map<
    string,
    {
      tradeCount: number;
      wins: number;
      losses: number;
      grossWin: number;
      grossLoss: number;
      holdDaysWeighted: number;
      holdQty: number;
    }
  >();

  let recentWins = 0;
  let recentLosses = 0;
  let recentGrossWin = 0;
  let recentGrossLoss = 0;
  let recentCount = 0;
  const recentSinceMs = Date.now() - 21 * 24 * 60 * 60 * 1000;

  for (const row of trades) {
    const code = String(row.code ?? "").trim();
    if (!code) continue;
    const pnl = toNumber(row.pnl_amount, 0);
    const tradeId = Math.floor(toNumber(row.id, 0));
    const tradedAtMs = Date.parse(String(row.traded_at ?? ""));
    const hold = holdByTradeId.get(tradeId);
    const prev =
      aggByCode.get(code) ??
      {
        tradeCount: 0,
        wins: 0,
        losses: 0,
        grossWin: 0,
        grossLoss: 0,
        holdDaysWeighted: 0,
        holdQty: 0,
      };

    prev.tradeCount += 1;
    if (pnl > 0) {
      prev.wins += 1;
      prev.grossWin += pnl;
    } else if (pnl < 0) {
      prev.losses += 1;
      prev.grossLoss += Math.abs(pnl);
    }

    if (hold && hold.qty > 0) {
      prev.holdDaysWeighted += hold.weightedDays;
      prev.holdQty += hold.qty;
    }

    aggByCode.set(code, prev);

    if (Number.isFinite(tradedAtMs) && tradedAtMs >= recentSinceMs) {
      recentCount += 1;
      if (pnl > 0) {
        recentWins += 1;
        recentGrossWin += pnl;
      } else if (pnl < 0) {
        recentLosses += 1;
        recentGrossLoss += Math.abs(pnl);
      }
    }
  }

  const recentWinRate =
    recentWins + recentLosses > 0 ? (recentWins / (recentWins + recentLosses)) * 100 : 0;
  const recentPf = recentGrossLoss > 0 ? recentGrossWin / recentGrossLoss : recentGrossWin > 0 ? 2.5 : 0;
  const regimeScale =
    recentCount < 6
      ? 1
      : recentPf < 0.85 || recentWinRate < 40
      ? 0.45
      : recentPf < 1 || recentWinRate < 50
      ? 0.7
      : recentPf >= 1.25 && recentWinRate >= 56
      ? 1.1
      : 1;

  const statsByCode = new Map<string, BacktestEdgeStat>();
  for (const [code, stat] of aggByCode.entries()) {
    const winRate = stat.tradeCount > 0 ? (stat.wins / stat.tradeCount) * 100 : 0;
    const pf = stat.grossLoss > 0 ? stat.grossWin / stat.grossLoss : stat.grossWin > 0 ? 2.5 : 0;
    const avgHoldDays = stat.holdQty > 0 ? stat.holdDaysWeighted / stat.holdQty : 5;
    const holdFactor = clamp(avgHoldDays / 12, 0.45, 1.3);
    const score =
      (winRate * 0.42 + pf * 26 + holdFactor * 22 + Math.log1p(stat.tradeCount) * 5) *
      regimeScale;
    statsByCode.set(code, {
      tradeCount: stat.tradeCount,
      winRate,
      profitFactor: pf,
      avgHoldDays,
      score,
    });
  }

  const codes = Array.from(statsByCode.entries())
    .sort((a, b) => b[1].score - a[1].score || b[1].winRate - a[1].winRate)
    .slice(0, Math.max(0, Math.floor(input.limit)))
    .map(([code]) => code);

  return { codes, statsByCode, regimeScale };
}

function buildDiscoveryPriorityReason(input: {
  profile: DiscoveryProfile;
  sources: string[];
  backtestStat?: BacktestEdgeStat;
}): string {
  if (input.sources.length >= 3) {
    return `교집합 ${input.sources.length}개 소스 동시 일치로 우선 배치`;
  }
  if (input.sources.length >= 2) {
    return "교집합 2개 소스 동시 일치로 단일 소스보다 우선";
  }
  if (input.profile === "PULLBACK" && input.sources.includes("눌림목")) {
    return "현재 전략이 눌림목 우선이라 재진입 후보를 상향";
  }
  if (input.profile === "MULTIBAGGER" && input.sources.includes("멀티배거")) {
    return "현재 전략이 멀티배거 우선이라 성장 후보를 상향";
  }
  if (input.profile === "BACKTEST_EDGE" && input.sources.includes("백테스트")) {
    const stat = input.backtestStat;
    if (stat) {
      return `백테스트 우수(승률 ${stat.winRate.toFixed(1)}%, PF ${stat.profitFactor.toFixed(2)}, 평균보유 ${stat.avgHoldDays.toFixed(1)}일) 가중`;
    }
    return "현재 전략이 백테스트 우선이라 우수 체결 이력을 상향";
  }
  if (input.profile === "HIGHLIGHT" && input.sources.includes("하이라이트")) {
    return "현재 전략이 하이라이트 우선이라 기본 점수 상위를 유지";
  }
  if (input.sources.length === 1) {
    return `${input.sources[0]} 소스 포함으로 후보 유지`;
  }
  return "기본 점수/필터 조건 충족 후보";
}

export async function handleDiscoveryProfileCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const requested = parseProfileInput(input);

  if (requested) {
    await setUserInvestmentPrefs(tgId, {
      discovery_profile: requested,
    });
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        `발굴 소스 프로필 변경: ${PROFILE_LABEL[requested]}`,
        PROFILE_DESC[requested],
        "",
        "확인: /자동리포트",
        "비교: /발굴비교",
      ].join("\n"),
    });
    return;
  }

  const prefs = await getUserInvestmentPrefs(tgId);
  const current = normalizeDiscoveryProfile(prefs.discovery_profile);

  const lines = [
    "발굴 소스 프로필 설정",
    `현재: ${PROFILE_LABEL[current]}`,
    "",
    "프로필 설명",
    ...VALID_DISCOVERY_PROFILES.map((profile) => `- ${PROFILE_LABEL[profile]}: ${PROFILE_DESC[profile]}`),
    "",
    "버튼으로 선택하거나 /발굴전략 [눌림목|하이라이트|멀티배거|백테스트|혼합] 입력",
  ];

  const buttons = [
    { text: "혼합(추천)", callback_data: "discoverysrc:BLEND" },
    { text: "하이라이트", callback_data: "discoverysrc:HIGHLIGHT" },
    { text: "눌림목", callback_data: "discoverysrc:PULLBACK" },
    { text: "멀티배거", callback_data: "discoverysrc:MULTIBAGGER" },
    { text: "백테스트", callback_data: "discoverysrc:BACKTEST_EDGE" },
    { text: "발굴비교", callback_data: "cmd:discoverycompare" },
  ];

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: lines.join("\n"),
    reply_markup: actionButtons(buttons, 2),
  });
}

export async function handleDiscoveryProfileCallback(
  ctx: ChatContext,
  tgSend: any,
  profile: string
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const normalized = normalizeDiscoveryProfile(profile);

  await setUserInvestmentPrefs(tgId, {
    discovery_profile: normalized,
  });

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      `발굴 소스 프로필 변경: ${PROFILE_LABEL[normalized]}`,
      PROFILE_DESC[normalized],
      "",
      "다음 확인: /자동사이클 점검",
    ].join("\n"),
  });
}

export async function handleDiscoveryCompareCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const supabase = resolveSupabase();
  const tgId = ctx.from?.id ?? ctx.chatId;
  const parsed = Number(String(input ?? "").trim());
  const topN = Number.isFinite(parsed) ? Math.max(3, Math.min(8, Math.floor(parsed))) : 5;

  const [latestAsofResp, latestPullbackResp, multiPicks, prefs] = await Promise.all([
    supabase
      .from("score_source")
      .select("asof")
      .order("asof", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("pullback_signals")
      .select("trade_date")
      .order("trade_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    discoverMultibaggerCandidates(topN).catch(() => []),
    getUserInvestmentPrefs(tgId),
  ]);

  const latestAsof = latestAsofResp.data?.asof ? String(latestAsofResp.data.asof) : null;
  const latestPullbackDate = latestPullbackResp.data?.trade_date
    ? String(latestPullbackResp.data.trade_date)
    : null;

  const highlightRows: HighlightRow[] = latestAsof
    ? ((
        await supabase
          .from("score_source")
          .select("code,total_score,signal,stock:stocks!inner(name)")
          .eq("asof", latestAsof)
          .in("signal", ["BUY", "STRONG_BUY", "WATCH"])
          .order("total_score", { ascending: false })
          .limit(Math.max(12, topN * 3))
      ).data ?? []) as HighlightRow[]
    : [];

  const pullbackRows: PullbackRow[] = latestPullbackDate
    ? ((
        await supabase
          .from("pullback_signals")
          .select("code,entry_grade,entry_score,stock:stocks!inner(name)")
          .eq("trade_date", latestPullbackDate)
          .in("entry_grade", ["A", "B"])
          .neq("warn_grade", "SELL")
          .order("entry_score", { ascending: false })
          .limit(Math.max(12, topN * 3))
      ).data ?? []) as PullbackRow[]
    : [];

  const backtestRank = await buildBacktestEdgeRanking({
    supabase,
    tgId,
    limit: Math.max(topN * 3, 12),
  });
  const backtestCodes = backtestRank.codes.slice(0, topN);

  const backtestNamesResp = backtestCodes.length
    ? await supabase.from("stocks").select("code,name").in("code", backtestCodes)
    : { data: [] as Array<{ code: string; name: string | null }> };

  const backtestNameMap = new Map(
    ((backtestNamesResp.data ?? []) as Array<{ code: string; name: string | null }>).map((row) => [
      String(row.code),
      row.name,
    ])
  );

  const highlightTopRows = highlightRows.slice(0, Math.max(topN * 3, 12));
  const pullbackTopRows = pullbackRows.slice(0, Math.max(topN * 3, 12));
  const multibaggerTopRows = multiPicks.slice(0, Math.max(topN * 3, 12));

  const nameByCode = new Map<string, string>();
  for (const row of highlightTopRows) {
    const code = String(row.code ?? "").trim();
    const name = String(row.stock?.name ?? "").trim();
    if (code && name) nameByCode.set(code, name);
  }
  for (const row of pullbackTopRows) {
    const code = String(row.code ?? "").trim();
    const name = String(row.stock?.name ?? "").trim();
    if (code && name) nameByCode.set(code, name);
  }
  for (const row of multibaggerTopRows) {
    const code = String(row.code ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (code && name) nameByCode.set(code, name);
  }
  for (const [code, name] of backtestNameMap.entries()) {
    const n = String(name ?? "").trim();
    if (code && n) nameByCode.set(code, n);
  }

  const sourceByCode = new Map<string, Set<string>>();
  const addSource = (code: string, source: string) => {
    if (!code) return;
    const current = sourceByCode.get(code) ?? new Set<string>();
    current.add(source);
    sourceByCode.set(code, current);
  };
  for (const row of highlightTopRows) addSource(String(row.code ?? "").trim(), "하이라이트");
  for (const row of pullbackTopRows) addSource(String(row.code ?? "").trim(), "눌림목");
  for (const row of multibaggerTopRows) addSource(String(row.code ?? "").trim(), "멀티배거");
  for (const code of backtestCodes) addSource(code, "백테스트");

  const flowProfileByCode = await fetchFlowSignalProfilesByCode({
    supabase,
    codes: Array.from(sourceByCode.keys()),
  });

  const highlightLines = highlightRows.slice(0, topN).map((row) =>
    toTopLine(
      row.code,
      row.stock?.name,
      `${Number(row.total_score ?? 0).toFixed(1)}점 · ${formatFlowSignalBadge(flowProfileByCode.get(String(row.code ?? "").trim()))}`
    )
  );
  const pullbackLines = pullbackRows.slice(0, topN).map((row) =>
    toTopLine(
      row.code,
      row.stock?.name,
      `${String(row.entry_grade ?? "-")}(${Number(row.entry_score ?? 0).toFixed(1)}) · ${formatFlowSignalBadge(flowProfileByCode.get(String(row.code ?? "").trim()))}`
    )
  );
  const multibaggerLines = multiPicks.slice(0, topN).map((row) =>
    toTopLine(
      row.code,
      row.name,
      `${row.score.totalScore.toFixed(1)}점 · ${formatFlowSignalBadge(flowProfileByCode.get(String(row.code ?? "").trim()))}`
    )
  );
  const backtestLines = backtestCodes.slice(0, topN).map((code) => {
    const stat = backtestRank.statsByCode.get(code);
    return toTopLine(
      code,
      backtestNameMap.get(code),
      stat
        ? `승률 ${stat.winRate.toFixed(1)}% · PF ${stat.profitFactor.toFixed(2)} · 평균보유 ${stat.avgHoldDays.toFixed(1)}일 · ${formatFlowSignalBadge(flowProfileByCode.get(code))}`
        : `우수체결 · ${formatFlowSignalBadge(flowProfileByCode.get(code))}`
    );
  });

  const currentProfile = normalizeDiscoveryProfile(prefs.discovery_profile);

  const profileBoost = (sources: Set<string>): number => {
    if (currentProfile === "PULLBACK") return sources.has("눌림목") ? 0.7 : 0;
    if (currentProfile === "MULTIBAGGER") return sources.has("멀티배거") ? 0.7 : 0;
    if (currentProfile === "BACKTEST_EDGE") return sources.has("백테스트") ? 0.8 : 0;
    if (currentProfile === "HIGHLIGHT") return sources.has("하이라이트") ? 0.6 : 0;
    return 0;
  };

  const intersectionRows = Array.from(sourceByCode.entries())
    .filter(([, sources]) => sources.size >= 2)
    .map(([code, sources]) => {
      const stat = backtestRank.statsByCode.get(code);
      const base = sources.size >= 3 ? 100 : 80;
      const perf = stat ? stat.score / 10 : 0;
      const score = base + perf + profileBoost(sources);
      return {
        code,
        name: nameByCode.get(code) ?? backtestNameMap.get(code) ?? code,
        sources: Array.from(sources.values()),
        score,
        reason: buildDiscoveryPriorityReason({
          profile: currentProfile,
          sources: Array.from(sources.values()),
          backtestStat: stat,
        }),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const intersectionLines = intersectionRows.map((row, idx) => {
    const sourceText = `${row.sources.length}개 소스 · ${row.sources.join(", ")}`;
    const flowText = formatFlowSignalBadge(flowProfileByCode.get(row.code));
    return `${idx + 1}. ${row.name}(${row.code}) · ${sourceText} · ${row.reason} · ${flowText}`;
  });

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      `<b>발굴 소스 비교 TOP ${topN}</b>`,
      `현재 프로필: ${PROFILE_LABEL[currentProfile]}`,
      `백테스트 성과 스케일: x${backtestRank.regimeScale.toFixed(2)} (최근 성과 악화 시 자동 축소)`,
      "",
      "<b>교집합 우선 후보</b>",
      ...(intersectionLines.length > 0 ? intersectionLines : ["- 교집합(2개 이상) 후보 없음"]),
      "",
      "<b>하이라이트(기본점수)</b>",
      ...(highlightLines.length > 0 ? highlightLines : ["- 데이터 없음"]),
      "",
      "<b>눌림목</b>",
      ...(pullbackLines.length > 0 ? pullbackLines : ["- 데이터 없음"]),
      "",
      "<b>멀티배거 발굴</b>",
      ...(multibaggerLines.length > 0 ? multibaggerLines : ["- 데이터 없음"]),
      "",
      "<b>백테스트 우수 종목</b>",
      ...(backtestLines.length > 0 ? backtestLines : ["- 데이터 없음"]),
      "",
      "프로필 변경: /발굴전략",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: actionButtons(
      [
        { text: "발굴전략", callback_data: "cmd:discoveryprofile" },
        { text: "자동점검", callback_data: "cmd:autocycle:check" },
        { text: "눌림목", callback_data: "cmd:pullback" },
        { text: "발굴", callback_data: "cmd:discovery" },
      ],
      2
    ),
  });
}
