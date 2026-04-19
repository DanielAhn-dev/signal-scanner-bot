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
import { esc, gradeLabel } from "../messages/format";
import { fetchLatestScoresByCodes } from "../../services/scoreSourceService";
import {
  header,
  section,
  divider,
  buildMessage,
  actionButtons,
  ACTIONS,
} from "../messages/layout";

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

function pickVariant(seed: string, options: string[]): string {
  if (!options.length) return "";
  return options[hashSeed(seed) % options.length];
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

function buildDetailFallback(item: PullbackRow, hasFundamental: boolean, hasSentiment: boolean): string {
  if (item.warn_grade === "WATCH" || item.warn_grade === "WARN") {
    return pickVariant(`${item.code}|fallback|warn`, [
      "리스크 경고 항목 우선 점검 필요",
      "경고 시그널이 있어 분할 진입 전 확인이 필요",
      "진입 전 리스크 관리 항목을 먼저 점검하세요",
    ]);
  }
  if (!hasFundamental) {
    return pickVariant(`${item.code}|fallback|fund`, [
      "재무 데이터 업데이트 대기",
      "재무 스냅샷 수집 후 재평가 권장",
      "재무 지표 미수집 상태로 보수적 접근 권장",
    ]);
  }
  if (!hasSentiment) {
    return pickVariant(`${item.code}|fallback|news`, [
      "뉴스 신호 부족 — 기술 신호 중심 점검",
      "최근 뉴스가 적어 가격/수급 신호 우선 확인",
      "뉴스 모멘텀 부재 — 차트 신호 우선 대응",
    ]);
  }
  return pickVariant(`${item.code}|fallback|default`, [
    "핵심 시그널 점검 대기",
    "추가 데이터 반영 후 재평가 예정",
    "기준선 부근에서 신호 확정 대기",
  ]);
}

export async function handleScanCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${query ? `'${query}' 조건` : "전체 시장"} 눌림목 스캔 중...`,
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

  const saferPool = pickSaferCandidates(
    candidates.map((item) => ({
      ...item,
      name: item.stock?.name,
      market: item.stock?.market,
      liquidity: item.stock?.liquidity,
      universe_level: item.stock?.universe_level,
    })),
    20,
    riskProfile
  ) as PullbackRow[];

  const codes = saferPool.map((c) => c.code);
  const realtimeMap = await fetchRealtimePriceBatch(codes);

  const scoreMap = new Map<string, { total?: number; value?: number }>();
  const scoreResult = await fetchLatestScoresByCodes(supabase, codes);
  scoreResult.byCode.forEach((row, code) => {
    scoreMap.set(code, {
      total: Number(row.total_score ?? 0) || undefined,
      value: Number(row.value_score ?? 0) || undefined,
    });
  });

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

  const finalPicks = [...saferPool]
    .sort((a, b) => {
      const ra = realtimeMap[a.code];
      const rb = realtimeMap[b.code];
      const sa = scoreMap.get(a.code);
      const sb = scoreMap.get(b.code);
      const fundA = fundMap.get(a.code);
      const fundB = fundMap.get(b.code);
      const qa = fundA?.qualityScore ?? 50;
      const qb = fundB?.qualityScore ?? 50;
      const warnPenaltyA = getFundamentalWarningTags(fundA ?? {}).length * 6;
      const warnPenaltyB = getFundamentalWarningTags(fundB ?? {}).length * 6;

      const scoreA =
        (a.entry_score ?? 0) * 20 +
        (6 - (a.warn_score ?? 0)) * 8 +
        (sa?.total ?? 0) * 0.6 +
        (sa?.value ?? 0) * 0.5 +
        qa * 0.6 +
        (ra?.changeRate ?? 0) * 1.2 -
        warnPenaltyA;
      const scoreB =
        (b.entry_score ?? 0) * 20 +
        (6 - (b.warn_score ?? 0)) * 8 +
        (sb?.total ?? 0) * 0.6 +
        (sb?.value ?? 0) * 0.5 +
        qb * 0.6 +
        (rb?.changeRate ?? 0) * 1.2 -
        warnPenaltyB;
      return scoreB - scoreA;
    })
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

    const conciseDetails = details
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((d) => d.text);
    const detailLine =
      conciseDetails.join(" · ") ||
      buildDetailFallback(item, Boolean(fundMap.get(item.code)), Boolean(sentiment));

    return (
      `${idx + 1}. ${grade} <b>${esc(item.stock?.name || item.code)}</b> <code>${price.toLocaleString("ko-KR")}원</code>${chg}\n` +
      `진입 ${item.entry_grade}(${item.entry_score}/4) · 경고 ${warn}(${item.warn_score}/6) · 점수 ${Math.round(s?.total ?? 0)} · 재무 ${f ?? "-"}\n` +
      `${detailLine}`
    );
  });

  const title = query ? `${sectorName || query} 눌림목 스캔` : "전체 시장 눌림목 스캔";
  const msg = buildMessage([
    header(title, `기준일 ${latestDate} · ${riskProfileLabel(riskProfile)} 기준`),
    section("스캔 조건", [
      "A/B 진입등급 · 매도경고 제외 · 코스피 중심 위험성향 필터",
      `후보 ${candidates.length}개 중 상위 ${finalPicks.length}개`,
    ]),
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
