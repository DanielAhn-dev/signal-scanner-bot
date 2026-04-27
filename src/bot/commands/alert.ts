import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { fetchAllMarketData } from "../../utils/fetchMarketData";
import { fetchRealtimePriceBatch } from "../../utils/fetchRealtimePrice";
import { fetchWatchMicroSignalsByCodes } from "../../lib/watchlistSignals";
import {
  header,
  section,
  bullets,
  divider,
  buildMessage,
  actionButtons,
  ACTIONS,
} from "../messages/layout";
import { esc } from "../messages/format";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

type AlertLevel = "NORMAL" | "WATCH" | "WARN";

function fmtKorMoney(n: number): string {
  const safe = Number(n || 0);
  if (!Number.isFinite(safe) || safe === 0) return "0억";

  const eok = Math.round(safe / 100_000_000);
  const jo = Math.floor(Math.abs(eok) / 10_000);
  const restEok = Math.abs(eok) % 10_000;
  const sign = eok < 0 ? "-" : "+";

  if (jo > 0) {
    if (restEok > 0) return `${sign}${jo}조 ${restEok.toLocaleString("ko-KR")}억`;
    return `${sign}${jo}조`;
  }
  return `${sign}${Math.abs(eok).toLocaleString("ko-KR")}억`;
}

function evaluateRisk(data: any): {
  level: AlertLevel;
  marketAlerts: string[];
  marketWatch: string[];
  actions: string[];
} {
  const marketAlerts: string[] = [];
  const marketWatch: string[] = [];
  const actions: string[] = [];

  let riskScore = 0;

  if (data.vix?.price >= 30) {
    riskScore += 3;
    marketAlerts.push(`VIX ${data.vix.price.toFixed(1)} — 변동성 급등 구간`);
  } else if (data.vix?.price >= 20) {
    riskScore += 1;
    marketWatch.push(`VIX ${data.vix.price.toFixed(1)} — 경계 구간`);
  }

  if (data.usdkrw?.price >= 1450) {
    riskScore += 2;
    marketAlerts.push(`USD/KRW ${data.usdkrw.price.toLocaleString()}원 — 원화 약세 심화`);
  } else if (data.usdkrw?.price >= 1400) {
    riskScore += 1;
    marketWatch.push(`USD/KRW ${data.usdkrw.price.toLocaleString()}원 — 외국인 수급 부담`);
  }

  if (data.us10y?.price >= 5.0) {
    riskScore += 2;
    marketAlerts.push(`미국 10년물 ${data.us10y.price.toFixed(2)}% — 고금리 리스크`);
  } else if (data.us10y?.price >= 4.5) {
    riskScore += 1;
    marketWatch.push(`미국 10년물 ${data.us10y.price.toFixed(2)}% — 금리 부담`);
  }

  if (data.kospi?.changeRate <= -2) {
    riskScore += 2;
    marketAlerts.push(`KOSPI ${data.kospi.changeRate.toFixed(1)}% — 지수 급락`);
  } else if (data.kospi?.changeRate <= -1) {
    riskScore += 1;
    marketWatch.push(`KOSPI ${data.kospi.changeRate.toFixed(1)}% — 약세 진행`);
  }

  if (data.fearGreed?.score <= 20) {
    marketWatch.push(`공포탐욕 ${data.fearGreed.score} — 극단적 공포`);
  } else if (data.fearGreed?.score >= 80) {
    marketWatch.push(`공포탐욕 ${data.fearGreed.score} — 극단적 탐욕`);
  }

  const usChanges = [data.sp500?.changeRate, data.nasdaq?.changeRate, data.dow?.changeRate]
    .filter((value): value is number => Number.isFinite(value));
  if (usChanges.length >= 2) {
    const usAvg = usChanges.reduce((sum, value) => sum + value, 0) / usChanges.length;
    if (usAvg <= -1.2) {
      riskScore += 1;
      marketWatch.push(`미국 3대 지수 약세 (${usAvg.toFixed(2)}%) — 개장 초반 변동성 주의`);
    } else if (usAvg >= 1.2) {
      marketWatch.push(`미국 3대 지수 강세 (+${usAvg.toFixed(2)}%) — 위험선호 개선`);
    }
  }

  if (riskScore >= 5) {
    actions.push("신규 진입 비중 축소, 기존 포지션 손절 기준 재확인");
    actions.push("단타 횟수 제한 및 하루 손실 한도 도달 시 즉시 종료");
  } else if (riskScore >= 2) {
    actions.push("진입은 분할(기본 3회), 손익비 우위 구간만 선택");
    actions.push("강한 섹터·강한 종목만 선별, 약한 종목 추격 금지");
  } else {
    actions.push("기존 규칙 유지, 무리한 포지션 확대 금지");
  }

  const level: AlertLevel = riskScore >= 5 ? "WARN" : riskScore >= 2 ? "WATCH" : "NORMAL";
  return { level, marketAlerts, marketWatch, actions };
}

