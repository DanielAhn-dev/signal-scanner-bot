import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRealtimePriceBatch } from "../utils/fetchRealtimePrice";
import { fetchAllMarketData, type MarketOverview } from "../utils/fetchMarketData";

// JSONB용 느슨한 타입
type Json = Record<string, any>;
type BriefingType = "pre_market" | "market_close";

// DB Row 타입 정의
interface SectorRow {
  id: string;
  name: string;
  score: number | null;
  change_rate: number | null;
  avg_change_rate: number | null;
  metrics: Json | null;
}

interface StockRow {
  code: string;
  name: string;
  sector_id: string | null;
  close: number | null;
  liquidity: number | null;
  avg_volume_20d: number | null;
  rsi14: number | null;
  is_sector_leader: boolean | null;
  universe_level: string | null;
  is_active?: boolean | null;
}

interface ScoreRow {
  code: string;
  total_score: number | null;
  momentum_score: number | null;
  liquidity_score: number | null;
  value_score: number | null;
  factors: Json;
  asof?: string;
}

// ===== 메인 브리핑 함수 =====
export async function createBriefingReport(
  supabase: SupabaseClient,
  type: BriefingType = "pre_market"
): Promise<string> {
  // 0. 기준일 잡기: sector_daily 마지막 날짜
  const { data: sectorDateRows, error: sectorDateError } = await supabase
    .from("sector_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);

  if (sectorDateError) {
    throw new Error(`Sector date fetch failed: ${sectorDateError.message}`);
  }
  if (!sectorDateRows || sectorDateRows.length === 0) {
    throw new Error(
      "sector_daily에 데이터가 없어 브리핑 기준일을 정할 수 없습니다."
    );
  }

  const asOf = sectorDateRows[0].date as string;

  // 1. 주도 섹터 Top 3
  const { data: topSectors, error: sectorError } = await supabase
    .from("sectors")
    .select("id, name, avg_change_rate, change_rate, score, metrics")
    .order("score", { ascending: false })
    .limit(3)
    .returns<SectorRow[]>();

  if (sectorError) {
    throw new Error(`Sector fetch failed: ${sectorError.message}`);
  }
  if (!topSectors || topSectors.length === 0) {
    throw new Error("sectors 테이블에 데이터가 없습니다.");
  }

  const topSectorIds = topSectors.map((s) => s.id);

  // 2. 점수 기준일(asof)
  const { data: scoreDateRows, error: scoreDateError } = await supabase
    .from("scores")
    .select("asof")
    .order("asof", { ascending: false })
    .limit(1);

  if (scoreDateError) {
    throw new Error(`Score date fetch failed: ${scoreDateError.message}`);
  }
  const scoreAsOf = scoreDateRows?.[0]?.asof ?? asOf;

  // 3. 상위 섹터에 속한 종목들
  const { data: sectorStocks, error: stockError } = await supabase
    .from("stocks")
    .select(
      [
        "code",
        "name",
        "sector_id",
        "close",
        "liquidity",
        "avg_volume_20d",
        "rsi14",
        "is_sector_leader",
        "universe_level",
      ].join(", ")
    )
    .in("sector_id", topSectorIds)
    .eq("is_active", true)
    .order("is_sector_leader", { ascending: false })
    .order("liquidity", { ascending: false })
    .limit(80)
    .returns<StockRow[]>();

  if (stockError) {
    throw new Error(`Stock fetch failed: ${stockError.message}`);
  }

  const sectorStockCodes = (sectorStocks ?? []).map((s) => s.code);

  // 4. 위 종목들에 대한 score 정보
  const scoresByCode = await fetchScoresByCodes(
    supabase,
    sectorStockCodes,
    scoreAsOf
  );

  // 5. '밑에서' 턴어라운드 후보
  const bottomCandidates = await fetchBottomTurnaroundCandidates(
    supabase,
    scoreAsOf
  );

  // 6. 실시간 가격 일괄 조회
  const allCodes = (sectorStocks ?? []).map((s) => s.code);
  const bottomCodes = bottomCandidates.map((s) => s.code);
  const uniqueCodes = [...new Set([...allCodes, ...bottomCodes])];
  const realtimeMap = uniqueCodes.length
    ? await fetchRealtimePriceBatch(uniqueCodes).catch(() => ({} as Record<string, any>))
    : {};

  // 7. 글로벌 시장 데이터
  const marketData = await fetchAllMarketData().catch(() => ({} as MarketOverview));

  // 8. 섹터별 리포트 텍스트 조립
  const sectorReports = topSectors.map((sector) => {
    const stocksOfSector =
      sectorStocks?.filter((s) => s.sector_id === sector.id) ?? [];

    const picked = pickTopStocksForSector(stocksOfSector, scoresByCode, 3);

    return formatSectorSection(sector, picked, scoresByCode, realtimeMap);
  });

  // 9. 빈집털이 섹션 텍스트 조립
  const bottomSectionText = formatBottomSection(bottomCandidates, realtimeMap);

  // 10. 최종 메시지 합치기
  // 장전 브리핑: 오늘(발송일) 날짜, 마감 브리핑: 오늘 날짜
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC → KST
  const briefingDate = kst.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const dataDate = new Date(asOf).toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
  });

  const emoji = type === "pre_market" ? "☀️" : "🌙";
  const typeLabel = type === "pre_market" ? "장전 브리핑" : "마감 브리핑";
  const title = `${emoji} <b>${briefingDate} ${typeLabel}</b>`;

  let report = `${title}\n─────────────────\n\n`;

  // 글로벌 환경 요약
  report += `<b>🌍 시장 환경</b>\n`;
  const mktLines: string[] = [];
  if (marketData.kospi) {
    const k = marketData.kospi;
    mktLines.push(`  KOSPI  <b>${k.price.toLocaleString()}</b> ${fmtChange(k.changeRate)}`);
  }
  if (marketData.kosdaq) {
    const kd = marketData.kosdaq;
    mktLines.push(`  KOSDAQ <b>${kd.price.toLocaleString()}</b> ${fmtChange(kd.changeRate)}`);
  }
  if (marketData.vix) {
    const v = marketData.vix;
    const tag = v.price >= 30 ? "⚠️ 공포" : v.price >= 20 ? "🟡 주의" : "🟢 안정";
    mktLines.push(`  VIX   <b>${v.price.toFixed(1)}</b> ${tag}`);
  }
  if (marketData.usdkrw) {
    const fx = marketData.usdkrw;
    mktLines.push(`  환율  <b>${fx.price.toLocaleString()}원</b> ${fmtChange(fx.changeRate)}`);
  }
  if (marketData.fearGreed) {
    const fg = marketData.fearGreed;
    mktLines.push(`  공포·탐욕  <b>${fg.score}</b> (${fg.rating})`);
  }
  report += mktLines.length > 0 ? mktLines.join("\n") + "\n" : "  (조회 불가)\n";

  report += `\n<b>🚀 주도 테마 Top 3</b>\n`;
  report += sectorReports.join("\n\n");

  report += `\n\n<b>👀 빈집털이 후보</b> <i>과매도 + 모멘텀 개선</i>\n`;
  report += bottomSectionText;

  report += `\n─────────────────\n`;
  report += `<i>📊 데이터 기준: ${dataDate} | 점수 기준: ${scoreAsOf}</i>\n`;
  report += `/점수 종목코드 · /눌림목 · /경제 · /시장`;

  return report;
}

