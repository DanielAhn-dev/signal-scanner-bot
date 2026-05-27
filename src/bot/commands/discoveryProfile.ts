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
  code?: string | null;
  pnl_amount?: number | null;
  memo?: string | null;
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

  const [latestAsofResp, latestPullbackResp, multiPicks, backtestTradesResp, prefs] = await Promise.all([
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
    supabase
      .from("trades")
      .select("code,pnl_amount,memo")
      .eq("chat_id", tgId)
      .eq("side", "SELL")
      .is("broker_name", null)
      .is("account_name", null)
      .order("traded_at", { ascending: false })
      .limit(800),
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

  const profitableByCode = new Map<string, { score: number; wins: number }>();
  for (const row of (backtestTradesResp.data ?? []) as BacktestEdgeRow[]) {
    const code = String(row.code ?? "").trim();
    if (!code) continue;
    const strategyId = parseStrategyMemo(row.memo).strategyId;
    if (strategyId !== "core.autotrade.v1") continue;
    const pnl = Number(row.pnl_amount ?? 0);
    if (!Number.isFinite(pnl) || pnl <= 0) continue;
    const prev = profitableByCode.get(code) ?? { score: 0, wins: 0 };
    profitableByCode.set(code, {
      score: prev.score + pnl,
      wins: prev.wins + 1,
    });
  }

  const backtestCodes = Array.from(profitableByCode.entries())
    .sort((a, b) => {
      if (b[1].wins !== a[1].wins) return b[1].wins - a[1].wins;
      return b[1].score - a[1].score;
    })
    .slice(0, topN)
    .map(([code]) => code);

  const backtestNamesResp = backtestCodes.length
    ? await supabase.from("stocks").select("code,name").in("code", backtestCodes)
    : { data: [] as Array<{ code: string; name: string | null }> };

  const backtestNameMap = new Map(
    ((backtestNamesResp.data ?? []) as Array<{ code: string; name: string | null }>).map((row) => [
      String(row.code),
      row.name,
    ])
  );

  const highlightLines = highlightRows.slice(0, topN).map((row) =>
    toTopLine(row.code, row.stock?.name, `${Number(row.total_score ?? 0).toFixed(1)}점`)
  );
  const pullbackLines = pullbackRows.slice(0, topN).map((row) =>
    toTopLine(
      row.code,
      row.stock?.name,
      `${String(row.entry_grade ?? "-")}(${Number(row.entry_score ?? 0).toFixed(1)})`
    )
  );
  const multibaggerLines = multiPicks.slice(0, topN).map((row) =>
    toTopLine(row.code, row.name, `${row.score.totalScore.toFixed(1)}점`)
  );
  const backtestLines = backtestCodes.slice(0, topN).map((code) => {
    const stat = profitableByCode.get(code);
    const wins = stat?.wins ?? 0;
    const pnl = Math.round(stat?.score ?? 0).toLocaleString("ko-KR");
    return toTopLine(code, backtestNameMap.get(code), `우수체결 ${wins}회 · 누적 ${pnl}원`);
  });

  const currentProfile = normalizeDiscoveryProfile(prefs.discovery_profile);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      `<b>발굴 소스 비교 TOP ${topN}</b>`,
      `현재 프로필: ${PROFILE_LABEL[currentProfile]}`,
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