type WatchlistCandidateRow = {
  code: string;
  stock:
    | { code: string; name: string | null }
    | { code: string; name: string | null }[]
    | null;
};

function unwrapStockName(
  stock: WatchlistCandidateRow["stock"],
  fallbackCode: string
): string {
  if (!stock) return fallbackCode;
  if (Array.isArray(stock)) return stock[0]?.name || fallbackCode;
  return stock.name || fallbackCode;
}

async function detectWatchlistAnomalies(chatId: number): Promise<string[]> {
  const { data } = await supabase
    .from("watchlist")
    .select("code, stock:stocks(code, name)")
    .eq("chat_id", chatId)
    .limit(40)
    .returns<WatchlistCandidateRow[]>();

  const watchRows: WatchlistCandidateRow[] = data ?? [];
  const codes = [...new Set(watchRows.map((row: WatchlistCandidateRow) => row.code).filter((code): code is string => Boolean(code)))];
  if (!codes.length) return [];

  const [microByCode, realtimeMap] = await Promise.all([
    fetchWatchMicroSignalsByCodes(supabase as any, codes),
    fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, any>)),
  ]);

  const hits = watchRows
    .map((row: WatchlistCandidateRow) => {
      const code = row.code;
      const micro = microByCode.get(code);
      const valueRatio = Number(micro?.valueRatio ?? 0);
      const changeRate = Number(realtimeMap[code]?.changeRate ?? 0);
      const shocked = valueRatio >= 3 && Math.abs(changeRate) >= 5;
      if (!shocked) return null;

      const direction = changeRate >= 0 ? "급등" : "급락";
      return {
        severity: valueRatio * Math.abs(changeRate),
        text: `${esc(unwrapStockName(row.stock, code))}(${code}) ${direction} ${changeRate.toFixed(
          1
        )}% · 거래대금 ${valueRatio.toFixed(1)}배`,
      };
    })
    .filter((row): row is { severity: number; text: string } => Boolean(row))
    .sort((a: { severity: number }, b: { severity: number }) => b.severity - a.severity)
    .slice(0, 5)
    .map((row: { text: string }) => row.text);

  return hits;
}

async function detectSectorRankRotationWarnings(
  sectorRows: Array<{ id?: string; name?: string }>
): Promise<string[]> {
  const sectorIds = sectorRows
    .map((row: any) => String(row.id || ""))
    .filter(Boolean);
  if (!sectorIds.length) return [];

  const from = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data } = await supabase
    .from("sector_daily")
    .select("sector_id, date, close")
    .in("sector_id", sectorIds)
    .gte("date", from)
    .order("date", { ascending: true });

  const rows = (data ?? []) as Array<{ sector_id: string; date: string; close: number | null }>;
  if (!rows.length) return [];

  const dates = [...new Set(rows.map((row) => row.date))].sort();
  if (dates.length < 4) return [];

  const d0 = dates[dates.length - 4];
  const d1 = dates[dates.length - 3];
  const d2 = dates[dates.length - 2];
  const d3 = dates[dates.length - 1];

  const closeMap = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const byDate = closeMap.get(row.sector_id) ?? new Map<string, number>();
    byDate.set(row.date, Number(row.close ?? 0));
    closeMap.set(row.sector_id, byDate);
  }

  const change = (sectorId: string, fromDate: string, toDate: string): number | null => {
    const byDate = closeMap.get(sectorId);
    const c0 = Number(byDate?.get(fromDate) ?? 0);
    const c1 = Number(byDate?.get(toDate) ?? 0);
    if (!(c0 > 0 && c1 > 0)) return null;
    return ((c1 - c0) / c0) * 100;
  };

  const oldStrength = sectorIds
    .map((id) => ({ id, v: change(id, d0, d1) }))
    .filter((row): row is { id: string; v: number } => row.v != null)
    .sort((a, b) => b.v - a.v);
  const latestStrength = sectorIds
    .map((id) => ({ id, v: change(id, d2, d3) }))
    .filter((row): row is { id: string; v: number } => row.v != null)
    .sort((a, b) => b.v - a.v);

  if (!oldStrength.length || !latestStrength.length) return [];

  const oldRank = new Map(oldStrength.map((row, idx) => [row.id, idx + 1]));
  const latestRank = new Map(latestStrength.map((row, idx) => [row.id, idx + 1]));
  const nameById = new Map(
    sectorRows
      .map((row: any) => [String(row.id || ""), String(row.name || "")] as const)
      .filter(([id]) => Boolean(id))
  );

  return latestStrength
    .map((row) => {
      const before = oldRank.get(row.id);
      const now = latestRank.get(row.id);
      if (!before || !now) return null;
      const shift = before - now;
      if (Math.abs(shift) < 3) return null;
      const dir = shift > 0 ? "상승" : "하락";
      const name = esc(nameById.get(row.id) || row.id);
      return `${name}: 3일 내 강도 순위 ${Math.abs(shift)}단계 ${dir} (${before}위 → ${now}위)`;
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, 5);
}