// ===== scores 조회 & 후보 조회 유틸 =====

async function fetchScoresByCodes(
  supabase: SupabaseClient,
  codes: string[],
  asof: string
) {
  const map = new Map<string, ScoreRow>();

  if (!codes.length) return map;

  const { data, error } = await supabase
    .from("scores")
    .select(
      [
        "code",
        "total_score",
        "momentum_score",
        "liquidity_score",
        "value_score",
        "factors",
      ].join(", ")
    )
    .eq("asof", asof)
    .in("code", codes)
    .returns<ScoreRow[]>();

  if (error) {
    throw new Error(`Scores fetch failed: ${error.message}`);
  }

  (data ?? []).forEach((row) => {
    map.set(row.code, row);
  });

  return map;
}

async function fetchBottomTurnaroundCandidates(
  supabase: SupabaseClient,
  asof: string
) {
  const { data: lowRsiStocks, error: lowRsiError } = await supabase
    .from("stocks")
    .select("code, name, close, rsi14")
    .lt("rsi14", 35)
    .eq("is_active", true)
    .order("rsi14", { ascending: true })
    .limit(100)
    .returns<Pick<StockRow, "code" | "name" | "close" | "rsi14">[]>();

  if (lowRsiError) {
    throw new Error(`Low-RSI stocks fetch failed: ${lowRsiError.message}`);
  }

  if (!lowRsiStocks || lowRsiStocks.length === 0) return [];

  const codes = lowRsiStocks.map((s) => s.code);

  const { data: scoreRows, error: scoresError } = await supabase
    .from("scores")
    .select("code, momentum_score, total_score, factors")
    .eq("asof", asof)
    .in("code", codes)
    .returns<
      Pick<ScoreRow, "code" | "momentum_score" | "total_score" | "factors">[]
    >();

  if (scoresError) {
    throw new Error(`Bottom scores fetch failed: ${scoresError.message}`);
  }

  const byCode = new Map<string, any>();
  (scoreRows ?? []).forEach((row) => byCode.set(row.code, row));

  const candidates = lowRsiStocks
    .map((stock) => {
      const score = byCode.get(stock.code);
      const factors = (score?.factors ?? {}) as Json;

      const roc21 = toNumber(
        factors.roc_21 ?? factors.roc21 ?? factors.ret_1m ?? factors.return_1m
      );

      return {
        ...stock,
        momentum_score: score?.momentum_score ?? null,
        total_score: score?.total_score ?? null,
        roc21,
      };
    })
    .filter((s) => (s.roc21 ?? 0) > 0)
    .sort((a, b) => (b.roc21 ?? 0) - (a.roc21 ?? 0))
    .slice(0, 5);

  return candidates;
}

