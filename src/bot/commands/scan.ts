// src/bot/commands/scan.ts
// /scan 눌림목 스캐너 — pullback_signals 기반 탐색형 스캔

import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { fetchRealtimePriceBatch } from "../../utils/fetchRealtimePrice";
import {
  getFundamentalSnapshot,
  getFundamentalWarningTags,
} from "../../services/fundamentalService";
import { pickSaferCandidates, type RiskProfile } from "../../lib/investableUniverse";
import { getUserInvestmentPrefs } from "../../services/userService";
import { analyzeNewsSentiment, formatSentimentLine } from "../../lib/newsSentiment";
import { fetchStockNews } from "../../utils/fetchNews";
import { filterCodesByCriticalNewsRisk } from "../../services/newsRiskFilter";
import { esc, gradeLabel } from "../messages/format";
import { fetchLatestScoresByCodes } from "../../services/scoreSourceService";
import { fetchRecentScoreHistoryByCodes } from "../../services/scoreSourceService";
import { buildFreshnessLabel, businessDaysBehind, isBusinessStale } from "../../utils/dataFreshness";
import {
  header,
  section,
  divider,
  buildMessage,
  actionButtons,
  ACTIONS,
} from "../messages/layout";
import { buildPersonalizedGuidance } from "../../services/personalizedGuidanceService";
import {
  formatScanFilterLabels,
  matchesScanFilters,
  parseScanInput,
} from "./scanFilters";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

type PullbackRow = {
  code: string;
  entry_grade: "A" | "B" | "C" | "D";
  entry_score: number;
  trend_grade?: string;
  dist_grade?: string;
  dist_pct?: number;
  pivot_grade?: string;
  vol_atr_grade?: string;
  warn_grade: "SAFE" | "WATCH" | "WARN" | "SELL";
  warn_score: number;
  stock: {
    name: string;
    close: number;
    market?: string;
    liquidity?: number;
    universe_level?: string;
    sector_id?: string;
  };
};

const WARN_LABEL: Record<string, string> = {
  SAFE: "안전",
  WATCH: "관찰",
  WARN: "주의",
  SELL: "매도",
};

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickVariant(seed: string, options: string[], salt?: string): string {
  if (!options.length) return "";
  const mixed = salt ? `${seed}|${salt}` : seed;
  return options[hashSeed(mixed) % options.length];
}