export async function handleAlertCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "이상징후 점검 중...",
  });

  const [marketData, sectorRows] = await Promise.all([
    fetchAllMarketData(),
    supabase
      .from("sectors")
      .select("id, name, score, metrics")
      .order("score", { ascending: false })
      .limit(15),
  ]);

  const market = evaluateRisk(marketData);

  const sectorAlerts: string[] = [];
  const rotationHints: string[] = [];

  const [watchlistAnomalyHits, rankRotationWarnings] = await Promise.all([
    detectWatchlistAnomalies(ctx.chatId).catch(() => []),
    detectSectorRankRotationWarnings((sectorRows.data || []) as any[]).catch(() => []),
  ]);

  const rows = sectorRows.data || [];
  for (const row of rows) {
    const m = row.metrics || {};
    const flowF5 = Number(m.flow_foreign_5d || 0);
    const flowI5 = Number(m.flow_inst_5d || 0);
    const flow5 = flowF5 + flowI5;
    const score = Number(row.score || 0);

    if (score >= 75 && flow5 <= -30_000_000_000) {
      sectorAlerts.push(`${esc(row.name)}: 고점권 점수지만 5일 수급 ${fmtKorMoney(flow5)} (이탈 경고)`);
    }

    if (score <= 65 && flow5 >= 30_000_000_000) {
      rotationHints.push(`${esc(row.name)}: 5일 수급 ${fmtKorMoney(flow5)} 유입 (순환매 초기 후보)`);
    }
  }

  rotationHints.unshift(...rankRotationWarnings);

  const levelLabel =
    market.level === "WARN" ? "경고" : market.level === "WATCH" ? "주의" : "정상";

  const msg = buildMessage([
    header("이상징후 알림", `현재 레벨: ${levelLabel} · 요청 시 점검형(무료모드)`),
    section(
      "시장 경보",
      market.marketAlerts.length ? bullets(market.marketAlerts) : ["• 주요 경보 없음"]
    ),
    section(
      "시장 관찰",
      market.marketWatch.length ? bullets(market.marketWatch) : ["• 특이 관찰 포인트 없음"]
    ),
    section(
      "섹터 이상징후",
      sectorAlerts.length ? bullets(sectorAlerts.slice(0, 5)) : ["• 이탈 경고 섹터 없음"]
    ),
    section(
      "순환매 힌트",
      rotationHints.length ? bullets(rotationHints.slice(0, 5)) : ["• 뚜렷한 초기 유입 섹터 없음"]
    ),
    section(
      `오늘 주의 종목 ${watchlistAnomalyHits.length}건`,
      watchlistAnomalyHits.length
        ? bullets(watchlistAnomalyHits)
        : ["• 관심 목록에서 거래대금 3배·변동률 5% 이상 교차 종목 없음"]
    ),
    divider(),
    section("행동 가이드", bullets(market.actions)),
    "※ 자동 푸시 대신, 필요 시 /알림으로 수시 점검하는 경량 방식입니다.",
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons([
      { text: "시장", callback_data: "cmd:market" },
      { text: "경제", callback_data: "cmd:economy" },
      { text: "다음섹터", callback_data: "cmd:nextsector" },
      { text: "스캔", callback_data: "cmd:scan" },
      ...ACTIONS.promptAnalyze,
    ], 2),
  });
}