function pickTopStocksForSector(
  stocks: StockRow[],
  scoresByCode: Map<string, ScoreRow>,
  limit: number
) {
  const scored = stocks.map((s) => {
    const score = scoresByCode.get(s.code);
    const total = toNumber(score?.total_score ?? score?.momentum_score ?? 0);

    return {
      ...s,
      total_score: total,
    };
  });

  scored.sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0));

  return scored.slice(0, limit);
}

// ===== 포맷팅 =====

function formatSectorSection(
  sector: SectorRow,
  stocks: any[],
  scoresByCode: Map<string, ScoreRow>,
  realtimeMap: Record<string, any>
) {
  const sectorEmoji = getSectorEmoji(sector.name);
  const metrics = (sector.metrics ?? {}) as Json;

  const ret1m = toNumber(metrics.ret_1m ?? metrics.return_1m);
  const change = sector.change_rate as number | null;

  let header = `${sectorEmoji} <b>${sector.name}</b>`;
  header += `  점수 <b>${fmtInt(sector.score)}</b>`;
  header += `  ${fmtChange(change)}`;
  if (ret1m != null) header += `  1M ${fmtPct(ret1m)}`;

  const lines: string[] = [header];

  if (!stocks || stocks.length === 0) {
    lines.push(`  <i>집계된 유동성 종목 없음</i>`);
    return lines.join("\n");
  }

  stocks.forEach((stock) => {
    const score = scoresByCode.get(stock.code);
    const total = score?.total_score ?? score?.momentum_score ?? null;
    const rsi = stock.rsi14 != null ? Math.round(stock.rsi14) : null;

    // 실시간 가격 우선, 없으면 DB 가격
    const rt = realtimeMap[stock.code];
    const price = rt?.price ?? stock.close;
    const priceStr = price != null ? Number(price).toLocaleString("ko-KR") : "-";
    const changeStr = rt ? ` ${fmtChange(rt.changeRate)}` : "";

    const tags: string[] = [];
    if (stock.is_sector_leader) tags.push("🏅");
    const tagStr = tags.length ? tags.join("") + " " : "  ";

    lines.push(
      `${tagStr}<b>${stock.name}</b> <code>${priceStr}원</code>${changeStr}`
    );

    const details: string[] = [];
    if (total != null) details.push(`점수 ${total}`);
    if (rsi != null) details.push(`RSI ${rsi}`);
    if (stock.universe_level && stock.universe_level !== "tail")
      details.push(stock.universe_level);
    if (details.length) {
      lines.push(`     ${details.join(" · ")}`);
    }
  });

  return lines.join("\n");
}

function formatBottomSection(candidates: any[], realtimeMap: Record<string, any>) {
  if (!candidates || candidates.length === 0) {
    return "  <i>감지된 종목이 없습니다.</i>\n";
  }

  return (
    candidates
      .map((s) => {
        const rt = realtimeMap[s.code];
        const price = rt?.price ?? s.close;
        const priceStr = price != null ? Number(price).toLocaleString("ko-KR") : "-";
        const changeStr = rt ? ` ${fmtChange(rt.changeRate)}` : "";
        const rsi = s.rsi14 != null ? Math.round(s.rsi14) : null;

        let line = `  ▸ <b>${s.name}</b> <code>${priceStr}원</code>${changeStr}`;
        const info: string[] = [];
        if (rsi != null) info.push(`RSI ${rsi}`);
        if (s.momentum_score != null) info.push(`모멘텀 ${fmtInt(s.momentum_score)}`);
        if (info.length) line += `\n     ${info.join(" · ")}`;
        return line;
      })
      .join("\n") + "\n"
  );
}

// ===== 공통 헬퍼 =====

function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "N/A";
  }
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** 등락률 화살표 포맷 (▲/▼ + 색상 느낌) */
function fmtChange(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "";
  const n = Number(v);
  if (n > 0) return `▲${n.toFixed(1)}%`;
  if (n < 0) return `▼${Math.abs(n).toFixed(1)}%`;
  return "0.0%";
}

function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "-";
  }
  return String(Math.round(Number(v)));
}

function getSectorEmoji(name: string): string {
  if (name.includes("반도체")) return "💾";
  if (name.includes("2차전지") || name.includes("배터리")) return "🔋";
  if (name.includes("바이오") || name.includes("제약")) return "💊";
  if (name.includes("자동차")) return "🚗";
  if (name.includes("로봇") || name.includes("AI")) return "🤖";
  if (name.includes("건설") || name.includes("인프라")) return "🏗️";
  if (name.includes("금융") || name.includes("은행")) return "🏦";
  if (name.includes("에너지") || name.includes("석유")) return "⛽";
  if (name.includes("방산") || name.includes("우주")) return "🚀";
  if (name.includes("엔터") || name.includes("미디어")) return "🎬";
  return "📊";
}