function fmtKorMoney(n: number): string {
  const safe = Number(n || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "-";

  const eok = Math.floor(safe / 100_000_000);
  const jo = Math.floor(eok / 10_000);
  const restEok = eok % 10_000;

  if (jo > 0) {
    if (restEok > 0) return `${jo}조 ${restEok.toLocaleString("ko-KR")}억`;
    return `${jo}조`;
  }
  return `${eok.toLocaleString("ko-KR")}억`;
}

function riskProfileLabel(profile?: RiskProfile): string {
  if (profile === "balanced") return "균형형";
  if (profile === "active") return "공격형";
  return "안전형";
}

function summarizeRecentScoreContext(
  history: Array<{
    asof: string | null;
    signal?: string | null;
    total_score: number | null;
    factors: Record<string, unknown> | null;
  }>
): {
  recentInDays: number;
  recentAccumulationDays: number;
  recentBullDays: number;
  recentText: string[];
} {
  let recentInDays = 0;
  let recentAccumulationDays = 0;
  let recentBullDays = 0;
  let recentInOffset: number | null = null;

  history.forEach((row, index) => {
    const signal = String(row.signal ?? "").trim().toLowerCase();
    const factors = (row.factors ?? {}) as Record<string, unknown>;
    const stableTurn = String(factors.stable_turn ?? "").trim().toLowerCase();
    const stableAccumulation = typeof factors.stable_accumulation === "boolean"
      ? factors.stable_accumulation
      : false;

    if (signal === "buy" || signal === "strong_buy") {
      recentInDays += 1;
      if (recentInOffset == null) recentInOffset = index;
    }
    if (stableAccumulation) recentAccumulationDays += 1;
    if (stableTurn === "bull-weak" || stableTurn === "bull-strong") recentBullDays += 1;
  });

  const recentText: string[] = [];
  if (recentInOffset != null) {
    recentText.push(recentInOffset === 0 ? "오늘 IN 계열" : `${recentInOffset}일 전 IN`);
  }
  if (recentAccumulationDays > 0) {
    recentText.push(`최근 매집 ${recentAccumulationDays}일`);
  }
  if (recentBullDays > 0) {
    recentText.push(`최근 상승턴 ${recentBullDays}회`);
  }

  return {
    recentInDays,
    recentAccumulationDays,
    recentBullDays,
    recentText,
  };
}

function buildDetailFallback(
  item: PullbackRow,
  hasFundamental: boolean,
  hasSentiment: boolean,
  variantSalt: string
): string {
  if (item.warn_grade === "WATCH" || item.warn_grade === "WARN") {
    return pickVariant(`${item.code}|fallback|warn`, [
      "리스크 경고 항목 우선 점검 필요",
      "경고 시그널이 있어 분할 진입 전 확인이 필요",
      "진입 전 리스크 관리 항목을 먼저 점검하세요",
    ], variantSalt);
  }
  if (!hasFundamental) {
    return pickVariant(`${item.code}|fallback|fund`, [
      "재무 데이터 업데이트 대기",
      "재무 스냅샷 수집 후 재평가 권장",
      "재무 지표 미수집 상태로 보수적 접근 권장",
    ], variantSalt);
  }
  if (!hasSentiment) {
    return pickVariant(`${item.code}|fallback|news`, [
      "뉴스 신호 부족 — 기술 신호 중심 점검",
      "최근 뉴스가 적어 가격/수급 신호 우선 확인",
      "뉴스 모멘텀 부재 — 차트 신호 우선 대응",
    ], variantSalt);
  }
  return pickVariant(`${item.code}|fallback|default`, [
    "핵심 시그널 점검 대기",
    "추가 데이터 반영 후 재평가 예정",
    "기준선 부근에서 신호 확정 대기",
  ], variantSalt);
}

export async function handleScanCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const parsedInput = parseScanInput(input);
  const query = parsedInput.query;
  const filterLabels = formatScanFilterLabels(parsedInput.filters);
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${query ? `'${query}' 조건` : "전체 시장"} 눌림목 스캔 중...${filterLabels.length ? `\n필터: ${filterLabels.join(" · ")}` : ""}`,
  });

  const { data: latestRow } = await supabase
    .from("pullback_signals")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(1);

  const latestDate = latestRow?.[0]?.trade_date;
  if (!latestDate) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "눌림목 시그널 데이터가 아직 없습니다. 데이터 수집 후 다시 시도해주세요.",
    });
    return;
  }

  let sectorId: string | null = null;
  let sectorName = "";
  if (query) {
    const { data: sectors } = await supabase
      .from("sectors")
      .select("id, name")
      .ilike("name", `%${query}%`)
      .limit(1);

    if (!sectors?.length) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: `'${query}' 관련 섹터를 찾지 못했습니다.`,
      });
      return;
    }
    sectorId = sectors[0].id;
    sectorName = sectors[0].name;
  }

  let pbQuery = supabase
    .from("pullback_signals")
    .select(
      `
      code, entry_grade, entry_score,
      trend_grade, dist_grade, dist_pct, pivot_grade, vol_atr_grade,
      warn_grade, warn_score,
      stock:stocks!inner(name, close, market, liquidity, universe_level, sector_id)
    `
    )
    .eq("trade_date", latestDate)
    .in("entry_grade", ["A", "B"])
    .neq("warn_grade", "SELL")
    .order("entry_score", { ascending: false })
    .limit(300);

  if (sectorId) {
    pbQuery = pbQuery.eq("stock.sector_id", sectorId);
  }

  const { data: rawCandidates, error } = await pbQuery;

  if (error) {
    console.error("scan pullback query error:", error);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "스캔 데이터 조회 중 오류가 발생했습니다.",
    });
    return;
  }

  const candidates = ((rawCandidates || []) as any[]).map((row) => {
    const stock = Array.isArray(row.stock)
      ? row.stock[0] || { name: row.code, close: 0 }
      : row.stock || { name: row.code, close: 0 };

    return {
      ...row,
      stock,
    } as PullbackRow;
  });
  if (!candidates.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `조건에 맞는 눌림목 후보가 없습니다.\n(기준일: ${latestDate})`,
    });
    return;
  }

  const variantSalt = `${Date.now()}|${ctx.chatId}|${query || "all"}`;

  const candidatePool = candidates.map((item) => ({
    ...item,
    name: item.stock?.name,
    market: item.stock?.market,
    liquidity: item.stock?.liquidity,
    universe_level: item.stock?.universe_level,
  }));

  const codes = candidatePool.map((c) => c.code);
  const realtimeMap = await fetchRealtimePriceBatch(codes);

  const scoreMap = new Map<
    string,
    {
      total?: number;
      value?: number;
      signal?: string;
      stableTrust?: number;
      stableTurn?: string;
      stableAboveAvg?: boolean;
      stableAccumulation?: boolean;
      recentInDays?: number;
      recentAccumulationDays?: number;
      recentBullDays?: number;
      recentText?: string[];
    }
  >();
  const scoreResult = await fetchLatestScoresByCodes(supabase, codes);
  const recentHistoryByCode = await fetchRecentScoreHistoryByCodes(supabase, codes, 5);
  scoreResult.byCode.forEach((row, code) => {
    const factors = (row.factors ?? {}) as Record<string, unknown>;
    const recentHistory = recentHistoryByCode.get(code) ?? [];
    const recentSummary = summarizeRecentScoreContext(recentHistory as Array<{
      asof: string | null;
      signal?: string | null;
      total_score: number | null;
      factors: Record<string, unknown> | null;
    }>);
    scoreMap.set(code, {
      total: Number(row.total_score ?? 0) || undefined,
      value: Number(row.value_score ?? 0) || undefined,
      signal: String(row.signal ?? "").trim() || undefined,
      stableTrust: Number(factors.stable_turn_trust ?? 0) || undefined,
      stableTurn: String(factors.stable_turn ?? "").trim() || undefined,
      stableAboveAvg:
        typeof factors.stable_above_avg === "boolean"
          ? factors.stable_above_avg
          : undefined,
      stableAccumulation:
        typeof factors.stable_accumulation === "boolean"
          ? factors.stable_accumulation
          : undefined,
      recentInDays: recentSummary.recentInDays,
      recentAccumulationDays: recentSummary.recentAccumulationDays,
      recentBullDays: recentSummary.recentBullDays,
      recentText: recentSummary.recentText,
    });
  });

  const filteredCandidates = candidatePool.filter((item) =>
    matchesScanFilters(scoreMap.get(item.code), parsedInput.filters, {
      entryGrade: item.entry_grade,
      entryScore: item.entry_score,
      trendGrade: item.trend_grade,
      distGrade: item.dist_grade,
    })
  );

  const saferPool = pickSaferCandidates(
    filteredCandidates,
    20,
    riskProfile
  ) as PullbackRow[];

  if (!filteredCandidates.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        `조건에 맞는 눌림목 후보가 없습니다.`,
        `(기준일: ${latestDate})`,
        ...(filterLabels.length ? [`필터: ${filterLabels.join(" · ")}`] : []),
        "예시: /스캔 반도체 추세 매집 진입",
      ].join("\n"),
    });
    return;
  }

  const rerankPool = saferPool.slice(0, 12);
  const fundamentals = await Promise.all(
    rerankPool.map(async (s) => ({
      code: s.code,
      fundamental: await getFundamentalSnapshot(s.code).catch(() => null),
    }))
  );

  const fundMap = new Map(
    fundamentals
      .filter((x) => x.fundamental)
      .map((x) => [x.code, x.fundamental!])
  );

  const signalBusinessGap = businessDaysBehind(latestDate) ?? 0;
  const scoreBusinessGap = businessDaysBehind(scoreResult.latestAsof) ?? 0;
  const staleBusinessGap = Math.max(signalBusinessGap, scoreBusinessGap);
  const realtimeCoverage = codes.length > 0 ? Object.keys(realtimeMap).length / codes.length : 0;
  const realtimeMomentumWeight =
    realtimeCoverage < 0.3
      ? 1.2
      : staleBusinessGap >= 2
        ? 3.2
        : staleBusinessGap >= 1
          ? 2.4
          : 1.2;

  const rankedPicks = [...saferPool]
    .sort((a, b) => {
      const ra = realtimeMap[a.code];
      const rb = realtimeMap[b.code];
      const sa = scoreMap.get(a.code);
      const sb = scoreMap.get(b.code);
      const fundA = fundMap.get(a.code);
      const fundB = fundMap.get(b.code);
      const qa = fundA?.qualityScore ?? 50;
      const qb = fundB?.qualityScore ?? 50;
      const stableBoostA =
        (sa?.stableTrust ?? 0) * 0.35 +
        ((sa?.stableTurn ?? "").startsWith("bull") ? 8 : (sa?.stableTurn ?? "").startsWith("bear") ? -8 : 0) +
        (sa?.stableAboveAvg ? 3 : -3) +
        (sa?.recentInDays ?? 0) * 4 +
        (sa?.recentAccumulationDays ?? 0) * 2;
      const stableBoostB =
        (sb?.stableTrust ?? 0) * 0.35 +
        ((sb?.stableTurn ?? "").startsWith("bull") ? 8 : (sb?.stableTurn ?? "").startsWith("bear") ? -8 : 0) +
        (sb?.stableAboveAvg ? 3 : -3) +
        (sb?.recentInDays ?? 0) * 4 +
        (sb?.recentAccumulationDays ?? 0) * 2;
      const warnPenaltyA = getFundamentalWarningTags(fundA ?? {}).length * 6;
      const warnPenaltyB = getFundamentalWarningTags(fundB ?? {}).length * 6;
      const momentumA = Math.max(-5, Math.min(5, ra?.changeRate ?? 0));
      const momentumB = Math.max(-5, Math.min(5, rb?.changeRate ?? 0));

      const scoreA =
        (a.entry_score ?? 0) * 20 +
        (6 - (a.warn_score ?? 0)) * 8 +
        (sa?.total ?? 0) * 0.6 +
        (sa?.value ?? 0) * 0.5 +
        stableBoostA +
        qa * 0.6 +
        momentumA * realtimeMomentumWeight -
        warnPenaltyA;
      const scoreB =
        (b.entry_score ?? 0) * 20 +
        (6 - (b.warn_score ?? 0)) * 8 +
        (sb?.total ?? 0) * 0.6 +
        (sb?.value ?? 0) * 0.5 +
        stableBoostB +
        qb * 0.6 +
        momentumB * realtimeMomentumWeight -
        warnPenaltyB;
      return scoreB - scoreA;
    });

  const newsRiskCheckPool = rankedPicks.slice(0, 30);
  const { blockedByCode: blockedByNews } = await filterCodesByCriticalNewsRisk(
    newsRiskCheckPool.map((item) => item.code),
    { maxNewsPerCode: 6, checkLimit: 30 }
  );

  const finalPicks = rankedPicks
    .filter((item) => !blockedByNews.has(item.code))
    .slice(0, 10);

  const sentimentByCode = new Map<string, string>();
  await Promise.all(
    finalPicks.map(async (item) => {
      try {
        const news = await fetchStockNews(item.code, 5);
        if (!news.length) return;
        const sentiment = formatSentimentLine(
          analyzeNewsSentiment(news.map((entry) => entry.title))
        );
        if (sentiment) {
          sentimentByCode.set(item.code, sentiment);
        }
      } catch {
        // 뉴스 실패는 스캔을 막지 않음
      }
    })
  );

  const lines = finalPicks.map((item, idx) => {
    const rt = realtimeMap[item.code];
    const price = Number(rt?.price ?? item.stock?.close ?? 0);
    const chg =
      rt?.changeRate == null
        ? ""
        : ` ${rt.changeRate >= 0 ? "▲" : "▼"}${Math.abs(rt.changeRate).toFixed(1)}%`;
    const s = scoreMap.get(item.code);
    const f = fundMap.get(item.code)?.qualityScore;
    const stable = scoreMap.get(item.code);
    const stableTurn = stable?.stableTurn
      ? stable.stableTurn === "bull-strong"
        ? "강상승"
        : stable.stableTurn === "bull-weak"
          ? "상승"
          : stable.stableTurn === "bear-strong"
            ? "강하락"
            : stable.stableTurn === "bear-weak"
              ? "하락"
              : "중립"
      : "중립";
    const stableTrustLabel =
      stable?.stableTrust != null ? `${Math.round(stable.stableTrust)}점` : "-";
    const stableAccumulation = stable?.stableAccumulation ? "매집" : "";
    const scoreSignal = stable?.signal ? String(stable.signal).toUpperCase() : "-";
    const recentText = stable?.recentText?.slice(0, 2).join(" · ") ?? "";
    const warn = WARN_LABEL[item.warn_grade] ?? item.warn_grade;
    const grade = gradeLabel[item.entry_grade] ?? "○";
    const details: Array<{ key: string; score: number; text: string }> = [];
    const detailKeys = new Set<string>();
    const pushDetail = (key: string, score: number, text: string) => {
      if (!text || detailKeys.has(key)) return;
      detailKeys.add(key);
      details.push({ key, score, text });
    };

    if (item.dist_grade && item.dist_pct != null) {
      pushDetail(
        "dist",
        95,
        pickVariant(`${item.code}|dist|${item.dist_grade}|${item.dist_pct}`, [
          `이격 ${item.dist_grade}(${item.dist_pct}%)`,
          `가격 이격 ${item.dist_grade} (${item.dist_pct}%)`,
          `기준선 대비 이격 ${item.dist_grade} (${item.dist_pct}%)`,
        ])
      );
    }
    if (item.trend_grade) {
      pushDetail(
        "trend",
        90,
        pickVariant(`${item.code}|trend|${item.trend_grade}`, [
          `추세 ${item.trend_grade}`,
          `중기 추세 ${item.trend_grade}`,
          `추세 강도 ${item.trend_grade}`,
        ])
      );
    }
    if (item.pivot_grade) {
      pushDetail(
        "pivot",
        75,
        pickVariant(`${item.code}|pivot|${item.pivot_grade}`, [
          `피봇 ${item.pivot_grade}`,
          `전환 신호 ${item.pivot_grade}`,
          `피봇 레벨 ${item.pivot_grade}`,
        ])
      );
    }
    if (item.vol_atr_grade) {
      pushDetail(
        "vol",
        70,
        pickVariant(`${item.code}|vol|${item.vol_atr_grade}`, [
          `변동 ${item.vol_atr_grade}`,
          `ATR 변동 ${item.vol_atr_grade}`,
          `변동성 ${item.vol_atr_grade}`,
        ])
      );
    }
    const sentiment = sentimentByCode.get(item.code);
    if (sentiment) {
      pushDetail(
        "news",
        65,
        pickVariant(`${item.code}|news|${sentiment}`, [
          `뉴스 ${sentiment}`,
          `뉴스 심리 ${sentiment}`,
          `최근 뉴스 ${sentiment}`,
        ])
      );
    }
    const fundamentalWarnings = fundMap.get(item.code)
      ? getFundamentalWarningTags(fundMap.get(item.code)!).slice(0, 2)
      : [];
    if (fundamentalWarnings.length) {
      pushDetail(
        "fund",
        85,
        pickVariant(`${item.code}|fund|${fundamentalWarnings.join("|")}`, [
          `재무 ${fundamentalWarnings.join(", ")}`,
          `재무 경고 ${fundamentalWarnings.join(", ")}`,
          `재무 체크 ${fundamentalWarnings.join(", ")}`,
        ])
      );
    }
    if (recentText) {
      pushDetail(
        "recent",
        92,
        recentText
      );
    }

    const conciseDetails = details
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((d) => d.text);
    const detailLine =
      conciseDetails.join(" · ") ||
      buildDetailFallback(
        item,
        Boolean(fundMap.get(item.code)),
        Boolean(sentiment),
        variantSalt
      );

    return (
      `${idx + 1}. ${grade} <b>${esc(item.stock?.name || item.code)}</b> <code>${price.toLocaleString("ko-KR")}원</code>${chg}\n` +
      `진입 ${item.entry_grade}(${item.entry_score}/4) · 경고 ${warn}(${item.warn_score}/6) · 점수 ${Math.round(s?.total ?? 0)} · 재무 ${f ?? "-"} · Stable ${stableTurn}/${stableTrustLabel}${stableAccumulation ? ` · ${stableAccumulation}` : ""} · 신호 ${scoreSignal}${recentText ? ` · 최근 ${recentText}` : ""}\n` +
      `${detailLine}`
    );
  });

  const title = query ? `${sectorName || query} 눌림목 스캔` : "전체 시장 눌림목 스캔";
  const signalStale = isBusinessStale(latestDate, 1);
  const scoreStale = isBusinessStale(scoreResult.latestAsof, 1);
  const freshnessWarnings: string[] = [];
  if (signalStale || scoreStale) {
    freshnessWarnings.push(
      `⚠️ 데이터 지연 감지: 시그널 ${buildFreshnessLabel(latestDate, 1)} · 점수 ${buildFreshnessLabel(scoreResult.latestAsof, 1)}`
    );
    freshnessWarnings.push("권장: 장 시작 전 /종목분석으로 실시간 가격을 함께 확인하세요.");
  }

  const personalLines = await buildPersonalizedGuidance({
    chatId: ctx.chatId,
    context: "scan",
  }).catch(() => []);

  const msg = buildMessage([
    header(title, `기준일 ${latestDate} · ${riskProfileLabel(riskProfile)} 기준`),
    section("스캔 조건", [
      "A/B 진입등급 · 매도경고 제외 · 코스피 중심 위험성향 필터",
      ...(filterLabels.length ? [`Stable 필터: ${filterLabels.join(" · ")}`] : []),
      `후보 ${candidates.length}개 중 필터 통과 ${filteredCandidates.length}개 · 안전성향 통과 ${saferPool.length}개 · 상위 ${finalPicks.length}개`,
      ...(blockedByNews.size > 0 ? [`뉴스 이벤트 리스크로 ${blockedByNews.size}개 제외(공개매수/상폐/거래정지 등)`] : []),
      ...(staleBusinessGap >= 1
        ? [`장중 보정: 실시간 등락 가중치 x${realtimeMomentumWeight.toFixed(1)} (시그널/점수 지연 ${staleBusinessGap}영업일)`]
        : []),
      `점수 기준일 ${scoreResult.latestAsof ?? "확인 불가"}`,
      ...freshnessWarnings,
    ]),
    ...(personalLines.length > 0
      ? [section("내 상황 제안", personalLines)]
      : []),
    section("상위 후보", lines),
    divider(),
    `거래대금은 장중 추정치가 포함될 수 있습니다.`,
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons([...ACTIONS.promptAnalyze, ...ACTIONS.marketFlow], 3),
  });
}
